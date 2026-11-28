import { describe, expect, it, vi } from 'vitest'
import type { ToolSet } from 'ai'
import {
  createGoogleDataFlagger,
  withGoogleDataFlag,
} from '~~/server/utils/google/send-flag'

function createDb(options: { fails?: boolean } = {}) {
  const where = vi.fn(async () => {
    if (options.fails) {
      throw new Error('D1 down')
    }
  })
  const set = vi.fn(() => ({ where }))
  const update = vi.fn(() => ({ set }))

  return { db: { update } as never, update, set, where }
}

function createFlagger(options: {
  fails?: boolean
  isAlreadyFlagged?: boolean
} = {}) {
  const created = createDb({ fails: options.fails })
  const logger = { set: vi.fn() }
  const ensureFlagged = createGoogleDataFlagger({
    db: created.db,
    chatPublicId: 'chat-1',
    isAlreadyFlagged: () => options.isAlreadyFlagged === true,
    logger,
  })

  return { ...created, ensureFlagged, logger }
}

describe('createGoogleDataFlagger', () => {
  it('writes the flag once per send, where it is still empty', async () => {
    const { ensureFlagged, set, update } = createFlagger()

    await ensureFlagged()
    await ensureFlagged()

    expect(update).toHaveBeenCalledTimes(1)
    expect(set).toHaveBeenCalledWith({ googleDataAt: expect.any(Date) })
  })

  it('writes nothing for a chat that was already flagged', async () => {
    const { ensureFlagged, update } = createFlagger({ isAlreadyFlagged: true })

    await ensureFlagged()

    expect(update).not.toHaveBeenCalled()
  })

  it('shares one write between parallel callers', async () => {
    const { ensureFlagged, update } = createFlagger()

    await Promise.all([ensureFlagged(), ensureFlagged(), ensureFlagged()])

    expect(update).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the write throws, and tries again next time',
    async () => {
      const { ensureFlagged, update, logger } = createFlagger({ fails: true })

      await expect(ensureFlagged()).rejects.toMatchObject({ status: 500 })
      await expect(ensureFlagged()).rejects.toMatchObject({ status: 500 })

      expect(update).toHaveBeenCalledTimes(2)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          googleTools: { chatFlag: 'failed', errorName: 'Error' },
        },
      })
      expect(JSON.stringify(logger.set.mock.calls)).not.toContain('D1 down')
    })
})

function createTools(execute: (input: unknown) => unknown) {
  return {
    google__drive_read: { execute: vi.fn(execute) },
    create_artifact: { execute: vi.fn(execute) },
    web_search: { type: 'provider', id: 'x.web_search' },
  } as unknown as ToolSet
}

function wrap(input: {
  derived: () => boolean
  ensureFlagged: () => Promise<void>
  execute?: (input: unknown) => unknown
}) {
  const tools = createTools(input.execute ?? (() => 'done'))
  const wrapped = withGoogleDataFlag(tools, {
    isGoogleDerived: input.derived,
    ensureFlagged: input.ensureFlagged,
  })!

  return { tools, wrapped }
}

async function run(tools: ToolSet, name: string) {
  const tool = tools[name] as unknown as {
    execute: (input: unknown, options?: unknown) => Promise<unknown>
  }

  return await tool.execute({}, { toolCallId: 'call-1' })
}

describe('withGoogleDataFlag', () => {
  it('flags the chat right after the first Google read returned', async () => {
    const order: string[] = []
    const { wrapped } = wrap({
      derived: () => true,
      ensureFlagged: async () => {
        order.push('flag')
      },
      execute: () => {
        order.push('read')

        return 'body'
      },
    })

    expect(await run(wrapped, 'google__drive_read')).toBe('body')
    expect(order).toEqual(['read', 'flag'])
  })

  it('does not flag for a Google call that failed', async () => {
    const ensureFlagged = vi.fn(async () => undefined)
    const { wrapped } = wrap({
      derived: () => true,
      ensureFlagged,
      execute: () => {
        throw new Error('Drive 401')
      },
    })

    await expect(run(wrapped, 'google__drive_read')).rejects.toThrow('401')
    expect(ensureFlagged).not.toHaveBeenCalled()
  })

  it('does not flag for an empty Drive list, and flags for one that names '
    + 'a file', async () => {
    const ensureFlagged = vi.fn(async () => undefined)
    const listed = {
      google__drive_list_picked: {
        execute: vi.fn(async (input: unknown) => {
          return (input as { references: unknown[] }).references.length > 0
            ? { references: [{ id: 'f1' }], count: 1 }
            : { references: [], count: 0, note: 'Nothing picked.' }
        }),
      },
    } as unknown as ToolSet
    const wrapped = withGoogleDataFlag(listed, {
      isGoogleDerived: () => true,
      ensureFlagged,
    })!
    const tool = wrapped.google__drive_list_picked as unknown as {
      execute: (input: unknown, options?: unknown) => Promise<unknown>
    }

    await tool.execute({ references: [] }, { toolCallId: 'call-1' })

    expect(ensureFlagged).not.toHaveBeenCalled()

    await tool.execute({ references: [{}] }, { toolCallId: 'call-2' })

    expect(ensureFlagged).toHaveBeenCalledTimes(1)
  })

  it('drops the Google result when the flag write fails', async () => {
    const { wrapped, tools } = wrap({
      derived: () => true,
      ensureFlagged: async () => {
        throw new Error('flag failed')
      },
    })

    await expect(run(wrapped, 'google__drive_read'))
      .rejects.toThrow('flag failed')
    expect(
      (tools.google__drive_read as unknown as { execute: unknown }).execute,
    ).toHaveBeenCalledTimes(1)
  })

  it('flags before a marked write lands and refuses it when the flag '
    + 'write fails', async () => {
    const order: string[] = []
    const first = wrap({
      derived: () => true,
      ensureFlagged: async () => {
        order.push('flag')
      },
      execute: () => {
        order.push('write')

        return 'ok'
      },
    })

    await run(first.wrapped, 'create_artifact')
    expect(order).toEqual(['flag', 'write', 'flag'])

    const failing = wrap({
      derived: () => true,
      ensureFlagged: async () => {
        throw new Error('flag failed')
      },
    })

    await expect(run(failing.wrapped, 'create_artifact'))
      .rejects.toThrow('flag failed')
    expect(
      (failing.tools.create_artifact as unknown as { execute: unknown })
        .execute,
    ).not.toHaveBeenCalled()
  })

  describe('a Google tool that returns no Google content', () => {
    const NO_CONTENT = 'google__drive_save_file'

    function wrapSave(input: {
      derived: () => boolean
      ensureFlagged: () => Promise<void>
      order?: string[]
    }) {
      const wrapped = withGoogleDataFlag({
        [NO_CONTENT]: {
          execute: vi.fn(async () => {
            input.order?.push('run')

            return 'saved'
          }),
        },
      } as unknown as ToolSet, {
        isGoogleDerived: input.derived,
        ensureFlagged: input.ensureFlagged,
      })!

      return wrapped
    }

    it('flags nothing when the send is not Google-derived', async () => {
      const ensureFlagged = vi.fn(async () => undefined)
      const wrapped = wrapSave({ derived: () => false, ensureFlagged })

      expect(await run(wrapped, NO_CONTENT)).toBe('saved')
      expect(ensureFlagged).not.toHaveBeenCalled()
    })

    it('flags before it runs when the send already is Google-derived, as '
      + 'any marked write does', async () => {
      const order: string[] = []
      const wrapped = wrapSave({
        derived: () => true,
        ensureFlagged: async () => {
          order.push('flag')
        },
        order,
      })

      await run(wrapped, NO_CONTENT)

      expect(order[0]).toBe('flag')
      expect(order).toContain('run')
    })
  })

  it('costs nothing in a send without Google taint', async () => {
    const ensureFlagged = vi.fn(async () => undefined)
    const { wrapped } = wrap({ derived: () => false, ensureFlagged })

    await run(wrapped, 'create_artifact')
    await run(wrapped, 'google__drive_read')

    expect(ensureFlagged).not.toHaveBeenCalled()
  })

  it('flags after a tool returned when taint appeared while it ran',
    async () => {
      let derived = false
      const ensureFlagged = vi.fn(async () => undefined)
      const { wrapped } = wrap({
        derived: () => derived,
        ensureFlagged,
        execute: () => {
          derived = true

          return 'ok'
        },
      })

      await run(wrapped, 'create_artifact')

      expect(ensureFlagged).toHaveBeenCalledTimes(1)
    })

  it('keeps a streaming tool streaming: the result stays an async iterable '
    + 'that yields what the tool yields', async () => {
    const order: string[] = []
    const tools = {
      generate_image: {
        async* execute() {
          order.push('first')
          yield { state: 'pending' }
          order.push('second')
          yield { state: 'ready' }
        },
      },
    } as unknown as ToolSet
    const wrapped = withGoogleDataFlag(tools, {
      isGoogleDerived: () => true,
      ensureFlagged: async () => {
        order.push('flag')
      },
    })!
    const execute = (wrapped.generate_image as unknown as {
      execute: (input: unknown) => AsyncIterable<unknown>
    }).execute
    const result = execute({})
    const yielded: unknown[] = []

    expect(typeof result.then).toBe('undefined')

    for await (const value of result) {
      yielded.push(value)
    }

    expect(yielded).toEqual([{ state: 'pending' }, { state: 'ready' }])
    expect(order).toEqual(['flag', 'first', 'second', 'flag'])
  })

  it('leaves provider tools and a missing tool set alone', () => {
    const { tools, wrapped } = wrap({
      derived: () => true,
      ensureFlagged: async () => undefined,
    })

    expect(wrapped.web_search).toBe(tools.web_search)
    expect(withGoogleDataFlag(undefined, {
      isGoogleDerived: () => true,
      ensureFlagged: async () => undefined,
    })).toBeUndefined()
  })
})

import type { ModelMessage } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  activeFlags: new Set<string>(),
  resolveSendFeatures: vi.fn(),
  getOwnedFiles: vi.fn(),
}))

vi.mock('~~/server/utils/features/send-features', () => ({
  resolveSendFeatures: mocks.resolveSendFeatures,
}))

vi.mock('~~/server/utils/files/file-governance', () => ({
  extractStorageKeyFromFileUrl: (url: string) => {
    return url.startsWith('/files/') ? url.slice('/files/'.length) : null
  },
  getOwnedFilesByStorageKeys: mocks.getOwnedFiles,
}))

vi.mock('evlog', () => ({
  createError: (input: { message?: string, status?: number }) => {
    return Object.assign(new Error(input.message), input)
  },
}))

const logger = { set: vi.fn() }

async function loadSend() {
  return await import('~~/server/utils/code-execution/send')
}

describe('resolveCodeExecutionGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.activeFlags = new Set(['code-execution', 'code-execution.files'])
    mocks.resolveSendFeatures.mockImplementation(async () => ({
      isFeatureActive: (flag: string) => mocks.activeFlags.has(flag),
    }))
  })

  it('does nothing when the tool was not requested', async () => {
    const { resolveCodeExecutionGate } = await loadSend()

    expect(await resolveCodeExecutionGate({
      event: { context: {} },
      requestedTools: ['web_search'],
      gatewayId: undefined,
      providerId: 'anthropic',
      logger,
    })).toEqual({
      tools: ['web_search'],
      active: false,
      filesActive: false,
    })
    expect(mocks.resolveSendFeatures).not.toHaveBeenCalled()
  })

  it('keeps the tool when the flag, role and opt-in resolve to active', async () => {
    const { resolveCodeExecutionGate } = await loadSend()
    const gate = await resolveCodeExecutionGate({
      event: { context: {} },
      requestedTools: ['code_execution'],
      gatewayId: undefined,
      providerId: 'openai',
      logger,
    })

    expect(gate).toEqual({
      tools: ['code_execution'],
      active: true,
      filesActive: true,
    })
    expect(mocks.resolveSendFeatures).toHaveBeenCalledWith(
      { context: {} },
      ['code-execution', 'code-execution.files'],
      logger,
    )
  })

  it('is active without files when only the parent flag is on', async () => {
    mocks.activeFlags = new Set(['code-execution'])

    const { resolveCodeExecutionGate } = await loadSend()
    const gate = await resolveCodeExecutionGate({
      event: { context: {} },
      requestedTools: ['code_execution'],
      gatewayId: undefined,
      providerId: 'google',
      logger,
    })

    expect(gate).toMatchObject({ active: true, filesActive: false })
  })

  it('drops the tool, and every other tool stays, when the feature is off', async () => {
    mocks.activeFlags = new Set()

    const { resolveCodeExecutionGate } = await loadSend()
    const gate = await resolveCodeExecutionGate({
      event: { context: {} },
      requestedTools: ['web_search', 'code_execution'],
      gatewayId: undefined,
      providerId: 'anthropic',
      logger,
    })

    expect(gate).toEqual({
      tools: ['web_search'],
      active: false,
      filesActive: false,
    })
  })

  it.each(['deepseek', 'moonshotai', 'qwen', 'xai', undefined])(
    'refuses provider %s',
    async (providerId) => {
      const { resolveCodeExecutionGate } = await loadSend()

      await expect(resolveCodeExecutionGate({
        event: { context: {} },
        requestedTools: ['code_execution'],
        gatewayId: undefined,
        providerId,
        logger,
      })).rejects.toMatchObject({ status: 400 })
    },
  )

  it('refuses Run code with Brave or Exa search on Gemini 2.5, where it must run alone', async () => {
    const { resolveCodeExecutionGate } = await loadSend()

    for (const tool of ['web_search_brave', 'web_search_exa'] as const) {
      await expect(resolveCodeExecutionGate({
        event: { context: {} },
        requestedTools: ['code_execution', tool],
        gatewayId: undefined,
        providerId: 'google',
        modelId: 'gemini-2.5-flash',
        logger,
      })).rejects.toMatchObject({ status: 400 })
    }

    await expect(resolveCodeExecutionGate({
      event: { context: {} },
      requestedTools: ['code_execution', 'web_search_brave'],
      gatewayId: undefined,
      providerId: 'google',
      modelId: 'gemini-3.8-flash',
      logger,
    })).resolves.toMatchObject({ active: true })
  })

  it.each(['openrouter', 'vercel', 'cloudflare'])(
    'refuses gateway %s even for a provider that has a sandbox',
    async (gatewayId) => {
      const { resolveCodeExecutionGate } = await loadSend()

      await expect(resolveCodeExecutionGate({
        event: { context: {} },
        requestedTools: ['code_execution'],
        gatewayId,
        providerId: 'anthropic',
        logger,
      })).rejects.toMatchObject({ status: 400 })
    },
  )
})

describe('buildCodeExecutionInstruction', () => {
  it('is the base instruction without attachments', async () => {
    const { CODE_EXECUTION_INSTRUCTION, buildCodeExecutionInstruction }
      = await loadSend()

    expect(buildCodeExecutionInstruction()).toBe(CODE_EXECUTION_INSTRUCTION)
  })

  it('names the attached files and tells the model to read them, not retype them', async () => {
    const { buildCodeExecutionInstruction } = await loadSend()
    const instruction = buildCodeExecutionInstruction([
      'cities.csv',
      '../etc/passwd',
    ])

    expect(instruction).toContain('cities.csv, passwd')
    expect(instruction).toContain('/mnt/data')
    expect(instruction).toContain('Do not retype or guess their content')
  })
})

describe('appendAnthropicContainerUploads', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: 'answer' },
    { role: 'user', content: [{ type: 'text', text: 'plot it' }] },
  ]

  it('adds a container upload block to the last user message only', async () => {
    const { appendAnthropicContainerUploads } = await loadSend()
    const result = appendAnthropicContainerUploads(messages, ['file_1'])

    expect(result[0]).toEqual(messages[0])
    expect(result[2]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'plot it' },
        {
          type: 'file',
          data: { anthropic: 'file_1' },
          mediaType: 'application/octet-stream',
          providerOptions: { anthropic: { containerUpload: true } },
        },
      ],
    })
  })

  it('turns a plain string message into parts', async () => {
    const { appendAnthropicContainerUploads } = await loadSend()
    const result = appendAnthropicContainerUploads(
      [{ role: 'user', content: 'plain' }],
      ['file_1'],
    )

    expect((result[0]?.content as unknown[])[0]).toEqual({
      type: 'text',
      text: 'plain',
    })
  })

  it('returns the messages untouched without uploads', async () => {
    const { appendAnthropicContainerUploads } = await loadSend()

    expect(appendAnthropicContainerUploads(messages, [])).toBe(messages)
  })
})

describe('withAnthropicContainerForwarding', () => {
  it('adds the container id of the last step to the next step', async () => {
    const { withAnthropicContainerForwarding } = await loadSend()
    const prepareStep = vi.fn(async () => ({
      providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
    }))
    const wrapped = withAnthropicContainerForwarding({ prepareStep })
    const result = await wrapped.prepareStep({
      steps: [
        { providerMetadata: { anthropic: { container: { id: 'cntr_old' } } } },
        { providerMetadata: { anthropic: { container: { id: 'cntr_new' } } } },
      ],
    }) as { providerOptions: Record<string, Record<string, unknown>> }

    expect(result.providerOptions.anthropic).toEqual({
      cacheControl: { type: 'ephemeral' },
      container: { id: 'cntr_new' },
    })
  })

  it('passes the original result through while no step has a container', async () => {
    const { withAnthropicContainerForwarding } = await loadSend()
    const original = { instructions: 'final' }
    const wrapped = withAnthropicContainerForwarding({
      prepareStep: async () => original,
    })

    expect(await wrapped.prepareStep({ steps: [{}] })).toBe(original)
  })
})

describe('startCodeExecutionSession', () => {
  const fileParts = [
    { type: 'text' },
    {
      type: 'file',
      url: '/files/key1.csv',
      filename: 'data.csv',
      mediaType: 'text/csv',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getOwnedFiles.mockResolvedValue(
      new Map([['key1.csv', { id: 'f1', storageKey: 'key1.csv', size: 4 }]]),
    )
    vi.stubGlobal('useDb', () => ({
      query: {
        keys: { findFirst: vi.fn(async () => ({ apiKey: 'encrypted' })) },
      },
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async () => 'user-key'))
    vi.stubGlobal('useFileStorage', () => ({
      get: vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(4) })),
    }))
  })

  it('uploads attachments, tracks them and deletes them on cleanup', async () => {
    const { startCodeExecutionSession } = await loadSend()
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      return init?.method === 'POST'
        ? new Response(JSON.stringify({ id: 'file_up' }), { status: 200 })
        : new Response(null, { status: 200 })
    })
    const session = await startCodeExecutionSession({
      userId: 3,
      provider: 'anthropic',
      filesActive: true,
      newMessageParts: fileParts,
      logger,
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(session.uploadedFileIds).toEqual(['file_up'])
    expect(session.tracker.hasPending()).toBe(true)

    await session.tracker.cleanup()

    expect(fetcher.mock.calls.at(-1)?.[0])
      .toBe('https://api.anthropic.com/v1/files/file_up')
    expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ method: 'DELETE' })
  })

  it('uploads nothing for Gemini or without code-execution.files', async () => {
    const { startCodeExecutionSession } = await loadSend()
    const fetcher = vi.fn()

    for (const [provider, filesActive] of [
      ['google', true],
      ['anthropic', false],
    ] as const) {
      const session = await startCodeExecutionSession({
        userId: 3,
        provider,
        filesActive,
        newMessageParts: fileParts,
        logger,
        fetcher: fetcher as unknown as typeof fetch,
      })

      expect(session.uploadedFileIds).toEqual([])
    }

    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refuses without a saved key for the provider', async () => {
    vi.stubGlobal('useDb', () => ({
      query: { keys: { findFirst: vi.fn(async () => undefined) } },
    }))

    const { startCodeExecutionSession } = await loadSend()

    await expect(startCodeExecutionSession({
      userId: 3,
      provider: 'openai',
      filesActive: true,
      newMessageParts: fileParts,
      logger,
    })).rejects.toMatchObject({ status: 401 })
  })

  it('reads only the files inside the 10 file and 20 MB cap, never the rest', async () => {
    const big = 15 * 1024 * 1024
    const keys = ['a.csv', 'b.csv', 'c.csv']

    mocks.getOwnedFiles.mockResolvedValue(new Map(
      keys.map((key, index) => {
        return [key, { id: key, storageKey: key, size: index < 2 ? big : 1 }]
      }),
    ))

    const read = vi.fn(async () => ({
      arrayBuffer: async () => new ArrayBuffer(4),
    }))

    vi.stubGlobal('useFileStorage', () => ({ get: read }))

    const { startCodeExecutionSession } = await loadSend()
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ id: 'file_up' }), { status: 200 })
    })

    await startCodeExecutionSession({
      userId: 3,
      provider: 'anthropic',
      filesActive: true,
      newMessageParts: keys.map((key) => {
        return {
          type: 'file',
          url: `/files/${key}`,
          filename: key,
          mediaType: 'text/csv',
        }
      }),
      logger,
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(read.mock.calls.map(call => (call as unknown[])[0]))
      .toEqual(['a.csv', 'c.csv'])
  })

  it('never uploads a file the user does not own', async () => {
    mocks.getOwnedFiles.mockResolvedValue(new Map())

    const { startCodeExecutionSession } = await loadSend()
    const fetcher = vi.fn()
    const session = await startCodeExecutionSession({
      userId: 3,
      provider: 'anthropic',
      filesActive: true,
      newMessageParts: fileParts,
      logger,
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(session.uploadedFileIds).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })
})

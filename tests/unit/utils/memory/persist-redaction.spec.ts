import type { UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import { redactMemoryToolPartsForPersistence } from '~~/server/utils/memory/persist-redaction'

function asParts(parts: unknown[]): UIMessage['parts'] {
  return parts as UIMessage['parts']
}

const listedEntry = {
  id: 'id-1',
  handle: 'topics/pasta',
  scope: 'account',
  category: 'topics',
  title: 'Pasta',
  description: 'Likes pasta',
  body: 'Likes pasta.',
}

describe('redactMemoryToolPartsForPersistence', () => {
  it('drops entry bodies from memory_list output and keeps the rest', () => {
    const [part] = redactMemoryToolPartsForPersistence(asParts([{
      type: 'tool-memory_list',
      toolCallId: 'call-1',
      state: 'output-available',
      input: {},
      output: {
        notice: 'notice',
        entries: [listedEntry, { ...listedEntry, id: 'id-2', body: 'Second.' }],
      },
    }])) as any[]

    expect(part.output.entries).toEqual([
      {
        id: 'id-1',
        handle: 'topics/pasta',
        scope: 'account',
        category: 'topics',
        title: 'Pasta',
        description: 'Likes pasta',
      },
      {
        id: 'id-2',
        handle: 'topics/pasta',
        scope: 'account',
        category: 'topics',
        title: 'Pasta',
        description: 'Likes pasta',
      },
    ])
    expect(part.output.notice).toBe('notice')
    expect(part.state).toBe('output-available')
    expect(part.toolCallId).toBe('call-1')
    expect(JSON.stringify(part)).not.toContain('Likes pasta.')
    expect(JSON.stringify(part)).not.toContain('Second.')
  })

  it('drops the entry body from memory_read output', () => {
    const [part] = redactMemoryToolPartsForPersistence(asParts([{
      type: 'tool-memory_read',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { id: 'topics/pasta' },
      output: { notice: 'notice', entry: listedEntry },
    }])) as any[]

    expect(part.output.entry).not.toHaveProperty('body')
    expect(part.output.entry.handle).toBe('topics/pasta')
    expect(part.input).toEqual({ id: 'topics/pasta' })
  })

  it('drops input.body, output.previous and keeps ids, titles and the '
    + 'quote on memory_write', () => {
    const [part] = redactMemoryToolPartsForPersistence(asParts([{
      type: 'tool-memory_write',
      toolCallId: 'call-1',
      state: 'output-available',
      input: {
        title: 'Pasta',
        category: 'topics',
        body: 'Secret body.',
        userRequestQuote: 'remember that I like pasta',
      },
      output: {
        notice: 'notice',
        action: 'updated',
        entry: {
          id: 'id-1',
          handle: 'topics/pasta',
          title: 'Pasta',
          description: 'Likes pasta',
        },
        previous: {
          title: 'Pasta',
          body: 'Previous body.',
        },
      },
    }])) as any[]

    expect(part.input).toEqual({
      title: 'Pasta',
      category: 'topics',
      userRequestQuote: 'remember that I like pasta',
    })
    expect(part.output).not.toHaveProperty('previous')
    expect(part.output.action).toBe('updated')
    expect(part.output.entry.id).toBe('id-1')
    expect(JSON.stringify(part)).not.toContain('Secret body.')
    expect(JSON.stringify(part)).not.toContain('Previous body.')
  })

  it('redacts a streaming memory_write part that only has an input', () => {
    const [part] = redactMemoryToolPartsForPersistence(asParts([{
      type: 'tool-memory_write',
      toolCallId: 'call-1',
      state: 'input-available',
      input: { title: 'Pasta', body: 'Secret body.' },
    }])) as any[]

    expect(part.input).toEqual({ title: 'Pasta' })
    expect(part).not.toHaveProperty('output')
  })

  it('keeps memory_forget removed handles and error text', () => {
    const parts = redactMemoryToolPartsForPersistence(asParts([{
      type: 'tool-memory_forget',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { id: 'topics/pasta', userRequestQuote: 'forget pasta' },
      output: {
        notice: 'notice',
        removed: { id: 'id-1', handle: 'topics/pasta', title: 'Pasta' },
      },
    }, {
      type: 'tool-memory_forget',
      toolCallId: 'call-2',
      state: 'output-error',
      input: { id: 'missing' },
      errorText: 'Entry not found',
    }])) as any[]

    expect(parts[0].output.removed).toEqual({
      id: 'id-1',
      handle: 'topics/pasta',
      title: 'Pasta',
    })
    expect(parts[0].input.userRequestQuote).toBe('forget pasta')
    expect(parts[1].errorText).toBe('Entry not found')
  })

  it('redacts dynamic-tool parts of memory tools only', () => {
    const memoryPart = {
      type: 'dynamic-tool',
      toolName: 'memory_read',
      toolCallId: 'call-1',
      state: 'output-available',
      input: {},
      output: { entry: listedEntry },
    }
    const otherPart = {
      type: 'dynamic-tool',
      toolName: 'other_tool',
      toolCallId: 'call-2',
      state: 'output-available',
      input: { body: 'keep me' },
      output: { entry: listedEntry },
    }
    const [redactedMemory, redactedOther] = redactMemoryToolPartsForPersistence(
      asParts([memoryPart, otherPart]),
    ) as any[]

    expect(redactedMemory.output.entry).not.toHaveProperty('body')
    expect(redactedOther).toBe(otherPart)
  })

  it('drops a body from rawInput of an invalid memory tool call', () => {
    const [part] = redactMemoryToolPartsForPersistence(asParts([{
      type: 'tool-memory_write',
      toolCallId: 'call-1',
      state: 'output-error',
      input: undefined,
      rawInput: { title: 'Pasta', body: 'Secret body.' },
      errorText: 'Invalid input',
    }, {
      type: 'tool-memory_write',
      toolCallId: 'call-2',
      state: 'output-error',
      input: undefined,
      rawInput: '{"body":"Secret body."}',
      errorText: 'Invalid input',
    }])) as any[]
    const parts = redactMemoryToolPartsForPersistence(asParts([{
      type: 'tool-memory_write',
      rawInput: '{"body":"Secret body."}',
    }])) as any[]

    expect(part.rawInput).toEqual({ title: 'Pasta' })
    expect(parts[0]).not.toHaveProperty('rawInput')
  })

  it('does not mutate the input parts or the array', () => {
    const original = {
      type: 'tool-memory_write',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { title: 'Pasta', body: 'Secret body.' },
      output: {
        entry: { ...listedEntry },
        previous: { body: 'Previous body.' },
      },
    }
    const snapshot = structuredClone(original)
    const input = asParts([original])
    const result = redactMemoryToolPartsForPersistence(input)

    expect(original).toEqual(snapshot)
    expect(result).not.toBe(input)
    expect(result[0]).not.toBe(original)
  })

  it('leaves unrelated parts untouched by reference', () => {
    const textPart = { type: 'text', text: 'Hello' }
    const searchPart = {
      type: 'tool-search_chats',
      toolCallId: 'call-1',
      state: 'output-available',
      input: { query: 'q' },
      output: { entries: [{ body: 'keep' }], previous: { body: 'keep' } },
    }
    const filePart = { type: 'file', url: 'x', mediaType: 'text/plain' }
    const result = redactMemoryToolPartsForPersistence(
      asParts([textPart, searchPart, filePart]),
    )

    expect(result[0]).toBe(textPart)
    expect(result[1]).toBe(searchPart)
    expect(result[2]).toBe(filePart)
  })

  it('tolerates malformed shapes without throwing', () => {
    const parts = redactMemoryToolPartsForPersistence(asParts([
      null,
      'text',
      { type: 42 },
      { type: 'tool-memory_list' },
      { type: 'tool-memory_list', output: null },
      { type: 'tool-memory_list', output: 'string output' },
      { type: 'tool-memory_list', output: { entries: 'nope' } },
      { type: 'tool-memory_list', output: { entries: [null, 1, listedEntry] } },
      { type: 'tool-memory_read', output: { entry: null } },
      { type: 'tool-memory_write', input: 'string input' },
      { type: 'dynamic-tool', toolName: 42 },
    ])) as any[]

    expect(parts).toHaveLength(11)
    expect(parts[4].output).toBeNull()
    expect(parts[5].output).toBe('string output')
    expect(parts[6].output.entries).toBe('nope')
    expect(parts[7].output.entries).toEqual([
      null,
      1,
      {
        id: 'id-1',
        handle: 'topics/pasta',
        scope: 'account',
        category: 'topics',
        title: 'Pasta',
        description: 'Likes pasta',
      },
    ])
    expect(parts[8].output.entry).toBeNull()
    expect(parts[9].input).toBe('string input')
  })
})

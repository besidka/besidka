import { describe, expect, it } from 'vitest'
import {
  emitSourcesForExternalSearchResults,
  filterRecoverableUIMessageStreamErrors,
  insertParagraphBreakAfterNonTextGap,
} from '../../../server/utils/chats/filter-ui-message-stream'

async function readAllChunks(stream: ReadableStream<any>) {
  const reader = stream.getReader()
  const chunks = []

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    chunks.push(value)
  }

  return chunks
}

describe('filterRecoverableUIMessageStreamErrors', () => {
  it('suppresses late rate-limit error chunks after visible text', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'text-delta',
          delta: 'Completed answer',
          id: 'text-1',
        })
        controller.enqueue({
          type: 'error',
          errorText: JSON.stringify({
            code: 'provider-rate-limit',
            message: 'The provider is rate limiting requests right now.',
          }),
        })
        controller.close()
      },
    })

    await expect(readAllChunks(
      filterRecoverableUIMessageStreamErrors(stream),
    )).resolves.toEqual([{
      type: 'text-delta',
      delta: 'Completed answer',
      id: 'text-1',
    }])
  })

  it('suppresses buffered rate-limit errors when visible text arrives later', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'error',
          errorText: JSON.stringify({
            code: 'provider-rate-limit',
            message: 'The provider is rate limiting requests right now.',
          }),
        })
        controller.enqueue({
          type: 'text-delta',
          delta: 'Recovered answer',
          id: 'text-1',
        })
        controller.close()
      },
    })

    await expect(readAllChunks(
      filterRecoverableUIMessageStreamErrors(stream),
    )).resolves.toEqual([{
      type: 'text-delta',
      delta: 'Recovered answer',
      id: 'text-1',
    }])
  })

  it('keeps rate-limit error chunks when no visible text was produced', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'error',
          errorText: JSON.stringify({
            code: 'provider-rate-limit',
            message: 'The provider is rate limiting requests right now.',
          }),
        })
        controller.close()
      },
    })

    await expect(readAllChunks(
      filterRecoverableUIMessageStreamErrors(stream),
    )).resolves.toEqual([{
      type: 'error',
      errorText: JSON.stringify({
        code: 'provider-rate-limit',
        message: 'The provider is rate limiting requests right now.',
      }),
    }])
  })

  it('keeps non-rate-limit error chunks even after visible text', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'text-delta',
          delta: 'Completed answer',
          id: 'text-1',
        })
        controller.enqueue({
          type: 'error',
          errorText: JSON.stringify({
            code: 'message-persist-failed',
            message: 'The response could not be saved.',
          }),
        })
        controller.close()
      },
    })

    await expect(readAllChunks(
      filterRecoverableUIMessageStreamErrors(stream),
    )).resolves.toEqual([
      {
        type: 'text-delta',
        delta: 'Completed answer',
        id: 'text-1',
      },
      {
        type: 'error',
        errorText: JSON.stringify({
          code: 'message-persist-failed',
          message: 'The response could not be saved.',
        }),
      },
    ])
  })

  it('suppresses raw provider rate-limit errors after visible text', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'text-delta',
          delta: 'Completed answer',
          id: 'text-1',
        })
        controller.enqueue({
          type: 'error',
          errorText: 'Rate limit reached for gpt-5.4-mini on tokens per min (TPM). Please try again in 3.5s.',
        })
        controller.close()
      },
    })

    await expect(readAllChunks(
      filterRecoverableUIMessageStreamErrors(stream),
    )).resolves.toEqual([{
      type: 'text-delta',
      delta: 'Completed answer',
      id: 'text-1',
    }])
  })
})

describe('insertParagraphBreakAfterNonTextGap', () => {
  it('inserts a separator on the delta after a tool-call gap', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 'text-1' })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: 'Hello',
        })
        controller.enqueue({ type: 'tool-input-start', id: 'tool-1' })
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'tool-1',
        })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: '.World',
        })
        controller.enqueue({ type: 'text-end', id: 'text-1' })
        controller.close()
      },
    })

    await expect(readAllChunks(
      insertParagraphBreakAfterNonTextGap(stream),
    )).resolves.toEqual([
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Hello' },
      { type: 'tool-input-start', id: 'tool-1' },
      { type: 'tool-output-available', toolCallId: 'tool-1' },
      { type: 'text-delta', id: 'text-1', delta: '\n\n.World' },
      { type: 'text-end', id: 'text-1' },
    ])
  })

  it('inserts a separator for the reported production case', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 'text-1' })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: '...per ounce.',
        })
        controller.enqueue({ type: 'tool-input-start', id: 'tool-1' })
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'tool-1',
        })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: '**Current gold price',
        })
        controller.enqueue({ type: 'text-end', id: 'text-1' })
        controller.close()
      },
    })

    const chunks = await readAllChunks(
      insertParagraphBreakAfterNonTextGap(stream),
    )

    expect(chunks[4]).toEqual({
      type: 'text-delta',
      id: 'text-1',
      delta: '\n\n**Current gold price',
    })
  })

  it('leaves consecutive deltas unchanged when there is no gap', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 'text-1' })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: 'Hello',
        })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: ' world',
        })
        controller.enqueue({ type: 'text-end', id: 'text-1' })
        controller.close()
      },
    })

    await expect(readAllChunks(
      insertParagraphBreakAfterNonTextGap(stream),
    )).resolves.toEqual([
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Hello' },
      { type: 'text-delta', id: 'text-1', delta: ' world' },
      { type: 'text-end', id: 'text-1' },
    ])
  })

  it('does not double up a separator when text already ends in whitespace', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 'text-1' })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: 'Hello\n',
        })
        controller.enqueue({ type: 'tool-input-start', id: 'tool-1' })
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'tool-1',
        })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: 'World',
        })
        controller.enqueue({ type: 'text-end', id: 'text-1' })
        controller.close()
      },
    })

    await expect(readAllChunks(
      insertParagraphBreakAfterNonTextGap(stream),
    )).resolves.toEqual([
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Hello\n' },
      { type: 'tool-input-start', id: 'tool-1' },
      { type: 'tool-output-available', toolCallId: 'tool-1' },
      { type: 'text-delta', id: 'text-1', delta: 'World' },
      { type: 'text-end', id: 'text-1' },
    ])
  })

  it('does not let an empty delta consume a pending gap', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 'text-1' })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: 'Hello',
        })
        controller.enqueue({ type: 'tool-input-start', id: 'tool-1' })
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'tool-1',
        })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: '',
        })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: 'World',
        })
        controller.enqueue({ type: 'text-end', id: 'text-1' })
        controller.close()
      },
    })

    await expect(readAllChunks(
      insertParagraphBreakAfterNonTextGap(stream),
    )).resolves.toEqual([
      { type: 'text-start', id: 'text-1' },
      { type: 'text-delta', id: 'text-1', delta: 'Hello' },
      { type: 'tool-input-start', id: 'tool-1' },
      { type: 'tool-output-available', toolCallId: 'tool-1' },
      { type: 'text-delta', id: 'text-1', delta: '' },
      { type: 'text-delta', id: 'text-1', delta: '\n\nWorld' },
      { type: 'text-end', id: 'text-1' },
    ])
  })

  it('inserts a separator after a reasoning gap between text deltas', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 'text-1' })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: 'Hello',
        })
        controller.enqueue({ type: 'reasoning-start', id: 'reasoning-1' })
        controller.enqueue({
          type: 'reasoning-delta',
          id: 'reasoning-1',
          delta: 'Thinking some more',
        })
        controller.enqueue({ type: 'reasoning-end', id: 'reasoning-1' })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: 'World',
        })
        controller.enqueue({ type: 'text-end', id: 'text-1' })
        controller.close()
      },
    })

    const chunks = await readAllChunks(
      insertParagraphBreakAfterNonTextGap(stream),
    )

    expect(chunks[chunks.length - 2]).toEqual({
      type: 'text-delta',
      id: 'text-1',
      delta: '\n\nWorld',
    })
  })

  it('tracks multiple concurrent text ids independently', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({ type: 'text-start', id: 'text-1' })
        controller.enqueue({ type: 'text-start', id: 'text-2' })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: 'First',
        })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-2',
          delta: 'Second',
        })
        controller.enqueue({ type: 'tool-input-start', id: 'tool-1' })
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'tool-1',
        })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-1',
          delta: '.More1',
        })
        controller.enqueue({
          type: 'text-delta',
          id: 'text-2',
          delta: '.More2',
        })
        controller.enqueue({ type: 'text-end', id: 'text-1' })
        controller.enqueue({ type: 'text-end', id: 'text-2' })
        controller.close()
      },
    })

    await expect(readAllChunks(
      insertParagraphBreakAfterNonTextGap(stream),
    )).resolves.toEqual([
      { type: 'text-start', id: 'text-1' },
      { type: 'text-start', id: 'text-2' },
      { type: 'text-delta', id: 'text-1', delta: 'First' },
      { type: 'text-delta', id: 'text-2', delta: 'Second' },
      { type: 'tool-input-start', id: 'tool-1' },
      { type: 'tool-output-available', toolCallId: 'tool-1' },
      { type: 'text-delta', id: 'text-1', delta: '\n\n.More1' },
      { type: 'text-delta', id: 'text-2', delta: '\n\n.More2' },
      { type: 'text-end', id: 'text-1' },
      { type: 'text-end', id: 'text-2' },
    ])
  })

  it('passes through unchanged when given a non-stream value', () => {
    const notAStream = { pipeThrough: undefined } as unknown as ReadableStream

    expect(insertParagraphBreakAfterNonTextGap(notAStream)).toBe(notAStream)
  })
})

describe('emitSourcesForExternalSearchResults', () => {
  it('emits the original chunk plus derived source-url chunks for a '
    + 'Brave tool-output', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'call-1',
          output: {
            provider: 'brave',
            results: [
              { title: 'First result', url: 'https://example.com/first' },
              { title: 'Second result', url: 'https://example.com/second' },
            ],
          },
        })
        controller.close()
      },
    })

    const chunks = await readAllChunks(
      emitSourcesForExternalSearchResults(stream),
    )

    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toEqual({
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: {
        provider: 'brave',
        results: [
          { title: 'First result', url: 'https://example.com/first' },
          { title: 'Second result', url: 'https://example.com/second' },
        ],
      },
    })
    expect(chunks[1]).toEqual(expect.objectContaining({
      type: 'source-url',
      url: 'https://example.com/first',
      title: 'First result',
    }))
    expect(chunks[2]).toEqual(expect.objectContaining({
      type: 'source-url',
      url: 'https://example.com/second',
      title: 'Second result',
    }))
  })

  it('emits derived source-url chunks for an Exa tool-output', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'call-1',
          output: {
            provider: 'exa',
            results: [
              { title: 'Exa result', url: 'https://example.com/exa' },
            ],
          },
        })
        controller.close()
      },
    })

    const chunks = await readAllChunks(
      emitSourcesForExternalSearchResults(stream),
    )

    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toEqual(expect.objectContaining({
      type: 'source-url',
      url: 'https://example.com/exa',
      title: 'Exa result',
    }))
  })

  it('deduplicates repeated URLs within the same message', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'call-1',
          output: {
            provider: 'brave',
            results: [
              { title: 'First result', url: 'https://example.com/dup' },
            ],
          },
        })
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'call-2',
          output: {
            provider: 'brave',
            results: [
              { title: 'Duplicate result', url: 'https://example.com/dup' },
            ],
          },
        })
        controller.close()
      },
    })

    const chunks = await readAllChunks(
      emitSourcesForExternalSearchResults(stream),
    )

    const sourceUrlChunks = chunks.filter((chunk) => {
      return chunk.type === 'source-url'
    })

    expect(sourceUrlChunks).toHaveLength(1)
  })

  it('emits only the tool chunk for a malformed or empty output', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'call-1',
          output: { provider: 'brave', results: [] },
        })
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'call-2',
          output: null,
        })
        controller.close()
      },
    })

    await expect(readAllChunks(
      emitSourcesForExternalSearchResults(stream),
    )).resolves.toEqual([
      {
        type: 'tool-output-available',
        toolCallId: 'call-1',
        output: { provider: 'brave', results: [] },
      },
      {
        type: 'tool-output-available',
        toolCallId: 'call-2',
        output: null,
      },
    ])
  })

  it('passes through a non-search tool chunk untouched', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue({
          type: 'tool-output-available',
          toolCallId: 'call-1',
          output: { provider: 'openai', results: [] },
        })
        controller.close()
      },
    })

    await expect(readAllChunks(
      emitSourcesForExternalSearchResults(stream),
    )).resolves.toEqual([{
      type: 'tool-output-available',
      toolCallId: 'call-1',
      output: { provider: 'openai', results: [] },
    }])
  })

  it('passes through unchanged when given a non-stream value', () => {
    const notAStream = { pipeThrough: undefined } as unknown as ReadableStream

    expect(emitSourcesForExternalSearchResults(notAStream)).toBe(notAStream)
  })
})

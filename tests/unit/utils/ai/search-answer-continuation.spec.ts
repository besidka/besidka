import type { UIMessageChunk } from 'ai'
import { describe, expect, it, vi } from 'vitest'
import {
  buildSearchAnswerContinuationMessages,
  buildSearchResultsContext,
  SEARCH_ANSWER_CONTEXT_MAX_RESULTS,
  SEARCH_ANSWER_OPAQUE_OUTPUT_MAX_CHARS,
  withSearchAnswerGuarantee,
} from '../../../../server/utils/ai/search-answer-continuation'

const SEARCH_TOOL_NAME = 'web_search_brave'
const FORCED_STEP_INDEX = 3

function createUsage(inputTokens: number, outputTokens: number) {
  return {
    inputTokens,
    inputTokenDetails: {
      noCacheTokens: undefined,
      cacheReadTokens: undefined,
      cacheWriteTokens: undefined,
    },
    outputTokens,
    outputTokenDetails: {
      textTokens: undefined,
      reasoningTokens: undefined,
    },
    totalTokens: inputTokens + outputTokens,
  }
}

function createStream(chunks: UIMessageChunk[]) {
  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk)
      }

      controller.close()
    },
  })
}

async function readAll(stream: ReadableStream<UIMessageChunk>) {
  const chunks: UIMessageChunk[] = []
  const reader = stream.getReader()

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      return chunks
    }

    chunks.push(value)
  }
}

function createSearchStepChunks(toolCallId: string): UIMessageChunk[] {
  return [
    { type: 'start-step' },
    {
      type: 'tool-input-available',
      toolCallId,
      toolName: SEARCH_TOOL_NAME,
      input: { query: `query ${toolCallId}` },
    },
    {
      type: 'tool-output-available',
      toolCallId,
      output: {
        provider: 'brave',
        results: [{
          title: `Title ${toolCallId}`,
          url: `https://example.com/${toolCallId}`,
          snippet: `Snippet ${toolCallId}`,
        }],
      },
    },
    { type: 'finish-step' },
  ]
}

function createTextChunks(text: string): UIMessageChunk[] {
  return [
    { type: 'text-start', id: 'answer' },
    { type: 'text-delta', id: 'answer', delta: text },
    { type: 'text-end', id: 'answer' },
  ]
}

function createGuarantee(input: {
  chunks: UIMessageChunk[]
  continuationChunks?: UIMessageChunk[]
}) {
  const startContinuation = vi.fn(() => ({
    stream: createStream(input.continuationChunks ?? []),
    settle: async () => ({
      usage: createUsage(10, 20),
      steps: [{ usage: createUsage(10, 20) }],
      finishReason: 'stop' as const,
    }),
  }))
  const buildFinishMessageMetadata = vi.fn(() => ({ usage: 'combined' }))
  const guarantee = withSearchAnswerGuarantee({
    stream: createStream(input.chunks),
    followUpToolNames: new Set([SEARCH_TOOL_NAME]),
    forcedStepIndex: FORCED_STEP_INDEX,
    startContinuation,
    buildFinishMessageMetadata,
  })

  return { guarantee, startContinuation, buildFinishMessageMetadata }
}

describe('buildSearchResultsContext', () => {
  it('renders each query with its result titles, URLs and snippets', () => {
    const context = buildSearchResultsContext([{
      toolName: SEARCH_TOOL_NAME,
      input: { query: 'besidka release' },
      output: {
        provider: 'brave',
        results: [{
          title: 'Release notes',
          url: 'https://example.com/notes',
          snippet: 'Version 2 shipped.',
        }],
      },
    }])

    expect(context).toContain('Search 1: besidka release')
    expect(context).toContain('1. Release notes')
    expect(context).toContain('URL: https://example.com/notes')
    expect(context).toContain('Version 2 shipped.')
  })

  it('renders a failed search and an opaque output without throwing', () => {
    const context = buildSearchResultsContext([
      {
        toolName: SEARCH_TOOL_NAME,
        input: { query: 'first' },
        errorText: 'Brave returned 429',
      },
      {
        toolName: 'web_search',
        input: { query: 'second' },
        output: 'x'.repeat(SEARCH_ANSWER_OPAQUE_OUTPUT_MAX_CHARS * 2),
      },
    ])

    expect(context).toContain('The search failed: Brave returned 429')
    expect(context.length)
      .toBeLessThan(SEARCH_ANSWER_OPAQUE_OUTPUT_MAX_CHARS + 500)
  })

  it('caps the number of rendered results', () => {
    const results = Array.from({ length: 60 }, (_, index) => ({
      title: `Result ${index}`,
      url: `https://example.com/${index}`,
      snippet: 'Snippet',
    }))
    const context = buildSearchResultsContext([{
      toolName: SEARCH_TOOL_NAME,
      input: { query: 'many' },
      output: { results },
    }])

    expect(context).toContain(`Result ${SEARCH_ANSWER_CONTEXT_MAX_RESULTS - 1}`)
    expect(context).not.toContain(`Result ${SEARCH_ANSWER_CONTEXT_MAX_RESULTS}\n`)
    expect(context).toContain('(Further search results omitted.)')
  })
})

describe('buildSearchAnswerContinuationMessages', () => {
  const searchResults = [{
    toolName: SEARCH_TOOL_NAME,
    input: { query: 'q' },
    output: { results: [] },
  }]

  it('appends the context to the final user message instead of adding a '
    + 'second user turn', () => {
    const messages = buildSearchAnswerContinuationMessages([
      { role: 'user', content: 'Earlier question' },
      { role: 'assistant', content: 'Earlier answer' },
      { role: 'user', content: 'What shipped?' },
    ], searchResults)
    const lastMessage = messages.at(-1)

    expect(messages).toHaveLength(3)
    expect(lastMessage?.role).toBe('user')
    expect(lastMessage?.content).toEqual([
      { type: 'text', text: 'What shipped?' },
      {
        type: 'text',
        text: expect.stringContaining('Answer the user\'s last message now'),
      },
    ])
  })

  it('strips earlier turns\' tool calls and results', () => {
    const messages = buildSearchAnswerContinuationMessages([
      { role: 'user', content: 'Earlier question' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: SEARCH_TOOL_NAME,
            input: { query: 'q' },
          },
          { type: 'text', text: 'Earlier answer' },
        ],
      },
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call-1',
          toolName: SEARCH_TOOL_NAME,
          output: { type: 'json', value: {} },
        }],
      },
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolCallId: 'call-2',
          toolName: SEARCH_TOOL_NAME,
          input: { query: 'q' },
        }],
      },
      { role: 'user', content: 'What shipped?' },
    ], searchResults)

    expect(messages.map(message => message.role))
      .toEqual(['user', 'assistant', 'user'])
    expect(messages[1]?.content).toEqual([
      { type: 'text', text: 'Earlier answer' },
    ])
  })

  it('adds a user message when the history does not end with one', () => {
    const messages = buildSearchAnswerContinuationMessages([
      { role: 'assistant', content: 'Earlier answer' },
    ], searchResults)

    expect(messages).toHaveLength(2)
    expect(messages.at(-1)?.role).toBe('user')
  })
})

describe('withSearchAnswerGuarantee', () => {
  it('passes a turn that answered through unchanged', async () => {
    const finish: UIMessageChunk = {
      type: 'finish',
      finishReason: 'stop',
      messageMetadata: { usage: 'loop' },
    }
    const { guarantee, startContinuation } = createGuarantee({
      chunks: [
        ...createSearchStepChunks('call-1'),
        { type: 'start-step' },
        ...createTextChunks('Answer'),
        { type: 'finish-step' },
        finish,
      ],
    })
    const chunks = await readAll(guarantee.stream)

    expect(startContinuation).not.toHaveBeenCalled()
    expect(chunks.at(-1)).toBe(finish)
    expect(guarantee.getOutcome()).toEqual(expect.objectContaining({
      stepsCount: 2,
      continuationRan: false,
      finishReason: 'stop',
    }))
  })

  it('streams the continuation after the loop and closes with one finish '
    + 'carrying the combined metadata', async () => {
    const { guarantee, startContinuation, buildFinishMessageMetadata }
      = createGuarantee({
        chunks: [
          ...createSearchStepChunks('call-1'),
          { type: 'start-step' },
          { type: 'finish-step' },
          { type: 'finish', finishReason: 'stop' },
        ],
        continuationChunks: createTextChunks('Continuation answer'),
      })
    const chunks = await readAll(guarantee.stream)
    const textIndex = chunks.findIndex(chunk => chunk.type === 'text-delta')
    const outputIndex = chunks.findIndex((chunk) => {
      return chunk.type === 'tool-output-available'
    })

    expect(startContinuation).toHaveBeenCalledWith([
      expect.objectContaining({
        toolName: SEARCH_TOOL_NAME,
        input: { query: 'query call-1' },
      }),
    ])
    expect(textIndex).toBeGreaterThan(outputIndex)
    expect(chunks.filter(chunk => chunk.type === 'finish')).toEqual([{
      type: 'finish',
      finishReason: 'stop',
      messageMetadata: { usage: 'combined' },
    }])
    expect(buildFinishMessageMetadata).toHaveBeenCalledTimes(1)
    expect(guarantee.getOutcome()).toEqual(expect.objectContaining({
      continuationRan: true,
      continuationProducedText: true,
    }))
  })

  it('drops a forced-step error once the continuation answers', async () => {
    const { guarantee } = createGuarantee({
      chunks: [
        ...createSearchStepChunks('call-1'),
        ...createSearchStepChunks('call-2'),
        ...createSearchStepChunks('call-3'),
        { type: 'error', errorText: 'tools required' },
      ],
      continuationChunks: createTextChunks('Recovered'),
    })
    const chunks = await readAll(guarantee.stream)

    expect(chunks.map(chunk => chunk.type)).not.toContain('error')
    expect(chunks.at(-1)?.type).toBe('finish')
  })

  it('releases the held error and finish when the continuation is empty',
    async () => {
      const finish: UIMessageChunk = { type: 'finish', finishReason: 'error' }
      const { guarantee } = createGuarantee({
        chunks: [
          ...createSearchStepChunks('call-1'),
          ...createSearchStepChunks('call-2'),
          ...createSearchStepChunks('call-3'),
          { type: 'error', errorText: 'tools required' },
          { type: 'finish-step' },
          finish,
        ],
      })
      const chunks = await readAll(guarantee.stream)
      const types = chunks.map(chunk => chunk.type)

      expect(types.slice(-2)).toEqual(['error', 'finish'])
      expect(guarantee.getOutcome()).toEqual(expect.objectContaining({
        continuationRan: true,
        continuationProducedText: false,
      }))
    })

  it('never runs a continuation after an error before the forced step',
    async () => {
      const { guarantee, startContinuation } = createGuarantee({
        chunks: [
          ...createSearchStepChunks('call-1'),
          { type: 'error', errorText: 'provider unavailable' },
        ],
      })
      const chunks = await readAll(guarantee.stream)

      expect(startContinuation).not.toHaveBeenCalled()
      expect(chunks.at(-1)?.type).toBe('error')
    })

  it('never forwards the continuation\'s own abort or error chunks',
    async () => {
      const { guarantee } = createGuarantee({
        chunks: [
          ...createSearchStepChunks('call-1'),
          { type: 'finish', finishReason: 'stop' },
        ],
        continuationChunks: [
          ...createTextChunks('Partial'),
          { type: 'error', errorText: 'stream failed' },
          { type: 'abort', reason: 'timeout' },
        ],
      })
      const chunks = await readAll(guarantee.stream)
      const types = chunks.map(chunk => chunk.type)

      expect(types).not.toContain('abort')
      expect(types).not.toContain('error')
      expect(types.at(-1)).toBe('finish')
      expect(guarantee.getOutcome().continuationError).toBe('timeout')
    })

  it('records a tool call issued on the forced step', async () => {
    const { guarantee } = createGuarantee({
      chunks: [
        ...createSearchStepChunks('call-1'),
        ...createSearchStepChunks('call-2'),
        ...createSearchStepChunks('call-3'),
        ...createSearchStepChunks('call-4'),
        { type: 'finish', finishReason: 'tool-calls' },
      ],
      continuationChunks: createTextChunks('Answer'),
    })

    await readAll(guarantee.stream)

    expect(guarantee.getOutcome().forcedStepToolCall).toBe(true)
  })
})

import { readUIMessageStream, streamText } from 'ai'
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test'
import { describe, expect, it, vi } from 'vitest'
import { finalizeCodeExecutionParts } from '~~/server/utils/code-execution/message-parts'
import { createProviderResourceTracker } from '~~/server/utils/code-execution/provider-cleanup'
import { createCodeExecutionStream } from '~~/server/utils/code-execution/stream'

const containerCitation = {
  type: 'container_file_citation',
  container_id: 'cntr_6a1b2c3d4e5f',
  file_id: 'cfile_9f8e7d6c5b4a',
  filename: 'cities.csv',
  start_index: 10,
  end_index: 20,
}

function createModel() {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 'msg_1' },
        { type: 'text-delta', id: 'msg_1', delta: 'Saved cities.csv.' },
        {
          type: 'text-end',
          id: 'msg_1',
          citations: [{
            source: {
              type: 'source',
              sourceType: 'document',
              id: 'source-1',
              mediaType: 'text/plain',
              title: 'cities.csv',
              filename: 'cities.csv',
              providerMetadata: {
                openai: {
                  type: 'container_file_citation',
                  fileId: 'cfile_9f8e7d6c5b4a',
                  containerId: 'cntr_6a1b2c3d4e5f',
                },
              },
            },
            startIndex: 10,
            endIndex: 20,
          }],
          providerMetadata: {
            openai: {
              itemId: 'msg_1',
              annotations: [containerCitation],
            },
          },
        },
        {
          type: 'finish',
          finishReason: { unified: 'stop', raw: 'stop' },
          usage: {
            inputTokens: { total: 1, noCache: 1 },
            outputTokens: { total: 1, text: 1 },
          },
        },
      ] as never),
    }),
  })
}

describe('OpenAI container citations in a real AI SDK stream', () => {
  it('never reach the client stream or the stored message', async () => {
    const result = streamText({
      model: createModel(),
      messages: [{ role: 'user', content: 'save the cities' }],
    })
    const logger = { set: vi.fn() }
    const tracker = createProviderResourceTracker({
      provider: 'openai',
      apiKey: 'k',
      logger,
      fetcher: vi.fn(async () => new Response(null, { status: 204 })) as never,
    })
    const codeExecution = createCodeExecutionStream({
      provider: 'openai',
      modelId: 'gpt-5.4-nano',
      userId: 1,
      apiKey: 'k',
      filesEnabled: false,
      tracker,
      rates: {
        openaiPerSessionUsd: undefined,
        anthropicPerHourUsd: undefined,
        anthropicFreeHoursPerMonth: undefined,
      },
      logger,
    })
    const chunks: unknown[] = []
    const upstream = result.toUIMessageStream({ sendSources: true })
    const guarded = codeExecution.apply(upstream as never)
    const [forClient, forStorage] = guarded.tee()
    const reader = forClient.getReader()

    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      chunks.push(value)
    }

    let message
    for await (const next of readUIMessageStream({ stream: forStorage })) {
      message = next
    }

    const stored = finalizeCodeExecutionParts(message!.parts)

    for (const serialized of [JSON.stringify(chunks), JSON.stringify(stored)]) {
      expect(serialized).not.toContain('cfile_')
      expect(serialized).not.toContain('cntr_')
      expect(serialized).not.toContain('container_file_citation')
    }

    expect(JSON.stringify(stored)).toContain('Saved cities.csv.')
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { UIMessageChunk } from 'ai'
import {
  DEEPSEEK_CHUNK_TIMEOUT_MS,
  DEEPSEEK_FIRST_CHUNK_TIMEOUT_MS,
  resolveStreamTimeout,
  stallErrorCodeOf,
  withVisibleTimeoutErrors,
} from '~~/server/utils/ai/stream-stall'
import { GENERATION_STOPPED_REASON } from '~~/server/utils/chats/generation-lease'

async function collect(
  chunks: UIMessageChunk[],
  toErrorText = vi.fn((code: string) => `error:${code}`),
) {
  const stream = new ReadableStream<UIMessageChunk>({
    start(controller) {
      chunks.forEach(chunk => controller.enqueue(chunk))
      controller.close()
    },
  })
  const output: UIMessageChunk[] = []

  for await (const chunk of withVisibleTimeoutErrors(stream, toErrorText)) {
    output.push(chunk)
  }

  return { output, toErrorText }
}

describe('resolveStreamTimeout', () => {
  it('adds first-chunk and chunk timeouts for direct DeepSeek only', () => {
    const base = { totalMs: 540_000, toolMs: 60_000 }

    expect(resolveStreamTimeout({ providerId: 'deepseek', base })).toEqual({
      ...base,
      firstChunkMs: DEEPSEEK_FIRST_CHUNK_TIMEOUT_MS,
      chunkMs: DEEPSEEK_CHUNK_TIMEOUT_MS,
    })
    expect(resolveStreamTimeout({ providerId: 'deepseek' })).toEqual({
      firstChunkMs: DEEPSEEK_FIRST_CHUNK_TIMEOUT_MS,
      chunkMs: DEEPSEEK_CHUNK_TIMEOUT_MS,
    })
    expect(resolveStreamTimeout({ providerId: 'openai', base })).toBe(base)
    expect(resolveStreamTimeout({ providerId: undefined })).toBeUndefined()
  })
})

describe('stallErrorCodeOf', () => {
  it('reads a first-chunk timeout as queued, a chunk timeout as stalled and '
    + 'anything else as the time limit', () => {
    expect(stallErrorCodeOf('First chunk timeout of 120000ms exceeded'))
      .toBe('provider-queued')
    expect(stallErrorCodeOf('Chunk timeout of 90000ms exceeded'))
      .toBe('provider-stalled')
    expect(stallErrorCodeOf('signal timed out'))
      .toBe('generation-time-limit')
    expect(stallErrorCodeOf(undefined)).toBe('generation-time-limit')
  })
})

describe('withVisibleTimeoutErrors', () => {
  it('turns an abort into an error chunk the client shows', async () => {
    const { output, toErrorText } = await collect([
      { type: 'start' },
      { type: 'text-start', id: 't1' },
      { type: 'abort', reason: 'First chunk timeout of 120000ms exceeded' },
    ])

    expect(output).toEqual([
      { type: 'start' },
      { type: 'text-start', id: 't1' },
      { type: 'error', errorText: 'error:provider-queued' },
    ])
    expect(toErrorText).toHaveBeenCalledWith(
      'provider-queued',
      'First chunk timeout of 120000ms exceeded',
    )
  })

  it('keeps the abort of a run the user stopped', async () => {
    const { output, toErrorText } = await collect([
      { type: 'start' },
      { type: 'abort', reason: GENERATION_STOPPED_REASON },
    ])

    expect(output).toEqual([
      { type: 'start' },
      { type: 'abort', reason: GENERATION_STOPPED_REASON },
    ])
    expect(toErrorText).not.toHaveBeenCalled()
  })

  it('passes every other chunk through unchanged', async () => {
    const chunks: UIMessageChunk[] = [
      { type: 'start' },
      { type: 'finish' },
    ]
    const { output, toErrorText } = await collect(chunks)

    expect(output).toEqual(chunks)
    expect(toErrorText).not.toHaveBeenCalled()
  })
})

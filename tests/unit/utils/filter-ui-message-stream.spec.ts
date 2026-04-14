import { describe, expect, it } from 'vitest'
import { filterRecoverableUIMessageStreamErrors } from '../../../server/utils/chats/filter-ui-message-stream'

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

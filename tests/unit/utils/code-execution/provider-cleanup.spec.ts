import { describe, expect, it, vi } from 'vitest'
import { createProviderResourceTracker } from '~~/server/utils/code-execution/provider-cleanup'

function createTracker(
  provider: 'anthropic' | 'openai' | 'google',
  fetcher: ReturnType<typeof vi.fn>,
) {
  const logger = { set: vi.fn() }
  const tracker = createProviderResourceTracker({
    provider,
    apiKey: 'sk-user-key',
    logger,
    fetcher: fetcher as unknown as typeof fetch,
  })

  return { logger, tracker }
}

describe('createProviderResourceTracker', () => {
  it('deletes every tracked Anthropic file with the user key and logs the counts', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }))
    const { logger, tracker } = createTracker('anthropic', fetcher)

    tracker.trackFile('file_upload')
    tracker.trackFile('file_output')

    const summary = await tracker.cleanup()

    expect(summary).toEqual({ deleted: 2, alreadyGone: 0, failed: 0 })
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://api.anthropic.com/v1/files/file_upload',
      'https://api.anthropic.com/v1/files/file_output',
    ])
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'DELETE',
      headers: { 'x-api-key': 'sk-user-key' },
    })
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        codeExecutionCleanup: {
          provider: 'anthropic',
          deleted: 2,
          alreadyGone: 0,
          failed: 0,
        },
      },
    })
    expect(JSON.stringify(logger.set.mock.calls)).not.toContain('file_upload')
    expect(JSON.stringify(logger.set.mock.calls)).not.toContain('sk-user-key')
  })

  it('deletes OpenAI input files and the container', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }))
    const { tracker } = createTracker('openai', fetcher)

    tracker.trackFile('file_input')
    tracker.trackContainer('cntr_1')
    await tracker.cleanup()

    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://api.openai.com/v1/files/file_input',
      'https://api.openai.com/v1/containers/cntr_1',
    ])
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({
      method: 'DELETE',
      headers: { Authorization: 'Bearer sk-user-key' },
    })
  })

  it('counts a 404 as already gone and a failure as failed, and keeps going', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const { tracker } = createTracker('anthropic', fetcher)

    for (const fileId of ['file_a', 'file_b', 'file_c', 'file_d']) {
      tracker.trackFile(fileId)
    }

    expect(await tracker.cleanup()).toEqual({
      deleted: 1,
      alreadyGone: 1,
      failed: 2,
    })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('runs once: a second cleanup deletes nothing', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }))
    const { tracker } = createTracker('anthropic', fetcher)

    tracker.trackFile('file_a')

    expect(tracker.hasPending()).toBe(true)

    await tracker.cleanup()
    await tracker.cleanup()

    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(tracker.hasPending()).toBe(false)
  })

  it('ignores unsafe ids and tracks no container for Anthropic', async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }))
    const { tracker } = createTracker('anthropic', fetcher)

    tracker.trackFile('../../v1/organizations')
    tracker.trackContainer('cntr_1')

    expect(tracker.hasPending()).toBe(false)
    await tracker.cleanup()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('has nothing to delete for Gemini', async () => {
    const fetcher = vi.fn()
    const { tracker } = createTracker('google', fetcher)

    tracker.trackFile('file_a')
    await tracker.cleanup()

    expect(fetcher).not.toHaveBeenCalled()
  })
})

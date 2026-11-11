import { describe, expect, it, vi } from 'vitest'
import {
  INPUT_FILE_EXPIRY_SECONDS,
  selectInputFiles,
  uploadInputFiles,
} from '~~/server/utils/code-execution/input-files'

function createTracker() {
  return {
    trackFile: vi.fn(),
    trackContainer: vi.fn(),
    hasPending: vi.fn(),
    cleanup: vi.fn(),
  }
}

const file = {
  name: 'data.csv',
  mediaType: 'text/csv',
  bytes: new TextEncoder().encode('a,b\n1,2\n'),
}

describe('uploadInputFiles', () => {
  it('uploads to Anthropic with a one hour expiry and tracks the id for deletion', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ id: 'file_in_1' }), { status: 200 })
    })
    const tracker = createTracker()
    const uploaded = await uploadInputFiles({
      provider: 'anthropic',
      apiKey: 'user-key',
      files: [file],
      tracker,
      logger: { set: vi.fn() },
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(uploaded).toEqual([{
      fileId: 'file_in_1',
      name: 'data.csv',
      mediaType: 'text/csv',
    }])
    expect(tracker.trackFile).toHaveBeenCalledWith('file_in_1')
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.anthropic.com/v1/files')

    const init = fetcher.mock.calls[0]?.[1] as RequestInit
    const form = init.body as FormData

    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(form.get('expires_in_seconds')).toBe(String(INPUT_FILE_EXPIRY_SECONDS))
    expect(INPUT_FILE_EXPIRY_SECONDS).toBe(3600)
    expect((form.get('file') as File).name).toBe('data.csv')
  })

  it('uploads to OpenAI with an expiry and tracks the id', async () => {
    const fetcher = vi.fn(async () => {
      return new Response(JSON.stringify({ id: 'file-oa-1' }), { status: 200 })
    })
    const tracker = createTracker()

    await uploadInputFiles({
      provider: 'openai',
      apiKey: 'user-key',
      files: [file],
      tracker,
      logger: { set: vi.fn() },
      fetcher: fetcher as unknown as typeof fetch,
    })

    const form = (fetcher.mock.calls[0]?.[1] as RequestInit).body as FormData

    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.openai.com/v1/files')
    expect(form.get('purpose')).toBe('user_data')
    expect(form.get('expires_after[seconds]')).toBe('3600')
    expect(tracker.trackFile).toHaveBeenCalledWith('file-oa-1')
  })

  it('never uploads for Gemini', async () => {
    const fetcher = vi.fn()

    expect(await uploadInputFiles({
      provider: 'google',
      apiKey: 'k',
      files: [file],
      tracker: createTracker(),
      logger: { set: vi.fn() },
      fetcher: fetcher as unknown as typeof fetch,
    })).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('skips a file whose upload fails and keeps the others', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('no', { status: 400 }))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'file_ok' }), { status: 200 }),
      )
    const tracker = createTracker()
    const uploaded = await uploadInputFiles({
      provider: 'anthropic',
      apiKey: 'k',
      files: [file, file, file],
      tracker,
      logger: { set: vi.fn() },
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(uploaded.map(entry => entry.fileId)).toEqual(['file_ok'])
    expect(tracker.trackFile).toHaveBeenCalledTimes(1)
  })
})

describe('selectInputFiles', () => {
  it('takes at most 10 files', () => {
    const files = Array.from({ length: 14 }, () => ({
      bytes: new Uint8Array(1),
    }))

    expect(selectInputFiles(files)).toHaveLength(10)
  })

  it('skips a file that would take the total over 20 MB', () => {
    const big = { bytes: new Uint8Array(15 * 1024 * 1024) }
    const small = { bytes: new Uint8Array(1024) }

    expect(selectInputFiles([big, big, small])).toEqual([big, small])
  })
})

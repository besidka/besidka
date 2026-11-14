import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStorageFullError } from '~~/server/utils/storage/errors'

const mocks = vi.hoisted(() => ({
  persistFile: vi.fn(),
  checkContainerDocument: vi.fn(),
}))

vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: mocks.persistFile,
}))

vi.mock('~~/server/utils/code-execution/document-validation', () => ({
  checkContainerDocument: mocks.checkContainerDocument,
}))

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
const pdf = new TextEncoder().encode('%PDF-1.7\n')

function createTracker() {
  return {
    trackFile: vi.fn(),
    trackContainer: vi.fn(),
    hasPending: vi.fn(),
    cleanup: vi.fn(),
  }
}

type FetchedFiles = Record<string, { name: string, bytes: Uint8Array }>

function createFetcher(files: FetchedFiles) {
  return vi.fn(async (url: string | URL | Request) => {
    const address = String(url)
    const fileId = address.split('/files/')[1]?.split('/')[0] ?? ''
    const file = files[fileId]

    if (!file) {
      return new Response(null, { status: 404 })
    }

    if (address.endsWith('/content')) {
      return new Response(file.bytes)
    }

    return new Response(JSON.stringify({
      filename: file.name,
      size_bytes: file.bytes.byteLength,
    }))
  })
}

async function run(options: {
  files: FetchedFiles
  remainingFileSlots?: number
}) {
  const { persistContainerFiles } = await import(
    '~~/server/utils/code-execution/persist-container-files'
  )
  const tracker = createTracker()
  const result = await persistContainerFiles({
    refs: Object.keys(options.files).map((fileId) => {
      return { provider: 'anthropic' as const, fileId }
    }),
    provider: 'anthropic',
    modelId: 'claude-haiku-5-5',
    userId: 7,
    apiKey: 'user-key',
    remainingFileSlots: options.remainingFileSlots ?? 10,
    tracker,
    logger: { set: vi.fn() },
    fetcher: createFetcher(options.files) as unknown as typeof fetch,
  })

  return { result, tracker }
}

describe('persistContainerFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.persistFile.mockImplementation(async (input) => {
      return {
        id: `row-${input.fileName}`,
        storageKey: `key-${input.fileName}`,
        size: input.fileData.byteLength,
      }
    })
    mocks.checkContainerDocument.mockImplementation(async (input) => {
      return { ok: true, bytes: input.bytes, provenance: 'ai' }
    })
  })

  it('saves an allowed image as a private assistant file with provenance and the generated marker', async () => {
    const { result, tracker } = await run({
      files: { file_1: { name: 'chart.png', bytes: png } },
    })

    expect(result.skipped).toEqual([])
    expect(result.saved).toEqual([{
      fileId: 'row-chart.png',
      url: '/files/key-chart.png?generated=1',
      filename: 'chart.png',
      mediaType: 'image/png',
      bytes: expect.any(Number),
    }])
    expect(mocks.persistFile).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      fileName: 'chart.png',
      mediaType: 'image/png',
      source: 'assistant',
      originProvider: 'anthropic',
      originModel: 'claude-haiku-5-5',
    }))
    expect(tracker.trackFile).toHaveBeenCalledWith('file_1')
  })

  it('skips a disallowed type, a type that lies about its bytes, and a download that fails', async () => {
    const { result } = await run({
      files: {
        file_svg: { name: 'logo.svg', bytes: new TextEncoder().encode('<svg/>') },
        file_fake: { name: 'fake.png', bytes: pdf },
        file_ok: { name: 'chart.png', bytes: png },
      },
    })

    expect(result.saved.map(file => file.filename)).toEqual(['chart.png'])
    expect(result.skipped).toEqual([
      { filename: 'logo.svg', reason: 'type-not-allowed' },
      { filename: 'fake.png', reason: 'type-not-allowed' },
    ])
    expect(mocks.persistFile).toHaveBeenCalledTimes(1)
  })

  it('runs PDF and Office files through the document validation seam and skips a rejected one', async () => {
    mocks.checkContainerDocument.mockResolvedValueOnce({
      ok: false,
      code: 'pdf_action',
    })

    const { result } = await run({
      files: { file_pdf: { name: 'report.pdf', bytes: pdf } },
    })

    expect(mocks.checkContainerDocument).toHaveBeenCalledWith({
      format: 'pdf',
      bytes: pdf,
      model: 'claude-haiku-5-5',
    })
    expect(result.saved).toEqual([])
    expect(result.skipped).toEqual([
      { filename: 'report.pdf', reason: 'validation-failed' },
    ])
    expect(mocks.persistFile).not.toHaveBeenCalled()
  })

  it('stores the stamped bytes and counts a file whose provenance could not be added', async () => {
    const stamped = new TextEncoder().encode('%PDF-1.7\nstamped')

    mocks.checkContainerDocument.mockResolvedValueOnce({
      ok: true,
      bytes: stamped,
      provenance: 'missing',
    })

    const { result } = await run({
      files: { file_pdf: { name: 'report.pdf', bytes: pdf } },
    })

    expect(result.provenanceMissing).toBe(1)
    expect(mocks.persistFile.mock.calls[0]?.[0].fileData).toBe(stamped)
  })

  it('stops at the file limit and says so', async () => {
    const { result } = await run({
      files: {
        file_a: { name: 'a.png', bytes: png },
        file_b: { name: 'b.png', bytes: png },
      },
      remainingFileSlots: 1,
    })

    expect(result.saved.map(file => file.filename)).toEqual(['a.png'])
    expect(result.skipped).toEqual([
      { filename: 'file', reason: 'limit-reached' },
    ])
  })

  it('reports a storage failure per file and keeps going', async () => {
    mocks.persistFile
      .mockRejectedValueOnce(createStorageFullError({
        usedBytes: 20,
        totalBytes: 20,
      }))
      .mockResolvedValueOnce({ id: 'row-b', storageKey: 'key-b', size: 9 })

    const { result } = await run({
      files: {
        file_a: { name: 'a.png', bytes: png },
        file_b: { name: 'b.png', bytes: png },
      },
    })

    expect(result.skipped).toEqual([
      { filename: 'a.png', reason: 'storage-failed' },
    ])
    expect(result.saved.map(file => file.filename)).toEqual(['b.png'])
  })

  it('keeps the files already stored when a later file throws unexpectedly', async () => {
    mocks.checkContainerDocument.mockRejectedValueOnce(new Error('boom'))

    const { result } = await run({
      files: {
        file_a: { name: 'a.png', bytes: png },
        file_b: { name: 'b.pdf', bytes: pdf },
        file_c: { name: 'c.png', bytes: png },
      },
    })

    expect(result.saved.map(file => file.filename)).toEqual([
      'a.png',
      'c.png',
    ])
    expect(result.skipped).toEqual([
      { filename: 'file', reason: 'validation-failed' },
    ])
  })

  it('downloads one file at a time', async () => {
    let active = 0
    let peak = 0
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active -= 1

      return String(url).endsWith('/content')
        ? new Response(png)
        : new Response(JSON.stringify({ filename: 'x.png', size_bytes: 9 }))
    })
    const { persistContainerFiles } = await import(
      '~~/server/utils/code-execution/persist-container-files'
    )

    await persistContainerFiles({
      refs: ['file_a', 'file_b', 'file_c'].map((fileId) => {
        return { provider: 'anthropic' as const, fileId }
      }),
      provider: 'anthropic',
      modelId: 'm',
      userId: 1,
      apiKey: 'k',
      remainingFileSlots: 10,
      tracker: createTracker(),
      logger: { set: vi.fn() },
      fetcher: fetcher as unknown as typeof fetch,
    })

    expect(peak).toBe(1)
  })
})

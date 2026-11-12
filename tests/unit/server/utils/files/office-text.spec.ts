import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OFFICE_MEDIA_TYPES,
  OFFICE_TEXT_MAX_BYTES,
} from '~~/shared/utils/office-files'

const mocks = vi.hoisted(() => ({
  extractOfficeText: vi.fn(),
}))

vi.mock('~~/server/utils/documents/renderer', () => ({
  extractOfficeText: mocks.extractOfficeText,
}))

const {
  ensureOfficeTextState,
  extractAndStoreOfficeText,
  loadOfficeText,
  needsOfficeTextExtraction,
  truncateUtf8,
} = await import('~~/server/utils/files/office-text')

const DOCX = OFFICE_MEDIA_TYPES.docx

function readyResult(text: string) {
  return {
    status: 'ready',
    text,
    truncated: false,
    stats: {
      inputBytes: 1,
      entries: 1,
      textBytes: new TextEncoder().encode(text).byteLength,
      truncations: [],
    },
  }
}

describe('truncateUtf8', () => {
  it('returns short text unchanged', () => {
    expect(truncateUtf8('héllo', 100)).toEqual({
      text: 'héllo',
      bytes: 6,
      truncated: false,
    })
  })

  it('never splits a multi-byte character', () => {
    for (let limit = 0; limit <= 12; limit += 1) {
      const cut = truncateUtf8('a€b€c€d€', limit)

      expect(cut.bytes).toBeLessThanOrEqual(limit)
      expect(cut.text).not.toContain('�')
      expect(new TextEncoder().encode(cut.text).byteLength).toBe(cut.bytes)
    }
  })

  it('marks cut text as truncated', () => {
    expect(truncateUtf8('abcdef', 3)).toEqual({
      text: 'abc',
      bytes: 3,
      truncated: true,
    })
  })
})

describe('needsOfficeTextExtraction', () => {
  it('asks for an Office file with no status or an older version', () => {
    expect(needsOfficeTextExtraction({ type: DOCX, textStatus: null }))
      .toBe(true)
    expect(needsOfficeTextExtraction({ type: DOCX })).toBe(true)
    expect(needsOfficeTextExtraction({
      type: DOCX,
      textStatus: 'ready',
      textVersion: 0,
    })).toBe(true)
  })

  it('leaves a current status alone, failures included', () => {
    for (const textStatus of ['ready', 'empty', 'failed', 'too_large']) {
      expect(needsOfficeTextExtraction({
        type: DOCX,
        textStatus,
        textVersion: 1,
      })).toBe(false)
    }
  })

  it('never asks for a file that is not Office', () => {
    expect(needsOfficeTextExtraction({ type: 'text/plain' })).toBe(false)
    expect(needsOfficeTextExtraction({ type: 'image/png' })).toBe(false)
  })
})

describe('extractAndStoreOfficeText', () => {
  let put: ReturnType<typeof vi.fn>
  let updateSet: ReturnType<typeof vi.fn>
  const logger = { set: vi.fn() }

  function input() {
    return {
      fileId: 'f1',
      userId: 1,
      storageKey: 'k.docx',
      mediaType: DOCX,
      bytes: new Uint8Array([1]),
      logger,
    }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    put = vi.fn().mockResolvedValue({ key: 'k' })
    updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))
    vi.stubGlobal('useFileStorage', () => ({ put, delete: vi.fn(), get: vi.fn() }))
    vi.stubGlobal('useDb', () => ({ update: vi.fn(() => ({ set: updateSet })) }))
  })

  it('stores the text and the state', async () => {
    mocks.extractOfficeText.mockResolvedValue(readyResult('hello'))

    await expect(extractAndStoreOfficeText(input())).resolves.toEqual({
      textStatus: 'ready',
      textBytes: 5,
      textVersion: 1,
    })
    expect(put.mock.calls[0]?.[0]).toBe('k.docx.text.md')
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        files: {
          officeText: expect.objectContaining({
            status: 'ready',
            textBytes: 5,
          }),
        },
      },
    })
  })

  it('never logs the extracted text', async () => {
    mocks.extractOfficeText.mockResolvedValue(readyResult('top secret text'))

    await extractAndStoreOfficeText(input())

    expect(JSON.stringify(logger.set.mock.calls)).not.toContain('top secret')
  })

  it('records an empty document without a sidecar', async () => {
    mocks.extractOfficeText.mockResolvedValue({
      ...readyResult(''),
      status: 'empty',
      errorCode: 'no_text',
    })

    await expect(extractAndStoreOfficeText(input())).resolves.toEqual({
      textStatus: 'empty',
      textBytes: null,
      textVersion: 1,
    })
    expect(put).not.toHaveBeenCalled()
  })

  it('records too_large when the text exceeds the sidecar limit', async () => {
    mocks.extractOfficeText.mockResolvedValue(
      readyResult('x'.repeat(OFFICE_TEXT_MAX_BYTES + 8 * 1024)),
    )

    await expect(extractAndStoreOfficeText(input())).resolves.toMatchObject({
      textStatus: 'too_large',
      textBytes: null,
    })
    expect(put).not.toHaveBeenCalled()
  })

  it('returns null for a media type that is not Office', async () => {
    await expect(extractAndStoreOfficeText({
      ...input(),
      mediaType: 'text/plain',
    })).resolves.toBeNull()
    expect(mocks.extractOfficeText).not.toHaveBeenCalled()
  })

  it('never throws', async () => {
    mocks.extractOfficeText.mockRejectedValue(new Error('boom'))

    await expect(extractAndStoreOfficeText(input())).resolves.toBeNull()
  })
})

describe('ensureOfficeTextState and loadOfficeText', () => {
  const logger = { set: vi.fn() }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('useDb', () => ({
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
      })),
    }))
  })

  it('returns the cached state without touching R2', async () => {
    const get = vi.fn()

    vi.stubGlobal('useFileStorage', () => ({ get }))

    await expect(ensureOfficeTextState({
      id: 'f1',
      userId: 1,
      storageKey: 'k.docx',
      type: DOCX,
      textStatus: 'failed',
      textBytes: null,
      textVersion: 1,
    }, logger)).resolves.toEqual({
      textStatus: 'failed',
      textBytes: null,
      textVersion: 1,
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('returns null when the file object is gone', async () => {
    vi.stubGlobal('useFileStorage', () => ({ get: vi.fn().mockResolvedValue(null) }))

    await expect(ensureOfficeTextState({
      id: 'f1',
      userId: 1,
      storageKey: 'k.docx',
      type: DOCX,
    }, logger)).resolves.toBeNull()
  })

  it('does not load text for a file that is not ready', async () => {
    vi.stubGlobal('useFileStorage', () => ({ get: vi.fn() }))

    await expect(loadOfficeText({
      id: 'f1',
      userId: 1,
      storageKey: 'k.docx',
      type: DOCX,
      textStatus: 'empty',
      textVersion: 1,
    }, logger)).resolves.toBeNull()
  })

  it('loads the sidecar text with its byte size', async () => {
    vi.stubGlobal('useFileStorage', () => ({
      get: vi.fn(async () => {
        const bytes = new TextEncoder().encode('héllo')

        return { arrayBuffer: async () => bytes.buffer }
      }),
    }))

    await expect(loadOfficeText({
      id: 'f1',
      userId: 1,
      storageKey: 'k.docx',
      type: DOCX,
      textStatus: 'ready',
      textVersion: 1,
    }, logger)).resolves.toEqual({ text: 'héllo', textBytes: 6 })
  })
})

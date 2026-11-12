import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createShareFile,
  ensureFileExtension,
  readContentDispositionFileName,
  shareFile,
  toShareableFile,
} from '../../../app/utils/file-share'

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument'
  + '.wordprocessingml.document'

function stubShare(options: {
  canShare: (data: ShareData) => boolean
  share?: () => Promise<void>
}) {
  const share = vi.fn(options.share ?? (async () => {}))
  const canShare = vi.fn(options.canShare)

  Object.defineProperty(navigator, 'share', {
    value: share,
    configurable: true,
  })
  Object.defineProperty(navigator, 'canShare', {
    value: canShare,
    configurable: true,
  })

  return { share, canShare }
}

describe('utils/file-share', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'share')
    Reflect.deleteProperty(navigator, 'canShare')
  })

  describe('readContentDispositionFileName', () => {
    it('prefers the UTF-8 encoded name', () => {
      expect(readContentDispositionFileName(
        'attachment; filename="Plan.docx"; filename*=UTF-8\'\'Pl%C3%A1n.docx',
      )).toBe('Plán.docx')
    })

    it('falls back to the quoted name', () => {
      expect(readContentDispositionFileName(
        'attachment; filename="Plan.docx"',
      )).toBe('Plan.docx')
    })

    it('returns an empty string without a header', () => {
      expect(readContentDispositionFileName(null)).toBe('')
    })
  })

  describe('ensureFileExtension', () => {
    it('keeps a name that already has an extension', () => {
      expect(ensureFileExtension('Plan.docx', DOCX_TYPE)).toBe('Plan.docx')
    })

    it('adds the extension of the media type to a bare name', () => {
      expect(ensureFileExtension('Plan', DOCX_TYPE)).toBe('Plan.docx')
      expect(ensureFileExtension('Photo', 'image/png')).toBe('Photo.png')
    })
  })

  describe('createShareFile', () => {
    it('names the file from the header and keeps the blob type', () => {
      const file = createShareFile(
        new Blob(['x'], { type: DOCX_TYPE }),
        'Card title',
        'Plan.docx',
      )

      expect(file.name).toBe('Plan.docx')
      expect(file.type).toBe(DOCX_TYPE)
    })

    it('adds an extension to the caller name when there is no header', () => {
      const file = createShareFile(
        new Blob(['x'], { type: DOCX_TYPE }),
        'Card title',
      )

      expect(file.name).toBe('Card title.docx')
    })

    it('uses the generic type for a blob without one', () => {
      const file = createShareFile(new Blob(['x']), 'Data')

      expect(file.type).toBe('application/octet-stream')
      expect(file.name).toBe('Data.bin')
    })
  })

  describe('toShareableFile', () => {
    it('returns the file when the browser accepts its type', () => {
      stubShare({ canShare: () => true })

      const file = new File(['x'], 'Plan.docx', { type: DOCX_TYPE })

      expect(toShareableFile(file)).toBe(file)
    })

    it('retries with the generic type when the real type is rejected', () => {
      stubShare({
        canShare: (data) => {
          return data.files?.[0]?.type === 'application/octet-stream'
        },
      })

      const shareable = toShareableFile(
        new File(['x'], 'Plan.docx', { type: DOCX_TYPE }),
      )

      expect(shareable?.name).toBe('Plan.docx')
      expect(shareable?.type).toBe('application/octet-stream')
    })

    it('returns null when no type is accepted', () => {
      stubShare({ canShare: () => false })

      expect(toShareableFile(new File(['x'], 'Plan.docx'))).toBeNull()
    })
  })

  describe('shareFile', () => {
    const file = new File(['x'], 'Plan.docx', { type: DOCX_TYPE })

    it('shares the file and reports it', async () => {
      const { share } = stubShare({ canShare: () => true })

      await expect(shareFile(file)).resolves.toBe('shared')
      expect(share).toHaveBeenCalledWith({ files: [file] })
    })

    it('reports a closed share sheet as cancelled', async () => {
      stubShare({
        canShare: () => true,
        share: async () => {
          throw new DOMException('closed', 'AbortError')
        },
      })

      await expect(shareFile(file)).resolves.toBe('cancelled')
    })

    it('reports an expired user gesture as needing a new one', async () => {
      stubShare({
        canShare: () => true,
        share: async () => {
          throw new DOMException('no gesture', 'NotAllowedError')
        },
      })

      await expect(shareFile(file)).resolves.toBe('needs-gesture')
    })

    it('reports a file the browser cannot share as unsupported', async () => {
      const { share } = stubShare({ canShare: () => false })

      await expect(shareFile(file)).resolves.toBe('unsupported')
      expect(share).not.toHaveBeenCalled()
    })

    it('rethrows an unexpected failure', async () => {
      stubShare({
        canShare: () => true,
        share: async () => {
          throw new Error('boom')
        },
      })

      await expect(shareFile(file)).rejects.toThrow('boom')
    })
  })
})

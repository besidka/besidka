import { beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { render } from '@besidka/doc-renderer/render'
import { parseDocumentSpec } from '@besidka/doc-renderer/spec'
import { getTextLossNote } from '~~/app/utils/file-delivery-hints'
import { loadReferenceAssets } from '~~/tests/setup/helpers/documents'
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
  OFFICE_OMITTED_COUNT_MAX,
  countOmittedOfficeContent,
  countOmittedOfficeEntries,
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

function buildZip(names: string[]): Uint8Array {
  const archive: Record<string, Uint8Array> = {}

  for (const name of names) {
    archive[name] = strToU8(name.endsWith('/') ? '' : 'x')
  }

  return zipSync(archive)
}

async function renderDocx(blocks: unknown[]): Promise<Uint8Array> {
  const parsed = parseDocumentSpec({
    specVersion: 1,
    format: 'docx',
    title: 'Report',
    blocks,
  })

  if (!parsed.ok) {
    throw new Error(JSON.stringify(parsed.issues))
  }

  return (await render(parsed.spec, loadReferenceAssets())).bytes
}

describe('countOmittedOfficeEntries', () => {
  it('counts images from every Office media folder', () => {
    expect(countOmittedOfficeEntries([
      'word/media/image1.png',
      'ppt/media/image2.jpeg',
      'xl/media/image3.gif',
    ])).toEqual({ media: 3, charts: 0 })
  })

  it('counts embedded objects with the images', () => {
    expect(countOmittedOfficeEntries([
      'word/media/image1.png',
      'word/embeddings/oleObject1.bin',
      'ppt/embeddings/Spec.pdf',
    ])).toEqual({ media: 3, charts: 0 })
  })

  it('does not count the data workbook behind a chart as an image', () => {
    expect(countOmittedOfficeEntries([
      'ppt/charts/chart1.xml',
      'ppt/embeddings/Microsoft_Excel_Sheet1.xlsx',
      'word/charts/chart1.xml',
      'word/embeddings/Microsoft_Excel_Sheet2.XLSX',
      'xl/embeddings/data.xlsm',
      'xl/embeddings/data.xlsb',
      'xl/embeddings/data.xls',
    ])).toEqual({ media: 0, charts: 2 })
  })

  it('still counts other embedded objects as media', () => {
    expect(countOmittedOfficeEntries([
      'word/embeddings/oleObject1.bin',
      'word/embeddings/Microsoft_Word_Document1.docx',
      'ppt/embeddings/Spec.pdf',
    ])).toEqual({ media: 3, charts: 0 })
  })

  it('counts charts and diagrams together as charts', () => {
    expect(countOmittedOfficeEntries([
      'word/charts/chart1.xml',
      'ppt/charts/chart2.xml',
      'xl/charts/chartEx1.xml',
      'word/diagrams/data1.xml',
      'ppt/diagrams/data2.xml',
    ])).toEqual({ media: 0, charts: 5 })
  })

  it('ignores chart helpers, relationships, folders and other roots', () => {
    expect(countOmittedOfficeEntries([
      'word/charts/_rels/chart1.xml.rels',
      'word/charts/style1.xml',
      'word/charts/colors1.xml',
      'word/diagrams/layout1.xml',
      'word/diagrams/drawing1.xml',
      'word/media/',
      'word/embeddings/',
      'docProps/thumbnail.jpeg',
      'customXml/media/image1.png',
      'word/document.xml',
      'ppt/slides/slide1.xml',
      'xl/worksheets/sheet1.xml',
    ])).toEqual({ media: 0, charts: 0 })
  })

  it('returns zero for no entries', () => {
    expect(countOmittedOfficeEntries([])).toEqual({ media: 0, charts: 0 })
  })

  it('caps each count', () => {
    const names = [
      ...Array.from({ length: 150 }, (_value, index) => {
        return `word/media/image${index}.png`
      }),
      ...Array.from({ length: 120 }, (_value, index) => {
        return `word/charts/chart${index}.xml`
      }),
    ]

    expect(countOmittedOfficeEntries(names)).toEqual({
      media: OFFICE_OMITTED_COUNT_MAX,
      charts: OFFICE_OMITTED_COUNT_MAX,
    })
  })
})

describe('countOmittedOfficeContent', () => {
  it('reads entry names from a ZIP built by hand', () => {
    const bytes = buildZip([
      'word/document.xml',
      'word/media/image1.png',
      'word/media/image2.png',
      'word/charts/chart1.xml',
    ])

    expect(countOmittedOfficeContent(bytes)).toEqual({ media: 2, charts: 1 })
  })

  it('gives a deck with one chart and no picture one chart and no image', () => {
    const bytes = buildZip([
      'ppt/presentation.xml',
      'ppt/slides/slide1.xml',
      'ppt/charts/chart1.xml',
      'ppt/charts/_rels/chart1.xml.rels',
      'ppt/charts/style1.xml',
      'ppt/charts/colors1.xml',
      'ppt/embeddings/Microsoft_Excel_Sheet1.xlsx',
    ])
    const counts = countOmittedOfficeContent(bytes)

    expect(counts).toEqual({ media: 0, charts: 1 })
    expect(getTextLossNote({
      type: 'pptx',
      textOmittedMedia: counts?.media,
      textOmittedCharts: counts?.charts,
    })?.label).toBe('1 chart not sent')
  })

  it('counts an image the renderer embedded', async () => {
    const bytes = await renderDocx([
      { type: 'paragraph', runs: [{ text: 'Revenue' }] },
      {
        type: 'image',
        fileId: 'chart-revenue.png',
        alt: 'Revenue chart',
        widthPercent: 50,
      },
    ])

    expect(countOmittedOfficeContent(bytes)).toEqual({ media: 1, charts: 0 })
  })

  it('counts nothing for a document without images', async () => {
    const bytes = await renderDocx([
      { type: 'paragraph', runs: [{ text: 'Plain text only' }] },
    ])

    expect(countOmittedOfficeContent(bytes)).toEqual({ media: 0, charts: 0 })
  })

  it('returns null for bytes that are not a ZIP', () => {
    expect(countOmittedOfficeContent(new Uint8Array([1, 2, 3]))).toBeNull()
  })
})

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
      textOmittedMedia: 0,
      textOmittedCharts: 0,
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

  it('stores what the text leaves out, counted from the ZIP', async () => {
    mocks.extractOfficeText.mockResolvedValue(readyResult('hello'))

    const state = await extractAndStoreOfficeText({
      ...input(),
      bytes: buildZip([
        'word/document.xml',
        'word/media/image1.png',
        'word/embeddings/oleObject1.bin',
        'word/charts/chart1.xml',
        'word/diagrams/data1.xml',
        'word/diagrams/data2.xml',
      ]),
    })

    expect(state).toMatchObject({
      textOmittedMedia: 2,
      textOmittedCharts: 3,
    })
    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      textOmittedMedia: 2,
      textOmittedCharts: 3,
    }))
  })

  it('stores zero when the archive cannot be read', async () => {
    mocks.extractOfficeText.mockResolvedValue(readyResult('hello'))

    await extractAndStoreOfficeText(input())

    expect(updateSet).toHaveBeenCalledWith(expect.objectContaining({
      textOmittedMedia: 0,
      textOmittedCharts: 0,
    }))
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        files: {
          officeText: expect.objectContaining({ omittedUnreadable: true }),
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
      textOmittedMedia: 0,
      textOmittedCharts: 0,
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
      textOmittedMedia: null,
      textOmittedCharts: null,
    })
    expect(get).not.toHaveBeenCalled()
  })

  it('returns stored counts without touching R2', async () => {
    const get = vi.fn()

    vi.stubGlobal('useFileStorage', () => ({ get }))

    await expect(ensureOfficeTextState({
      id: 'f1',
      userId: 1,
      storageKey: 'k.docx',
      type: DOCX,
      textStatus: 'ready',
      textBytes: 5,
      textVersion: 1,
      textOmittedMedia: 0,
      textOmittedCharts: 2,
    }, logger)).resolves.toMatchObject({
      textOmittedMedia: 0,
      textOmittedCharts: 2,
    })
    expect(get).not.toHaveBeenCalled()
  })

  describe('backfilling counts of files stored before they existed', () => {
    const readyFile = {
      id: 'f1',
      userId: 1,
      storageKey: 'k.docx',
      type: DOCX,
      textStatus: 'ready',
      textBytes: 5,
      textVersion: 1,
    }
    let updateSet: ReturnType<typeof vi.fn>

    function stubStorage(bytes: Uint8Array | null) {
      const get = vi.fn(async () => {
        if (!bytes) {
          return null
        }

        return {
          arrayBuffer: async () => {
            return bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength,
            )
          },
        }
      })

      vi.stubGlobal('useFileStorage', () => ({ get, put: vi.fn() }))

      return get
    }

    beforeEach(() => {
      updateSet = vi.fn(() => ({
        where: vi.fn().mockResolvedValue(undefined),
      }))
      vi.stubGlobal('useDb', () => ({
        update: vi.fn(() => ({ set: updateSet })),
      }))
    })

    it('counts a ready file once, without running the renderer', async () => {
      const get = stubStorage(buildZip([
        'word/document.xml',
        'word/media/image1.png',
        'word/media/image2.png',
        'word/charts/chart1.xml',
      ]))

      await expect(ensureOfficeTextState(readyFile, logger)).resolves
        .toMatchObject({
          textStatus: 'ready',
          textBytes: 5,
          textOmittedMedia: 2,
          textOmittedCharts: 1,
        })
      expect(get).toHaveBeenCalledTimes(1)
      expect(updateSet).toHaveBeenCalledWith({
        textOmittedMedia: 2,
        textOmittedCharts: 1,
      })
      expect(mocks.extractOfficeText).not.toHaveBeenCalled()
    })

    it('writes zero for an unreadable archive, so it is not retried', async () => {
      stubStorage(new Uint8Array([1, 2, 3]))

      await expect(ensureOfficeTextState(readyFile, logger)).resolves
        .toMatchObject({ textOmittedMedia: 0, textOmittedCharts: 0 })
      expect(updateSet).toHaveBeenCalledWith({
        textOmittedMedia: 0,
        textOmittedCharts: 0,
      })
    })

    it('leaves the counts empty when the file object is gone', async () => {
      stubStorage(null)

      await expect(ensureOfficeTextState(readyFile, logger)).resolves
        .toMatchObject({ textStatus: 'ready', textOmittedMedia: null })
      expect(updateSet).not.toHaveBeenCalled()
    })

    it('keeps the state when counting fails', async () => {
      vi.stubGlobal('useFileStorage', () => ({
        get: vi.fn().mockRejectedValue(new Error('r2 down')),
      }))

      await expect(ensureOfficeTextState(readyFile, logger)).resolves
        .toMatchObject({
          textStatus: 'ready',
          textBytes: 5,
          textOmittedMedia: null,
          textOmittedCharts: null,
        })
      expect(updateSet).not.toHaveBeenCalled()
    })

    it('does not count a file that has no ready text', async () => {
      const get = stubStorage(buildZip(['word/media/image1.png']))

      await ensureOfficeTextState({
        ...readyFile,
        textStatus: 'empty',
        textBytes: null,
      }, logger)

      expect(get).not.toHaveBeenCalled()
      expect(updateSet).not.toHaveBeenCalled()
    })
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

import { strToU8, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import {
  OFFICE_UPLOAD_MAX_BYTES,
} from '~~/shared/utils/office-files'
import { EXTRACT_LIMITS } from '@besidka/doc-renderer/extract'
import {
  OFFICE_UPLOAD_ZIP_LIMITS,
  assertOfficeContentLength,
  assertOfficeUploadBytes,
  assertSupportedOfficeExtension,
} from '~~/server/utils/files/office-upload-check'
import {
  docxPackage,
  paragraphXml,
  plainZip,
  pptxPackage,
  slideXml,
  xlsxPackage,
  worksheetXml,
} from '../../../../fixtures/documents/extract/builders'
import {
  markEncrypted,
  zipWithManyEntries,
} from '../../../../fixtures/documents/malicious/builders'

const COMPOUND_FILE_HEADER = new Uint8Array([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0,
])

function validDocx(): Uint8Array {
  return docxPackage(paragraphXml('Hello'))
}

function expectRejection(action: () => void, fragment: string | RegExp) {
  try {
    action()
  } catch (exception) {
    expect(exception).toMatchObject({ status: 400 })
    expect(String((exception as { why?: string }).why)).toMatch(fragment)
    expect(String((exception as { fix?: string }).fix).length)
      .toBeGreaterThan(0)

    return
  }

  throw new Error('Expected the upload check to reject the file')
}

function incompressibleBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  let state = 123456789

  for (let index = 0; index < length; index += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    bytes[index] = state >>> 24
  }

  return bytes
}

describe('OFFICE_UPLOAD_ZIP_LIMITS', () => {
  it('mirrors the limits the text extractor applies', () => {
    expect(OFFICE_UPLOAD_ZIP_LIMITS).toEqual({
      entriesMax: EXTRACT_LIMITS.zipEntriesMax,
      entryBytesMax: EXTRACT_LIMITS.zipEntryBytesMax,
      totalBytesMax: EXTRACT_LIMITS.zipTotalBytesMax,
      ratioMax: EXTRACT_LIMITS.zipRatioMax,
      ratioMinBytes: EXTRACT_LIMITS.zipRatioMinBytes,
    })
  })

  it('accepts a well-compressed part the generated-document limits refuse', () => {
    const compressible = docxPackage(paragraphXml('x'), {
      options: {
        extraFiles: { 'word/media/sparse.xml': new Uint8Array(400 * 1024) },
      },
    })

    expect(() => {
      assertOfficeUploadBytes('a.docx', 'docx', compressible)
    }).not.toThrow()
  })
})

describe('assertSupportedOfficeExtension', () => {
  it('accepts the three current formats', () => {
    for (const name of ['a.docx', 'b.XLSX', 'c.pptx', 'plain.txt']) {
      expect(() => assertSupportedOfficeExtension(name)).not.toThrow()
    }
  })

  it('rejects legacy files with a save-as hint', () => {
    for (const name of ['a.doc', 'b.xls', 'c.ppt']) {
      expect(() => assertSupportedOfficeExtension(name)).toThrowError(
        expect.objectContaining({
          status: 400,
          fix: expect.stringMatching(/\.docx, \.xlsx or \.pptx/),
        }),
      )
    }
  })

  it('rejects macro-enabled files with a save-as hint', () => {
    for (const name of ['a.docm', 'b.xlsm', 'c.pptm']) {
      expect(() => assertSupportedOfficeExtension(name)).toThrowError(
        expect.objectContaining({
          status: 400,
          why: expect.stringMatching(/Macro-enabled/),
          fix: expect.stringMatching(/\.docx, \.xlsx or \.pptx/),
        }),
      )
    }
  })
})

describe('assertOfficeUploadBytes', () => {
  it('accepts a well-formed file of each format', () => {
    expect(() => {
      assertOfficeUploadBytes('a.docx', 'docx', validDocx())
    }).not.toThrow()
    expect(() => {
      assertOfficeUploadBytes('a.xlsx', 'xlsx', xlsxPackage([
        { name: 'Sheet1', xml: worksheetXml('') },
      ]))
    }).not.toThrow()
    expect(() => {
      assertOfficeUploadBytes('a.pptx', 'pptx', pptxPackage([{ xml: slideXml('') }]))
    }).not.toThrow()
  })

  it('rejects a legacy extension even with Office bytes', () => {
    expectRejection(() => {
      assertOfficeUploadBytes('a.doc', 'docx', validDocx())
    }, /Legacy/)
  })

  it('rejects a macro extension even with Office bytes', () => {
    expectRejection(() => {
      assertOfficeUploadBytes('a.docm', 'docx', validDocx())
    }, /Macro-enabled/)
  })

  it('rejects a compound file (legacy or password-protected)', () => {
    expectRejection(() => {
      assertOfficeUploadBytes('a.docx', 'docx', COMPOUND_FILE_HEADER)
    }, /legacy or password-protected/)
  })

  it('rejects bytes that are not a ZIP', () => {
    expectRejection(() => {
      assertOfficeUploadBytes('a.docx', 'docx', strToU8('just some text'))
    }, /not a Word \.docx file/)
  })

  it('rejects a ZIP whose directory cannot be read', () => {
    const truncated = validDocx().slice(0, 40)

    expectRejection(() => {
      assertOfficeUploadBytes('a.docx', 'docx', truncated)
    }, /damaged/)
  })

  it('rejects a ZIP bomb by its compression ratio', () => {
    const bomb = docxPackage(paragraphXml('x'), {
      options: {
        extraFiles: { 'word/media/zeros.bin': new Uint8Array(24 * 1024 * 1024) },
      },
    })

    expectRejection(() => {
      assertOfficeUploadBytes('a.docx', 'docx', bomb)
    }, /zip_ratio/)
  })

  it('rejects a ZIP with too many entries', () => {
    expectRejection(() => {
      assertOfficeUploadBytes('a.docx', 'docx', zipWithManyEntries(5001))
    }, /damaged|larger/)
  })

  it('rejects an encrypted entry', () => {
    expectRejection(() => {
      assertOfficeUploadBytes(
        'a.docx',
        'docx',
        markEncrypted(validDocx(), 'word/document.xml'),
      )
    }, /password-protected/)
  })

  it('rejects a ZIP without the main part', () => {
    expectRejection(() => {
      assertOfficeUploadBytes(
        'a.docx',
        'docx',
        plainZip({ 'readme.txt': 'hi' }),
      )
    }, /word\/document\.xml is missing/)
  })

  it('rejects a file whose content is another Office format', () => {
    expectRejection(() => {
      assertOfficeUploadBytes('a.xlsx', 'xlsx', validDocx())
    }, /xl\/workbook\.xml is missing/)
  })

  it('rejects a well-formed file over the size cap', () => {
    const oversized = zipSync({
      'word/document.xml': strToU8('<w:document/>'),
      'word/media/blob.bin': incompressibleBytes(
        OFFICE_UPLOAD_MAX_BYTES + 1024,
      ),
    }, { level: 0 })

    expectRejection(() => {
      assertOfficeUploadBytes('a.docx', 'docx', oversized)
    }, /limited to 20\.0 MB/)
  })
})

describe('assertOfficeContentLength', () => {
  it('passes unknown and small lengths', () => {
    expect(() => assertOfficeContentLength(null)).not.toThrow()
    expect(() => assertOfficeContentLength(1024)).not.toThrow()
    expect(() => {
      assertOfficeContentLength(OFFICE_UPLOAD_MAX_BYTES)
    }).not.toThrow()
  })

  it('rejects a declared length over the cap', () => {
    expectRejection(() => {
      assertOfficeContentLength(OFFICE_UPLOAD_MAX_BYTES + 1)
    }, /limited to/)
  })
})

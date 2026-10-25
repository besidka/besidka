import { describe, expect, it, vi } from 'vitest'
import {
  knowledgeCharCountsSchema,
  knowledgeCommitSchema,
  knowledgeExtractedTextSchema,
  knowledgeItemCreateSchema,
  knowledgeItemPatchSchema,
  knowledgeItemsBatchCreateSchema,
  knowledgeModePatchSchema,
  knowledgeModeSchema,
  knowledgeNoteCreateSchema,
  knowledgeNoteUpdateSchema,
  knowledgePackHeaderSchema,
  knowledgePackLineSchema,
  knowledgeReadToolInputSchema,
  knowledgeSearchToolInputSchema,
  knowledgeTextByteLength,
} from '#shared/utils/project-knowledge-schemas'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'

const validHash = 'a'.repeat(64)

const validPdfItem = {
  fileId: 'file-1',
  extractor: 'client-unpdf' as const,
  extractStatus: 'ready' as const,
  text: 'Extracted text',
}

const validTextItem = {
  fileId: null,
  title: 'notes.md',
  mediaType: 'text/markdown',
  extractor: 'text' as const,
  extractStatus: 'ready' as const,
  text: '# Notes',
}

describe('knowledgeTextByteLength', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(knowledgeTextByteLength('abc')).toBe(3)
    expect(knowledgeTextByteLength('привіт')).toBe(12)
    expect(knowledgeTextByteLength('😀')).toBe(4)
    expect(knowledgeTextByteLength('')).toBe(0)
  })
})

describe('knowledgeModeSchema', () => {
  it.each(['auto', 'full', 'search'])('accepts %s', (mode) => {
    expect(knowledgeModeSchema.safeParse(mode).success).toBe(true)
  })

  it('rejects unknown modes and null', () => {
    expect(knowledgeModeSchema.safeParse('none').success).toBe(false)
    expect(knowledgeModeSchema.safeParse(null).success).toBe(false)
  })
})

describe('knowledgeModePatchSchema', () => {
  it('accepts a mode and null (auto)', () => {
    expect(knowledgeModePatchSchema.safeParse({ mode: 'full' }).success)
      .toBe(true)
    expect(knowledgeModePatchSchema.safeParse({ mode: null }).success)
      .toBe(true)
  })

  it('requires the mode key', () => {
    expect(knowledgeModePatchSchema.safeParse({}).success).toBe(false)
  })

  it('rejects an invalid mode', () => {
    expect(knowledgeModePatchSchema.safeParse({ mode: 'all' }).success)
      .toBe(false)
  })
})

describe('knowledgeCharCountsSchema', () => {
  it('accepts non-negative integers', () => {
    expect(knowledgeCharCountsSchema.safeParse({
      latinChars: 0,
      cyrillicChars: 5,
      otherChars: 10,
    }).success).toBe(true)
  })

  it.each([-1, 1.5, Number.NaN])('rejects %s', (value) => {
    expect(knowledgeCharCountsSchema.safeParse({
      latinChars: value,
      cyrillicChars: 0,
      otherChars: 0,
    }).success).toBe(false)
  })

  it('requires all three keys', () => {
    expect(knowledgeCharCountsSchema.safeParse({ latinChars: 1 }).success)
      .toBe(false)
  })
})

describe('knowledgeNoteCreateSchema', () => {
  it('accepts a title and body', () => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: 'Text',
    }).success).toBe(true)
  })

  it('trims the title', () => {
    const result = knowledgeNoteCreateSchema.parse({
      title: '  Brief  ',
      body: 'Text',
    })

    expect(result.title).toBe('Brief')
  })

  it('rejects an empty or whitespace title', () => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: '   ',
      body: 'Text',
    }).success).toBe(false)
  })

  it('rejects a title above the limit and accepts the limit', () => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'a'.repeat(KNOWLEDGE_LIMITS.maxTitleChars),
      body: 'Text',
    }).success).toBe(true)
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'a'.repeat(KNOWLEDGE_LIMITS.maxTitleChars + 1),
      body: 'Text',
    }).success).toBe(false)
  })

  it('rejects a multi-line title', () => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'one\ntwo',
      body: 'Text',
    }).success).toBe(false)
  })

  it.each([
    ['U+2028', 'one\u2028two'],
    ['U+2029', 'one\u2029two'],
    ['U+0085', 'one\u0085two'],
    ['vertical tab', 'one\u000Btwo'],
    ['tab', 'one\ttwo'],
    ['NUL', 'one\u0000two'],
  ])('rejects a title containing %s', (_label, title) => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title,
      body: 'Text',
    }).success).toBe(false)
  })

  it.each([
    ['U+2028', 'one\u2028two'],
    ['U+0085', 'one\u0085two'],
    ['vertical tab', 'one\u000Btwo'],
    ['NUL', 'one\u0000two'],
  ])('rejects a description containing %s', (_label, description) => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: 'Text',
      description,
    }).success).toBe(false)
    expect(knowledgeItemPatchSchema.safeParse({ description }).success)
      .toBe(false)
  })

  it('accepts a multi-line body', () => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: 'one\ntwo\r\nthree\u2028four',
    }).success).toBe(true)
  })

  it('rejects a body containing NUL', () => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: 'a\u0000b',
    }).success).toBe(false)
    expect(knowledgeNoteUpdateSchema.safeParse({ body: 'a\u0000b' }).success)
      .toBe(false)
  })

  it('rejects an empty body', () => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: '',
    }).success).toBe(false)
  })

  it('accepts a body at the limit and rejects one above it', () => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: 'a'.repeat(KNOWLEDGE_LIMITS.maxNoteChars),
    }).success).toBe(true)
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: 'a'.repeat(KNOWLEDGE_LIMITS.maxNoteChars + 1),
    }).success).toBe(false)
  })

  it('accepts a null or single-line description', () => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: 'Text',
      description: null,
    }).success).toBe(true)
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: 'Text',
      description: 'Short summary',
    }).success).toBe(true)
  })

  it('rejects a multi-line or over-long description', () => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: 'Text',
      description: 'a\nb',
    }).success).toBe(false)
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: 'Text',
      description: 'a'.repeat(KNOWLEDGE_LIMITS.maxDescriptionChars + 1),
    }).success).toBe(false)
  })

  it('accepts a description at the limit', () => {
    expect(knowledgeNoteCreateSchema.safeParse({
      title: 'Brief',
      body: 'Text',
      description: 'a'.repeat(KNOWLEDGE_LIMITS.maxDescriptionChars),
    }).success).toBe(true)
  })
})

describe('knowledgeNoteUpdateSchema', () => {
  it('accepts a single field', () => {
    expect(knowledgeNoteUpdateSchema.safeParse({ title: 'New' }).success)
      .toBe(true)
    expect(knowledgeNoteUpdateSchema.safeParse({ body: 'New' }).success)
      .toBe(true)
    expect(knowledgeNoteUpdateSchema.safeParse({ description: null }).success)
      .toBe(true)
  })

  it('rejects an empty object', () => {
    expect(knowledgeNoteUpdateSchema.safeParse({}).success).toBe(false)
  })

  it('still validates the provided fields', () => {
    expect(knowledgeNoteUpdateSchema.safeParse({ title: '' }).success)
      .toBe(false)
    expect(knowledgeNoteUpdateSchema.safeParse({ body: '' }).success)
      .toBe(false)
  })
})

describe('knowledgeItemPatchSchema', () => {
  it('accepts each field on its own', () => {
    expect(knowledgeItemPatchSchema.safeParse({ description: 'x' }).success)
      .toBe(true)
    expect(knowledgeItemPatchSchema.safeParse({ description: null }).success)
      .toBe(true)
    expect(knowledgeItemPatchSchema.safeParse({
      sendAsNativePdf: true,
    }).success).toBe(true)
    expect(knowledgeItemPatchSchema.safeParse({ pinned: false }).success)
      .toBe(true)
  })

  it('rejects an empty object', () => {
    expect(knowledgeItemPatchSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a multi-line or over-long description', () => {
    expect(knowledgeItemPatchSchema.safeParse({
      description: 'a\r\nb',
    }).success).toBe(false)
    expect(knowledgeItemPatchSchema.safeParse({
      description: 'a'.repeat(101),
    }).success).toBe(false)
  })

  it('rejects non-boolean flags', () => {
    expect(knowledgeItemPatchSchema.safeParse({ pinned: 'yes' }).success)
      .toBe(false)
  })
})

describe('knowledgeExtractedTextSchema', () => {
  it('accepts text and empty text', () => {
    expect(knowledgeExtractedTextSchema.safeParse({ text: 'abc' }).success)
      .toBe(true)
    expect(knowledgeExtractedTextSchema.safeParse({ text: '' }).success)
      .toBe(true)
  })

  it('rejects a NUL character', () => {
    expect(knowledgeExtractedTextSchema.safeParse({
      text: 'a\u0000b',
    }).success).toBe(false)
  })

  it('accepts text at the byte limit', () => {
    expect(knowledgeExtractedTextSchema.safeParse({
      text: 'a'.repeat(KNOWLEDGE_LIMITS.maxItemTextBytes),
    }).success).toBe(true)
  })

  it('rejects text above the byte limit', () => {
    expect(knowledgeExtractedTextSchema.safeParse({
      text: 'a'.repeat(KNOWLEDGE_LIMITS.maxItemTextBytes + 1),
    }).success).toBe(false)
  })

  it('accepts newlines and separators in extracted text', () => {
    expect(knowledgeExtractedTextSchema.safeParse({
      text: 'a\nb\r\nc\u2028d\te',
    }).success).toBe(true)
  })

  it('rejects an over-long text without measuring its bytes', () => {
    const encode = vi.spyOn(TextEncoder.prototype, 'encode')
    const result = knowledgeExtractedTextSchema.safeParse({
      text: 'a'.repeat(KNOWLEDGE_LIMITS.maxItemTextBytes + 1),
    })

    expect(result.success).toBe(false)
    expect(encode).not.toHaveBeenCalled()

    encode.mockRestore()
  })

  it('counts bytes rather than characters', () => {
    const characters = KNOWLEDGE_LIMITS.maxItemTextBytes / 2 + 1

    expect(knowledgeExtractedTextSchema.safeParse({
      text: 'я'.repeat(characters),
    }).success).toBe(false)
  })
})

describe('knowledgeItemCreateSchema', () => {
  it('accepts a PDF item with a file id and no title or media type', () => {
    expect(knowledgeItemCreateSchema.safeParse(validPdfItem).success).toBe(true)
  })

  it('accepts a text item without an original file', () => {
    expect(knowledgeItemCreateSchema.safeParse(validTextItem).success)
      .toBe(true)
  })

  it('accepts a text item with the file id omitted', () => {
    const { fileId: _fileId, ...withoutFileId } = validTextItem

    expect(knowledgeItemCreateSchema.safeParse(withoutFileId).success)
      .toBe(true)
  })

  it('requires a title when there is no file id', () => {
    const { title: _title, ...withoutTitle } = validTextItem
    const result = knowledgeItemCreateSchema.safeParse(withoutTitle)

    expect(result.success).toBe(false)
    expect(result.error?.issues.map(issue => issue.path.join('.')))
      .toContain('title')
  })

  it('requires a media type when there is no file id', () => {
    const { mediaType: _mediaType, ...withoutMediaType } = validTextItem
    const result = knowledgeItemCreateSchema.safeParse(withoutMediaType)

    expect(result.success).toBe(false)
    expect(result.error?.issues.map(issue => issue.path.join('.')))
      .toContain('mediaType')
  })

  it('treats an empty file id like a missing one', () => {
    expect(knowledgeItemCreateSchema.safeParse({
      ...validTextItem,
      fileId: '',
    }).success).toBe(false)
  })

  it('accepts an optional media type with a file id', () => {
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      mediaType: 'application/pdf',
    }).success).toBe(true)
  })

  it('rejects an over-long media type', () => {
    expect(knowledgeItemCreateSchema.safeParse({
      ...validTextItem,
      mediaType: 'a'.repeat(101),
    }).success).toBe(false)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validTextItem,
      mediaType: 'a'.repeat(100),
    }).success).toBe(true)
  })

  it('rejects the note extractor', () => {
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      extractor: 'note',
    }).success).toBe(false)
  })

  it('rejects an unknown extractor or status', () => {
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      extractor: 'ocr',
    }).success).toBe(false)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      extractStatus: 'pending',
    }).success).toBe(false)
  })

  it('rejects empty text when the extraction is ready', () => {
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      text: '',
    }).success).toBe(false)
  })

  it.each(['no-text', 'failed'] as const)(
    'allows empty text when the status is %s',
    (extractStatus) => {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        extractStatus,
        text: '',
        extractError: 'encrypted',
      }).success).toBe(true)
    },
  )

  it('rejects whitespace-only text when the extraction is ready', () => {
    for (const text of [' ', '\n\n', ' \t\r\n ']) {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        text,
      }).success).toBe(false)
    }
  })

  it.each(['no-text', 'failed'] as const)(
    'rejects non-empty text when the status is %s',
    (extractStatus) => {
      const result = knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        extractStatus,
        text: 'leftover',
        extractError: 'encrypted',
      })

      expect(result.success).toBe(false)
      expect(result.error?.issues.map(issue => issue.path.join('.')))
        .toContain('text')
    },
  )

  it('rejects text with a NUL or above the byte limit', () => {
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      text: 'a\u0000',
    }).success).toBe(false)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      text: 'a'.repeat(KNOWLEDGE_LIMITS.maxItemTextBytes + 1),
    }).success).toBe(false)
  })

  describe('relativePath', () => {
    it('accepts nested and null paths', () => {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        relativePath: 'docs/guide/intro.pdf',
      }).success).toBe(true)
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        relativePath: null,
      }).success).toBe(true)
    })

    it.each([
      '../secret.pdf',
      'docs/../secret.pdf',
      'docs\\..\\secret.pdf',
      '/etc/passwd',
    ])('rejects %s', (relativePath) => {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        relativePath,
      }).success).toBe(false)
    })

    it.each([
      ['U+2028', 'docs/a\u2028b.pdf'],
      ['U+2029', 'docs/a\u2029b.pdf'],
      ['U+0085', 'docs/a\u0085b.pdf'],
      ['vertical tab', 'docs/a\u000Bb.pdf'],
      ['newline', 'a\nb'],
      ['carriage return', 'a\rb'],
      ['NUL', 'docs/a\u0000b.pdf'],
    ])('rejects a path containing %s', (_label, relativePath) => {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        relativePath,
      }).success).toBe(false)
    })

    it('rejects an empty path but still allows null', () => {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        relativePath: '',
      }).success).toBe(false)
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        relativePath: null,
      }).success).toBe(true)
    })

    it('accepts dots inside a segment name', () => {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        relativePath: 'docs/..hidden/file.pdf',
      }).success).toBe(true)
    })

    it('enforces the length limit', () => {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        relativePath: 'a'.repeat(KNOWLEDGE_LIMITS.maxRelativePathChars),
      }).success).toBe(true)
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        relativePath: 'a'.repeat(KNOWLEDGE_LIMITS.maxRelativePathChars + 1),
      }).success).toBe(false)
    })
  })

  describe('folderId', () => {
    it('accepts an allowed id and null', () => {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        folderId: 'abc_DEF-123',
      }).success).toBe(true)
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        folderId: null,
      }).success).toBe(true)
    })

    it('rejects bad characters, empty and over-long ids', () => {
      for (const folderId of ['a b', 'a/b', '', 'a'.repeat(65)]) {
        expect(knowledgeItemCreateSchema.safeParse({
          ...validPdfItem,
          folderId,
        }).success).toBe(false)
      }
    })

    it('rejects control characters in the id', () => {
      for (const folderId of ['a\nb', 'a\u2028b', 'a\u0000b', 'abc\n']) {
        expect(knowledgeItemCreateSchema.safeParse({
          ...validPdfItem,
          folderId,
        }).success).toBe(false)
      }
    })

    it('accepts a 64 character id', () => {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        folderId: 'a'.repeat(64),
      }).success).toBe(true)
    })
  })

  describe('contentHash', () => {
    it('accepts a sha-256 hex digest and null', () => {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        contentHash: validHash,
      }).success).toBe(true)
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        contentHash: null,
      }).success).toBe(true)
    })

    it.each([
      'A'.repeat(64),
      'a'.repeat(63),
      'a'.repeat(65),
      'g'.repeat(64),
    ])('rejects %s', (contentHash) => {
      expect(knowledgeItemCreateSchema.safeParse({
        ...validPdfItem,
        contentHash,
      }).success).toBe(false)
    })
  })

  it('limits the extract error code to 64 characters', () => {
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      extractError: 'a'.repeat(64),
    }).success).toBe(true)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      extractError: 'a'.repeat(65),
    }).success).toBe(false)
  })

  it('validates the page count', () => {
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      pageCount: 0,
    }).success).toBe(true)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      pageCount: null,
    }).success).toBe(true)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      pageCount: KNOWLEDGE_LIMITS.maxPdfPages,
    }).success).toBe(true)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      pageCount: KNOWLEDGE_LIMITS.maxPdfPages + 1,
    }).success).toBe(false)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      pageCount: 501,
    }).success).toBe(false)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      pageCount: -1,
    }).success).toBe(false)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      pageCount: 1.5,
    }).success).toBe(false)
  })

  it('validates the optional title', () => {
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      title: 'a\nb',
    }).success).toBe(false)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      title: 'a\u2028b',
    }).success).toBe(false)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      title: 'a\u0000b',
    }).success).toBe(false)
    expect(knowledgeItemCreateSchema.safeParse({
      ...validPdfItem,
      title: 'Paper',
    }).success).toBe(true)
  })
})

describe('knowledgeItemsBatchCreateSchema', () => {
  it('accepts one item and the commit flag', () => {
    expect(knowledgeItemsBatchCreateSchema.safeParse({
      items: [validPdfItem],
    }).success).toBe(true)
    expect(knowledgeItemsBatchCreateSchema.safeParse({
      items: [validPdfItem, validTextItem],
      commit: true,
    }).success).toBe(true)
  })

  it('rejects an empty list', () => {
    expect(knowledgeItemsBatchCreateSchema.safeParse({ items: [] }).success)
      .toBe(false)
  })

  it('accepts 25 items and rejects 26', () => {
    expect(knowledgeItemsBatchCreateSchema.safeParse({
      items: Array.from({ length: 25 }, () => validPdfItem),
    }).success).toBe(true)
    expect(knowledgeItemsBatchCreateSchema.safeParse({
      items: Array.from({ length: 26 }, () => validPdfItem),
    }).success).toBe(false)
  })

  it('rejects a non-boolean commit flag', () => {
    expect(knowledgeItemsBatchCreateSchema.safeParse({
      items: [validPdfItem],
      commit: 'yes',
    }).success).toBe(false)
  })

  it('propagates item errors', () => {
    expect(knowledgeItemsBatchCreateSchema.safeParse({
      items: [validPdfItem, { ...validPdfItem, extractor: 'note' }],
    }).success).toBe(false)
  })

  it('accepts a total exactly at the project byte limit', () => {
    const itemBytes = KNOWLEDGE_LIMITS.maxProjectTextBytes / 2
    const items = Array.from({ length: 2 }, () => ({
      ...validPdfItem,
      text: 'a'.repeat(itemBytes),
    }))

    expect(items.length * itemBytes)
      .toBe(KNOWLEDGE_LIMITS.maxProjectTextBytes)
    expect(knowledgeItemsBatchCreateSchema.safeParse({ items }).success)
      .toBe(true)
  })

  it('rejects a total above the project byte limit', () => {
    const items = [
      {
        ...validPdfItem,
        text: 'a'.repeat(KNOWLEDGE_LIMITS.maxProjectTextBytes),
      },
      { ...validPdfItem, text: 'a' },
    ]
    const result = knowledgeItemsBatchCreateSchema.safeParse({ items })

    expect(result.success).toBe(false)
    expect(result.error?.issues.some(issue => issue.path.includes('items')))
      .toBe(true)
  })

  it('sums bytes rather than characters', () => {
    const items = Array.from({ length: 2 }, () => ({
      ...validPdfItem,
      text: 'я'.repeat(KNOWLEDGE_LIMITS.maxProjectTextBytes / 4 + 1),
    }))

    expect(knowledgeItemsBatchCreateSchema.safeParse({ items }).success)
      .toBe(false)
  })
})

describe('knowledgeCommitSchema', () => {
  it('accepts an empty object', () => {
    expect(knowledgeCommitSchema.safeParse({}).success).toBe(true)
  })

  it('accepts a folder id, null and a remove list', () => {
    expect(knowledgeCommitSchema.safeParse({
      folderId: 'folder_1',
      remove: ['item-1', 'item-2'],
    }).success).toBe(true)
    expect(knowledgeCommitSchema.safeParse({ folderId: null }).success)
      .toBe(true)
  })

  it('rejects a bad folder id', () => {
    expect(knowledgeCommitSchema.safeParse({ folderId: 'a/b' }).success)
      .toBe(false)
  })

  it('caps the remove list at the folder file limit', () => {
    expect(knowledgeCommitSchema.safeParse({
      remove: Array.from(
        { length: KNOWLEDGE_LIMITS.maxFolderFiles },
        (_unused, index) => `item-${index}`,
      ),
    }).success).toBe(true)
    expect(knowledgeCommitSchema.safeParse({
      remove: Array.from(
        { length: KNOWLEDGE_LIMITS.maxFolderFiles + 1 },
        (_unused, index) => `item-${index}`,
      ),
    }).success).toBe(false)
  })

  it('rejects empty item ids', () => {
    expect(knowledgeCommitSchema.safeParse({ remove: [''] }).success)
      .toBe(false)
  })
})

describe('knowledgePackHeaderSchema', () => {
  const validHeader = {
    type: 'header' as const,
    version: 3,
    builtAt: '2026-10-25T10:00:00.000Z',
    items: [{ itemId: 'item-1', updatedAt: '2026-10-25T09:00:00Z', chunks: 4 }],
  }

  it('accepts a valid header', () => {
    expect(knowledgePackHeaderSchema.safeParse(validHeader).success).toBe(true)
  })

  it('accepts an empty item list', () => {
    expect(knowledgePackHeaderSchema.safeParse({
      ...validHeader,
      items: [],
    }).success).toBe(true)
  })

  it('requires the header literal', () => {
    expect(knowledgePackHeaderSchema.safeParse({
      ...validHeader,
      type: 'chunk',
    }).success).toBe(false)
  })

  it('rejects a negative version or chunk count', () => {
    expect(knowledgePackHeaderSchema.safeParse({
      ...validHeader,
      version: -1,
    }).success).toBe(false)
    expect(knowledgePackHeaderSchema.safeParse({
      ...validHeader,
      items: [{ itemId: 'a', updatedAt: 'x', chunks: -1 }],
    }).success).toBe(false)
  })
})

describe('knowledgePackLineSchema', () => {
  const validLine = {
    type: 'chunk' as const,
    itemId: 'item-1',
    ordinal: 0,
    breadcrumb: 'Guide > Intro',
    text: 'Hello',
  }

  it('accepts a valid line', () => {
    expect(knowledgePackLineSchema.safeParse(validLine).success).toBe(true)
  })

  it('requires the chunk literal', () => {
    expect(knowledgePackLineSchema.safeParse({
      ...validLine,
      type: 'header',
    }).success).toBe(false)

    const { type: _type, ...withoutType } = validLine

    expect(knowledgePackLineSchema.safeParse(withoutType).success).toBe(false)
  })

  it('rejects a negative or fractional ordinal', () => {
    expect(knowledgePackLineSchema.safeParse({
      ...validLine,
      ordinal: -1,
    }).success).toBe(false)
    expect(knowledgePackLineSchema.safeParse({
      ...validLine,
      ordinal: 0.5,
    }).success).toBe(false)
  })

  it('requires the text fields', () => {
    expect(knowledgePackLineSchema.safeParse({
      ...validLine,
      text: undefined,
    }).success).toBe(false)
  })
})

describe('knowledgeSearchToolInputSchema', () => {
  it('accepts a query', () => {
    expect(knowledgeSearchToolInputSchema.safeParse({ query: 'pricing' }).success)
      .toBe(true)
  })

  it('trims the query', () => {
    expect(knowledgeSearchToolInputSchema.parse({ query: '  pricing ' }).query)
      .toBe('pricing')
  })

  it('rejects an empty or whitespace query', () => {
    expect(knowledgeSearchToolInputSchema.safeParse({ query: '  ' }).success)
      .toBe(false)
  })

  it('enforces the query length limit', () => {
    expect(knowledgeSearchToolInputSchema.safeParse({
      query: 'a'.repeat(KNOWLEDGE_LIMITS.searchQueryMaxChars),
    }).success).toBe(true)
    expect(knowledgeSearchToolInputSchema.safeParse({
      query: 'a'.repeat(KNOWLEDGE_LIMITS.searchQueryMaxChars + 1),
    }).success).toBe(false)
  })

  it('caps the item id filter at 20', () => {
    expect(knowledgeSearchToolInputSchema.safeParse({
      query: 'x',
      itemIds: Array.from({ length: 20 }, (_unused, index) => `i${index}`),
    }).success).toBe(true)
    expect(knowledgeSearchToolInputSchema.safeParse({
      query: 'x',
      itemIds: Array.from({ length: 21 }, (_unused, index) => `i${index}`),
    }).success).toBe(false)
  })
})

describe('knowledgeReadToolInputSchema', () => {
  it('accepts an item id alone', () => {
    expect(knowledgeReadToolInputSchema.safeParse({ itemId: 'item-1' }).success)
      .toBe(true)
  })

  it('accepts a start chunk and count', () => {
    expect(knowledgeReadToolInputSchema.safeParse({
      itemId: 'item-1',
      fromChunk: 3,
      count: 6,
    }).success).toBe(true)
  })

  it('requires the item id', () => {
    expect(knowledgeReadToolInputSchema.safeParse({}).success).toBe(false)
  })

  it('rejects a negative start chunk', () => {
    expect(knowledgeReadToolInputSchema.safeParse({
      itemId: 'item-1',
      fromChunk: -1,
    }).success).toBe(false)
  })

  it('bounds the count from 1 to the read chunk limit', () => {
    expect(knowledgeReadToolInputSchema.safeParse({
      itemId: 'item-1',
      count: 0,
    }).success).toBe(false)
    expect(knowledgeReadToolInputSchema.safeParse({
      itemId: 'item-1',
      count: KNOWLEDGE_LIMITS.readMaxChunks + 1,
    }).success).toBe(false)
    expect(knowledgeReadToolInputSchema.safeParse({
      itemId: 'item-1',
      count: 1,
    }).success).toBe(true)
  })
})

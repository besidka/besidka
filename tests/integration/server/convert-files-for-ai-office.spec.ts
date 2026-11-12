import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import {
  OFFICE_MEDIA_TYPES,
  OFFICE_TEXT_INLINE_MAX_BYTES,
  OFFICE_TEXT_MESSAGE_MAX_BYTES,
} from '#shared/utils/office-files'
import { convertFilesForAI } from '~~/server/utils/files/convert-files-for-ai'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  getOwnedFilesByStorageKeys: vi.fn(),
  getOwnedGeneratedImageFilesByStorageKeys: vi.fn(),
  extractOfficeText: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: mocks.loggerSet }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}))

vi.mock('~~/server/utils/files/file-governance', async () => {
  const actual = await vi.importActual<any>(
    '~~/server/utils/files/file-governance',
  )

  return {
    ...actual,
    getOwnedFilesByStorageKeys: mocks.getOwnedFilesByStorageKeys,
    getOwnedGeneratedImageFilesByStorageKeys:
      mocks.getOwnedGeneratedImageFilesByStorageKeys,
  }
})

vi.mock('~~/server/utils/documents/renderer', () => ({
  extractOfficeText: mocks.extractOfficeText,
}))

interface OwnedRow {
  id: string
  storageKey: string
  size: number
  type: string
  textStatus?: string | null
  textBytes?: number | null
  textVersion?: number | null
}

function officeRow(key: string, overrides: Partial<OwnedRow> = {}): OwnedRow {
  return {
    id: key,
    storageKey: key,
    size: 5000,
    type: OFFICE_MEDIA_TYPES.docx,
    textStatus: 'ready',
    textBytes: 10,
    textVersion: 1,
    ...overrides,
  }
}

function userMessage(
  parts: Array<{ key: string, mediaType: string, filename?: string }>,
): UIMessage {
  return {
    id: 'm1',
    role: 'user',
    parts: [
      { type: 'text', text: 'Summarise' },
      ...parts.map((part) => {
        return {
          type: 'file' as const,
          url: `/files/${part.key}`,
          mediaType: part.mediaType,
          filename: part.filename ?? part.key,
        }
      }),
    ],
  }
}

function getTexts(message: UIMessage | undefined): string[] {
  return (message?.parts ?? [])
    .filter((part) => {
      return part.type === 'text'
    })
    .map((part) => {
      return (part as { text: string }).text
    })
}

function getFileParts(message: UIMessage | undefined) {
  return (message?.parts ?? []).filter((part) => {
    return part.type === 'file'
  }) as Array<{ mediaType: string, url: string }>
}

describe('convertFilesForAI with Office files', () => {
  let storedObjects: Map<string, string | Uint8Array>
  let storagePut: ReturnType<typeof vi.fn>
  let updateSet: ReturnType<typeof vi.fn>

  function stubOwnedFiles(rows: OwnedRow[]) {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(
      new Map(rows.map((row) => {
        return [row.storageKey, row]
      })),
    )
  }

  function store(key: string, content: string | Uint8Array) {
    storedObjects.set(key, content)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    storedObjects = new Map()
    storagePut = vi.fn(async (key: string, value: Uint8Array) => {
      storedObjects.set(key, value)

      return { key }
    })
    updateSet = vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) }))

    vi.stubGlobal('useEvent', () => ({}))
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', () => {
      throw new Error('Unauthorized')
    })
    vi.stubGlobal('useKV', () => ({
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }))
    vi.stubGlobal('useDb', () => ({
      update: vi.fn(() => ({ set: updateSet })),
    }))
    vi.stubGlobal('useFileStorage', () => ({
      put: storagePut,
      get: vi.fn(async (key: string) => {
        const content = storedObjects.get(key)

        if (content === undefined) {
          return null
        }

        const bytes = typeof content === 'string'
          ? new TextEncoder().encode(content)
          : content

        return {
          arrayBuffer: async () => bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
          text: async () => new TextDecoder().decode(bytes),
        }
      }),
    }))
  })

  it('sends the extracted text of a ready Office file as a text part', async () => {
    store('a.docx.text.md', '# Plan\n\nShip it.')
    stubOwnedFiles([officeRow('a.docx')])

    const { messages, unsupportedFiles } = await convertFilesForAI([
      userMessage([{
        key: 'a.docx',
        mediaType: OFFICE_MEDIA_TYPES.docx,
        filename: 'plan.docx',
      }]),
    ])
    const [message] = messages

    expect(unsupportedFiles).toEqual([])
    expect(getFileParts(message)).toEqual([])
    expect(getTexts(message)[1]).toBe([
      '**plan.docx** (Word document)',
      '',
      'Extracted text. Images, charts and formatting are not included.',
      '',
      '```md',
      '# Plan',
      '',
      'Ship it.',
      '```',
    ].join('\n'))
  })

  it('names the format of each Office type', async () => {
    store('a.xlsx.text.md', 'Sheet')
    store('a.pptx.text.md', 'Slide')
    stubOwnedFiles([
      officeRow('a.xlsx', { type: OFFICE_MEDIA_TYPES.xlsx }),
      officeRow('a.pptx', { type: OFFICE_MEDIA_TYPES.pptx }),
    ])

    const { messages } = await convertFilesForAI([
      userMessage([
        { key: 'a.xlsx', mediaType: OFFICE_MEDIA_TYPES.xlsx },
        { key: 'a.pptx', mediaType: OFFICE_MEDIA_TYPES.pptx },
      ]),
    ])
    const texts = getTexts(messages[0]).join('\n')

    expect(texts).toContain('(Excel spreadsheet)')
    expect(texts).toContain('(PowerPoint presentation)')
  })

  it('never emits an Office, text or unknown file part', async () => {
    store('a.docx.text.md', 'doc')
    store('a.xlsx.text.md', 'sheet')
    store('a.pptx.text.md', 'deck')
    store('n.csv', 'a,b')
    store('n.md', '# hi')
    store('n.txt', 'plain')
    store('p.png', new Uint8Array([1, 2, 3]))
    store('p.pdf', new Uint8Array([4, 5, 6]))
    stubOwnedFiles([
      officeRow('a.docx'),
      officeRow('a.xlsx', { type: OFFICE_MEDIA_TYPES.xlsx }),
      officeRow('a.pptx', { type: OFFICE_MEDIA_TYPES.pptx }),
      officeRow('n.csv', { type: 'text/csv', textStatus: null }),
      officeRow('n.md', { type: 'text/markdown', textStatus: null }),
      officeRow('n.txt', { type: 'text/plain', textStatus: null }),
      officeRow('p.png', { type: 'image/png', textStatus: null }),
      officeRow('p.pdf', { type: 'application/pdf', textStatus: null }),
      officeRow('j.json', { type: 'application/json', textStatus: null }),
      officeRow('o.doc', { type: 'application/msword', textStatus: null }),
    ])

    const { messages, unsupportedFiles } = await convertFilesForAI([
      userMessage([
        { key: 'a.docx', mediaType: OFFICE_MEDIA_TYPES.docx },
        { key: 'a.xlsx', mediaType: OFFICE_MEDIA_TYPES.xlsx },
        { key: 'a.pptx', mediaType: OFFICE_MEDIA_TYPES.pptx },
        { key: 'n.csv', mediaType: 'text/csv' },
        { key: 'n.md', mediaType: 'text/markdown' },
        { key: 'n.txt', mediaType: 'text/plain' },
        { key: 'p.png', mediaType: 'image/png' },
        { key: 'p.pdf', mediaType: 'application/pdf' },
        { key: 'j.json', mediaType: 'application/json' },
        { key: 'o.doc', mediaType: 'application/msword' },
      ]),
    ])

    expect(getFileParts(messages[0]).map((part) => {
      return part.mediaType
    })).toEqual(['image/png', 'application/pdf'])
    expect(unsupportedFiles.map((file) => {
      return [file.storageKey, file.reason]
    })).toEqual([
      ['j.json', 'unsupported-type'],
      ['o.doc', 'legacy-office'],
    ])
    expect(getTexts(messages[0]).join('\n')).toContain('[File not included')
  })

  it('trusts the stored media type, not the declared one', async () => {
    store('a.docx.text.md', 'real text')
    stubOwnedFiles([officeRow('a.docx')])

    for (const declared of ['image/png', 'text/plain', 'application/pdf']) {
      const { messages } = await convertFilesForAI([
        userMessage([{ key: 'a.docx', mediaType: declared }]),
      ])

      expect(getFileParts(messages[0])).toEqual([])
      expect(getTexts(messages[0]).join('\n')).toContain('real text')
    }
  })

  it('reports a failed extraction instead of sending the raw file', async () => {
    stubOwnedFiles([
      officeRow('f.docx', { textStatus: 'failed', textBytes: null }),
      officeRow('e.docx', { textStatus: 'empty', textBytes: null }),
      officeRow('t.docx', { textStatus: 'too_large', textBytes: null }),
    ])

    const { messages, unsupportedFiles } = await convertFilesForAI([
      userMessage([
        { key: 'f.docx', mediaType: OFFICE_MEDIA_TYPES.docx },
        { key: 'e.docx', mediaType: OFFICE_MEDIA_TYPES.docx },
        { key: 't.docx', mediaType: OFFICE_MEDIA_TYPES.docx },
      ]),
    ])

    expect(getFileParts(messages[0])).toEqual([])
    expect(unsupportedFiles).toHaveLength(3)
    expect(unsupportedFiles.every((file) => {
      return file.reason === 'office-unreadable'
    })).toBe(true)
  })

  it('reads a file stored before extraction once and caches the result', async () => {
    store('old.docx', new Uint8Array([0x50, 0x4b, 3, 4]))
    mocks.extractOfficeText.mockResolvedValue({
      status: 'ready',
      text: 'Lazy text',
      truncated: false,
      stats: { inputBytes: 4, entries: 1, textBytes: 9, truncations: [] },
    })
    stubOwnedFiles([officeRow('old.docx', {
      textStatus: null,
      textBytes: null,
      textVersion: null,
    })])

    const { messages } = await convertFilesForAI([
      userMessage([{ key: 'old.docx', mediaType: OFFICE_MEDIA_TYPES.docx }]),
    ])

    expect(mocks.extractOfficeText).toHaveBeenCalledTimes(1)
    expect(storagePut.mock.calls[0]?.[0]).toBe('old.docx.text.md')
    expect(updateSet).toHaveBeenCalledWith({
      textStatus: 'ready',
      textBytes: 9,
      textVersion: 1,
    })
    expect(getTexts(messages[0]).join('\n')).toContain('Lazy text')
  })

  it('does not extract a file again when the cached status is current', async () => {
    store('a.docx.text.md', 'cached')
    stubOwnedFiles([officeRow('a.docx')])

    await convertFilesForAI([
      userMessage([{ key: 'a.docx', mediaType: OFFICE_MEDIA_TYPES.docx }]),
    ])

    expect(mocks.extractOfficeText).not.toHaveBeenCalled()
  })

  it('re-extracts once when the sidecar is missing', async () => {
    store('a.docx', new Uint8Array([0x50, 0x4b, 3, 4]))
    mocks.extractOfficeText.mockResolvedValue({
      status: 'ready',
      text: 'Rebuilt',
      truncated: false,
      stats: { inputBytes: 4, entries: 1, textBytes: 7, truncations: [] },
    })
    stubOwnedFiles([officeRow('a.docx')])

    const { messages } = await convertFilesForAI([
      userMessage([{ key: 'a.docx', mediaType: OFFICE_MEDIA_TYPES.docx }]),
    ])

    expect(mocks.extractOfficeText).toHaveBeenCalledTimes(1)
    expect(getTexts(messages[0]).join('\n')).toContain('Rebuilt')
  })

  it('cuts a long file at 200 KB on a character boundary', async () => {
    const euro = '€'
    const longText = euro.repeat(100_000)

    store('long.docx.text.md', longText)
    stubOwnedFiles([officeRow('long.docx', { textBytes: 300_000 })])

    const { messages } = await convertFilesForAI([
      userMessage([{ key: 'long.docx', mediaType: OFFICE_MEDIA_TYPES.docx }]),
    ])
    const text = getTexts(messages[0])[1] as string
    const body = text.split('```md\n')[1]!.split('\n```')[0]!

    expect(new TextEncoder().encode(body).byteLength)
      .toBeLessThanOrEqual(OFFICE_TEXT_INLINE_MAX_BYTES)
    expect(body).not.toContain('�')
    expect(body.length).toBeGreaterThan(60_000)
    expect(text).toContain('[Truncated: only the first 200 KB')
  })

  it('caps a message at 512 KB of extracted text', async () => {
    const chunk = 'x'.repeat(OFFICE_TEXT_INLINE_MAX_BYTES)

    for (const key of ['1.docx', '2.docx', '3.docx', '4.docx']) {
      store(`${key}.text.md`, chunk)
    }

    stubOwnedFiles(['1.docx', '2.docx', '3.docx', '4.docx'].map((key) => {
      return officeRow(key, { textBytes: chunk.length })
    }))

    const { messages } = await convertFilesForAI([
      userMessage(['1.docx', '2.docx', '3.docx', '4.docx'].map((key) => {
        return { key, mediaType: OFFICE_MEDIA_TYPES.docx }
      })),
    ])
    const texts = getTexts(messages[0]).slice(1)
    const bodyBytes = texts.reduce((total, text) => {
      return total + (text.match(/x{100,}/g)?.[0]?.length ?? 0)
    }, 0)

    expect(bodyBytes).toBe(OFFICE_TEXT_MESSAGE_MAX_BYTES)
    expect(texts[2]).toContain('[Truncated: only the first 112 KB')
    expect(texts[3]).toContain('[Not included: this message already carries 512 KB')
  })

  it('applies the message budget per message', async () => {
    store('a.docx.text.md', 'x'.repeat(OFFICE_TEXT_INLINE_MAX_BYTES))
    stubOwnedFiles([officeRow('a.docx', { textBytes: 1 })])

    const first = userMessage([
      { key: 'a.docx', mediaType: OFFICE_MEDIA_TYPES.docx },
    ])
    const { messages } = await convertFilesForAI([
      first,
      { ...first, id: 'm2' },
    ])

    for (const message of messages) {
      expect(getTexts(message)[1]).not.toContain('[Not included')
    }
  })

  describe('with Run code files', () => {
    const container = (providerId: string) => ({
      container: { providerId, messageId: 'm1' },
    })

    it('replaces an unreadable Office file with a sandbox note when it is uploaded', async () => {
      stubOwnedFiles([officeRow('f.docx', {
        textStatus: 'failed',
        textBytes: null,
      })])

      const { messages, unsupportedFiles } = await convertFilesForAI([
        userMessage([{ key: 'f.docx', mediaType: OFFICE_MEDIA_TYPES.docx }]),
      ], container('anthropic'))

      expect(unsupportedFiles).toEqual([])
      expect(getFileParts(messages[0])).toEqual([])
      expect(getTexts(messages[0]).join('\n'))
        .toContain('[Available in the code sandbox.')
    })

    it('keeps the extracted text and adds nothing raw for an uploaded file', async () => {
      store('a.docx.text.md', 'Real text')
      stubOwnedFiles([officeRow('a.docx')])

      const { messages } = await convertFilesForAI([
        userMessage([{ key: 'a.docx', mediaType: OFFICE_MEDIA_TYPES.docx }]),
      ], container('openai'))

      expect(getFileParts(messages[0])).toEqual([])
      expect(getTexts(messages[0]).join('\n')).toContain('Real text')
    })

    it('hands a JSON file to an uploading provider as a note', async () => {
      stubOwnedFiles([officeRow('o.json', {
        type: 'application/json',
        textStatus: null,
      })])

      const { messages, unsupportedFiles } = await convertFilesForAI([
        userMessage([{ key: 'o.json', mediaType: 'application/json' }]),
      ], container('openai'))

      expect(unsupportedFiles).toEqual([])
      expect(getFileParts(messages[0])).toEqual([])
    })

    it('keeps an unreadable Office file and a JSON file inline for Gemini', async () => {
      store('f.docx', new Uint8Array([1, 2, 3]))
      store('o.json', new Uint8Array([4, 5]))
      stubOwnedFiles([
        officeRow('f.docx', { textStatus: 'failed', textBytes: null }),
        officeRow('o.json', { type: 'application/json', textStatus: null }),
      ])

      const { messages } = await convertFilesForAI([
        userMessage([
          { key: 'f.docx', mediaType: OFFICE_MEDIA_TYPES.docx },
          { key: 'o.json', mediaType: 'application/json' },
        ]),
      ], container('google'))

      expect(getFileParts(messages[0]).map((part) => {
        return [part.mediaType, part.url.startsWith('data:')]
      })).toEqual([
        [OFFICE_MEDIA_TYPES.docx, true],
        ['application/json', true],
      ])
    })

    it('sends both the text and the file inline for Gemini when the text is ready', async () => {
      store('a.docx', new Uint8Array([1, 2, 3]))
      store('a.docx.text.md', 'Real text')
      stubOwnedFiles([officeRow('a.docx')])

      const { messages } = await convertFilesForAI([
        userMessage([{ key: 'a.docx', mediaType: OFFICE_MEDIA_TYPES.docx }]),
      ], container('google'))

      expect(getFileParts(messages[0])).toHaveLength(1)
      expect(getTexts(messages[0]).join('\n')).toContain('Real text')
    })

    it('only applies to the message the sandbox receives', async () => {
      stubOwnedFiles([officeRow('f.docx', {
        textStatus: 'failed',
        textBytes: null,
      })])

      const { messages, unsupportedFiles } = await convertFilesForAI([
        userMessage([{ key: 'f.docx', mediaType: OFFICE_MEDIA_TYPES.docx }]),
      ], { container: { providerId: 'google', messageId: 'other' } })

      expect(getFileParts(messages[0])).toEqual([])
      expect(unsupportedFiles).toHaveLength(1)
    })
  })
})

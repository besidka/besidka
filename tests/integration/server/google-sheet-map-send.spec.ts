import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import { renderWorkbookMap } from '@besidka/doc-renderer/workbook-map'
import type { WorkbookCell } from '@besidka/doc-renderer/workbook-map'
import { buildModelContextMessages } from '~~/server/utils/files/assistant-files'
import { convertFilesForAI } from '~~/server/utils/files/convert-files-for-ai'
import {
  CARRIED_TEXT_FILE_MAX_BYTES,
} from '~~/server/utils/files/file-governance'
import { createCarriedMediaTypePredicate } from '~~/server/utils/files/carried-media-types'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  getOwnedFilesByStorageKeys: vi.fn(),
  getOwnedGeneratedImageFilesByStorageKeys: vi.fn(),
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

vi.mock('~~/server/utils/files/persist-file', () => ({
  persistFile: vi.fn(),
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
  WORKBOOK_MAP_EXTRACT_VERSION: 2,
  extractOfficeText: vi.fn(),
  rendererOffersWorkbookMap: vi.fn().mockResolvedValue(false),
}))

interface OwnedRow {
  id: string
  storageKey: string
  size: number
  type: string
  textStatus?: string | null
  textBytes?: number | null
  textVersion?: number | null
  externalSource?: string | null
}

const EMPTY_NOT_READ = {
  charts: 0,
  images: 0,
  pivotTables: 0,
  colorScales: 0,
  dataBars: 0,
  iconSets: 0,
  hyperlinks: 0,
}

function mapRow(key: string, overrides: Partial<OwnedRow> = {}): OwnedRow {
  return {
    id: key,
    storageKey: key,
    size: 4000,
    type: 'text/markdown',
    textStatus: 'ready',
    textBytes: 4000,
    textVersion: 2,
    externalSource: 'google',
    ...overrides,
  }
}

function bigMap(rows: number): string {
  const lines: WorkbookCell[] = []

  for (let row = 2; row <= rows + 1; row += 1) {
    lines.push(
      { row, column: 1, value: `Item ${row}` },
      { row, column: 2, value: String(row), formula: `A${row}*2` },
    )
  }

  const base = {
    visibility: 'visible' as const,
    frozenRows: 0,
    frozenColumns: 0,
    mergedRanges: [],
    validations: [],
    conditionalRules: [],
    notes: [],
    notRead: EMPTY_NOT_READ,
    cuts: [],
  }

  return renderWorkbookMap({
    names: [],
    sheetsTotal: 2,
    sheets: [
      { ...base, name: 'Lines', cells: lines },
      {
        ...base,
        name: 'Lists',
        cells: [{ row: 1, column: 1, value: 'Developer' }],
      },
    ],
  }).text
}

function userMessage(id: string, key: string, mediaType: string): UIMessage {
  return {
    id,
    role: 'user',
    parts: [
      { type: 'text', text: 'Summarize' },
      {
        type: 'file',
        url: `/files/${key}`,
        mediaType,
        filename: key,
      },
    ],
  }
}

function textOf(message: UIMessage | undefined): string {
  return (message?.parts ?? [])
    .filter(part => part.type === 'text')
    .map(part => (part as { text: string }).text)
    .join('\n')
}

describe('a Google Sheet map in a send', () => {
  let stored: Map<string, string>

  function stub(rows: OwnedRow[]) {
    mocks.getOwnedFilesByStorageKeys.mockResolvedValue(
      new Map(rows.map(row => [row.storageKey, row])),
    )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    stored = new Map()
    vi.stubGlobal('useEvent', () => ({}))
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
    vi.stubGlobal('useUnauthorizedError', () => new Error('Unauthorized'))
    vi.stubGlobal('useKV', () => ({
      get: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    }))
    vi.stubGlobal('useDb', () => ({}))
    vi.stubGlobal('useFileStorage', () => ({
      get: vi.fn(async (key: string) => {
        const content = stored.get(key)

        return content === undefined
          ? null
          : {
            text: async () => content,
            arrayBuffer: async () => new TextEncoder().encode(content).buffer,
          }
      }),
    }))
  })

  it('wraps the map with the Google Sheet note, decided by the stored '
    + 'columns', async () => {
    stored.set('g.md', '# Workbook map\n\n## Sheet: Lines\nUsed range A1:B2.')
    stub([mapRow('g.md')])

    const { messages } = await convertFilesForAI([
      userMessage('m1', 'g.md', 'text/markdown'),
    ])
    const text = textOf(messages[0])

    expect(text).toContain('**g.md** (Google Sheet)')
    expect(text).toContain('Workbook map of a Google Sheet. Included: the '
      + 'values as displayed, formulas as written in the Sheet')
    expect(text).toContain('```md\n# Workbook map')
  })

  it('gives other Markdown the plain file wrapper, whatever its text says',
    async () => {
      stored.set('doc.md', '# Workbook map\n\nA Google Doc.')
      stored.set('mine.md', '# Workbook map\n\nUploaded by the user.')
      stored.set('sheet.csv', 'a,b\n1,2\n')
      stub([
        mapRow('doc.md', { textStatus: null, textVersion: null }),
        mapRow('mine.md', { externalSource: null }),
        mapRow('sheet.csv', {
          type: 'text/csv',
          textStatus: null,
          textVersion: null,
        }),
      ])

      const { messages } = await convertFilesForAI([
        userMessage('m1', 'doc.md', 'text/markdown'),
        userMessage('m2', 'mine.md', 'text/markdown'),
        userMessage('m3', 'sheet.csv', 'text/csv'),
      ])

      for (const message of messages) {
        expect(textOf(message)).not.toContain('Google Sheet')
        expect(textOf(message)).not.toContain('Workbook map of a')
      }

      expect(textOf(messages[2])).toContain('```csv\na,b')
    })

  it('fits an earlier map to the carry size and keeps every formula',
    async () => {
      const map = bigMap(5000)

      expect(new TextEncoder().encode(map).byteLength)
        .toBeGreaterThan(CARRIED_TEXT_FILE_MAX_BYTES)
      stored.set('g.md', map)
      stub([mapRow('g.md', { size: 40_000 })])

      const { messages } = await convertFilesForAI([
        userMessage('earlier', 'g.md', 'text/markdown'),
        userMessage('latest', 'g.md', 'text/markdown'),
      ], {
        structureOnlyFiles: [{ messageId: 'earlier', storageKey: 'g.md' }],
      })
      const carried = textOf(messages[0])

      expect(new TextEncoder().encode(carried).byteLength)
        .toBeLessThan(CARRIED_TEXT_FILE_MAX_BYTES + 2048)
      expect(carried).toContain('- B2:B5001 ↓ =A2*2')
      expect(carried).toContain('Values were shortened in this earlier '
        + 'attachment')
      expect(textOf(messages[1])).not.toContain('Values were shortened')
    })

  it('charges a carried map a fixed size and sends it structure-only',
    () => {
      const textOnly = createCarriedMediaTypePredicate(['text'])
      const earlier = userMessage('earlier', 'g.md', 'text/markdown')
      const latest: UIMessage = {
        id: 'latest',
        role: 'user',
        parts: [{ type: 'text', text: 'And now?' }],
      }
      const withMapVersion = buildModelContextMessages([earlier, latest], {
        canCarryMediaType: textOnly,
        fileSizesByStorageKey: new Map([['g.md', 150 * 1024]]),
        spreadsheetTextVersionsByStorageKey: new Map([['g.md', 2]]),
      })
      const withoutIt = buildModelContextMessages([earlier, latest], {
        canCarryMediaType: textOnly,
        fileSizesByStorageKey: new Map([['g.md', 150 * 1024]]),
      })

      expect(withMapVersion.structureOnlyFiles).toEqual([
        { messageId: 'earlier', storageKey: 'g.md' },
      ])
      expect(withMapVersion.omittedFiles).toEqual([])
      expect(withoutIt.omittedFiles).toHaveLength(1)
      expect(withoutIt.structureOnlyFiles).toEqual([])
    })
})

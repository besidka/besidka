import { describe, expect, it } from 'vitest'
import {
  GOOGLE_FILE_ID_PREFIX,
  GOOGLE_FILE_KIND_ICONS,
  GOOGLE_FILE_KIND_LABELS,
  GOOGLE_FILE_KIND_TYPE_LABELS,
  buildGoogleFileOpenLink,
  getGoogleFileItemId,
  readGoogleCreatedFile,
  readGoogleFileToolCallId,
} from '../../../shared/utils/google-created-file'
import {
  GOOGLE_DOCS_ICON,
  GOOGLE_DRIVE_ICON,
  GOOGLE_SHEETS_ICON,
} from '../../../shared/utils/google-brand-icons'

const FILE_ID = 'abcdefghij1234567890'

function createPart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool-google__drive_create_file',
    toolCallId: 'call_1',
    state: 'output-available',
    input: {
      name: 'Plan',
      kind: 'document',
      content: '# Plan\n\n- one\n- two',
    },
    output: {
      references: [{
        id: FILE_ID,
        kind: 'file',
        title: 'Plan',
        link: `https://drive.google.com/open?id=${FILE_ID}`,
      }],
      bodyRemoved: true,
      note: 'The file was created.',
    },
    ...overrides,
  }
}

describe('buildGoogleFileOpenLink', () => {
  it('opens a document in Google Docs', () => {
    expect(buildGoogleFileOpenLink('document', FILE_ID))
      .toBe(`https://docs.google.com/document/d/${FILE_ID}/edit`)
  })

  it('opens a spreadsheet in Google Sheets', () => {
    expect(buildGoogleFileOpenLink('spreadsheet', FILE_ID))
      .toBe(`https://docs.google.com/spreadsheets/d/${FILE_ID}/edit`)
  })

  it('opens a text file in Google Drive', () => {
    expect(buildGoogleFileOpenLink('text', FILE_ID))
      .toBe(`https://drive.google.com/open?id=${FILE_ID}`)
  })

  it('accepts the full id alphabet', () => {
    expect(buildGoogleFileOpenLink('document', 'A-b_C-d_E-f_1234'))
      .toBe('https://docs.google.com/document/d/A-b_C-d_E-f_1234/edit')
  })

  it.each([
    ['a path traversal', '../../etc/passwd'],
    ['a slash', 'abcdefghij/1234567890'],
    ['a query', 'abcdefghij1234567890?x=1'],
    ['a fragment', 'abcdefghij1234567890#x'],
    ['a scheme', 'javascript:alert(1)'],
    ['a url', 'https://evil.example/abcdefghij'],
    ['a space', 'abcdefghij 1234567890'],
    ['a newline', 'abcdefghij\n1234567890'],
    ['too short', 'abc'],
    ['too long', 'a'.repeat(129)],
    ['empty', ''],
    ['a number', 1234567890123456],
    ['null', null],
    ['undefined', undefined],
  ])('returns no link for an id with %s', (_label, id) => {
    expect(buildGoogleFileOpenLink('document', id)).toBeNull()
  })

  it.each([
    'presentation',
    'folder',
    'Document',
    '',
    null,
    undefined,
    42,
  ])('returns no link for the kind %s', (kind) => {
    expect(buildGoogleFileOpenLink(kind, FILE_ID)).toBeNull()
  })
})

describe('readGoogleCreatedFile', () => {
  it('reads a file of the approved path', () => {
    expect(readGoogleCreatedFile(createPart({
      approval: { id: 'approval_1', approved: true },
    }))).toEqual({
      toolCallId: 'call_1',
      kind: 'document',
      title: 'Plan',
      content: '# Plan\n\n- one\n- two',
      id: FILE_ID,
      openLink: `https://docs.google.com/document/d/${FILE_ID}/edit`,
    })
  })

  it('reads a file of the Always allow path, which has no approval', () => {
    const file = readGoogleCreatedFile(createPart({
      input: { name: 'Budget', kind: 'spreadsheet', content: 'a,b\n1,2\n' },
      output: {
        references: [{ id: FILE_ID, kind: 'file', title: 'Budget' }],
        bodyRemoved: true,
      },
    }))

    expect(file?.kind).toBe('spreadsheet')
    expect(file?.title).toBe('Budget')
    expect(file?.content).toBe('a,b\n1,2\n')
    expect(file?.openLink)
      .toBe(`https://docs.google.com/spreadsheets/d/${FILE_ID}/edit`)
  })

  it('ignores the stored link and derives the link from the id', () => {
    const file = readGoogleCreatedFile(createPart({
      output: {
        references: [{
          id: FILE_ID,
          kind: 'file',
          title: 'Plan',
          link: 'https://evil.example/phish',
        }],
      },
    }))

    expect(file?.openLink)
      .toBe(`https://docs.google.com/document/d/${FILE_ID}/edit`)
  })

  it('cleans the title like the step does', () => {
    const file = readGoogleCreatedFile(createPart({
      output: {
        references: [{ id: FILE_ID, kind: 'file', title: '  Plan\n\n  v2  ' }],
      },
    }))

    expect(file?.title).toBe('Plan v2')
  })

  it('shortens a long title and names an empty one', () => {
    const long = readGoogleCreatedFile(createPart({
      output: {
        references: [{ id: FILE_ID, kind: 'file', title: 'a'.repeat(400) }],
      },
    }))
    const blank = readGoogleCreatedFile(createPart({
      output: {
        references: [{ id: FILE_ID, kind: 'file', title: ' \n ' }],
      },
    }))

    expect(long?.title).toHaveLength(160)
    expect(blank?.title).toBe('Untitled')
  })

  it.each([
    'input-streaming',
    'input-available',
    'approval-requested',
    'approval-responded',
    'output-error',
    'output-denied',
  ])('returns null in the state %s', (state) => {
    expect(readGoogleCreatedFile(createPart({ state }))).toBeNull()
  })

  it('returns null for another tool part', () => {
    expect(readGoogleCreatedFile(createPart({
      type: 'tool-google__drive_create_folder',
    }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({
      type: 'tool-create_document',
    }))).toBeNull()
  })

  it('returns null for anything that is not a part', () => {
    expect(readGoogleCreatedFile(null)).toBeNull()
    expect(readGoogleCreatedFile(undefined)).toBeNull()
    expect(readGoogleCreatedFile('text')).toBeNull()
    expect(readGoogleCreatedFile([])).toBeNull()
    expect(readGoogleCreatedFile({ type: 'text', text: 'x' })).toBeNull()
  })

  it('returns null for an unconfirmed call without a reference', () => {
    expect(readGoogleCreatedFile(createPart({ output: {} }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({
      output: { references: [] },
    }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({
      output: { references: 'x' },
    }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({ output: null }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({ output: undefined })))
      .toBeNull()
  })

  it('returns null for an invalid id', () => {
    expect(readGoogleCreatedFile(createPart({
      output: { references: [{ id: '../x', kind: 'file', title: 'Plan' }] },
    }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({
      output: { references: [{ kind: 'file', title: 'Plan' }] },
    }))).toBeNull()
  })

  it('returns null for a kind outside the map', () => {
    expect(readGoogleCreatedFile(createPart({
      input: { name: 'Plan', kind: 'presentation', content: 'x' },
    }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({
      input: { name: 'Plan', content: 'x' },
    }))).toBeNull()
  })

  it('returns null when the title or the content is not a string', () => {
    expect(readGoogleCreatedFile(createPart({
      output: { references: [{ id: FILE_ID, kind: 'file', title: 7 }] },
    }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({
      output: { references: [{ id: FILE_ID, kind: 'file' }] },
    }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({
      input: { name: 'Plan', kind: 'document', content: { text: 'x' } },
    }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({
      input: { name: 'Plan', kind: 'document' },
    }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({ input: null }))).toBeNull()
  })

  it('returns null without a tool call id', () => {
    expect(readGoogleCreatedFile(createPart({ toolCallId: '' }))).toBeNull()
    expect(readGoogleCreatedFile(createPart({ toolCallId: undefined })))
      .toBeNull()
  })
})

describe('Google file labels and ids', () => {
  it('names each product in full', () => {
    expect(GOOGLE_FILE_KIND_LABELS).toEqual({
      document: 'Google Docs',
      spreadsheet: 'Google Sheets',
      text: 'Google Drive',
    })
    expect(GOOGLE_FILE_KIND_TYPE_LABELS).toEqual({
      document: 'Google Doc',
      spreadsheet: 'Google Sheet',
      text: 'Text file',
    })
  })

  it('takes every logo from the brand constants', () => {
    expect(GOOGLE_FILE_KIND_ICONS).toEqual({
      document: GOOGLE_DOCS_ICON,
      spreadsheet: GOOGLE_SHEETS_ICON,
      text: GOOGLE_DRIVE_ICON,
    })
  })

  it('builds and reads the context item id', () => {
    expect(getGoogleFileItemId('call_1')).toBe(`${GOOGLE_FILE_ID_PREFIX}call_1`)
    expect(readGoogleFileToolCallId('google-file:call_1')).toBe('call_1')
    expect(readGoogleFileToolCallId('google-file:')).toBeNull()
    expect(readGoogleFileToolCallId('document:call_1')).toBeNull()
  })
})

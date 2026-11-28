import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME,
} from '#shared/utils/google-drive-tools'
import {
  GOOGLE_DRIVE_CSV_CELL_MAX_UNITS,
  GOOGLE_DRIVE_CSV_MAX_COLUMNS,
  GOOGLE_DRIVE_CSV_MAX_ROWS,
  GOOGLE_DRIVE_FILE_CONTENT_MAX_UNITS,
  GOOGLE_DRIVE_FILE_INPUT_MAX_BYTES,
  GOOGLE_DRIVE_FILE_KINDS,
  GOOGLE_DRIVE_FILE_KIND_SPECS,
  GOOGLE_DRIVE_FILE_REFUSAL_TEXT,
  GOOGLE_DRIVE_MARKDOWN_UPLOAD_MIME_TYPE,
  getDriveChangeHeading,
  parseStrictCsv,
  readDriveWriteApprovalView,
  validateCreateFileInput,
} from '#shared/utils/google-drive-write'
import { TOOL_APPROVAL_PAYLOAD_MAX_BYTES } from '#shared/utils/tool-approval-policy'
import { putToolApproval } from '~~/server/utils/tool-approval/kv'
import type { ToolApprovalPendingRecord } from '~~/server/utils/tool-approval/kv'

const FOLDER_ID = 'folder-id-0123456789'

function document(content: string) {
  return { name: 'Plan', kind: 'document', content }
}

function spreadsheet(content: string) {
  return { name: 'Totals', kind: 'spreadsheet', content }
}

function text(content: string) {
  return { name: 'Notes', kind: 'text', content }
}

describe('the kind map', () => {
  it('names a document, a spreadsheet and a text file', () => {
    expect([...GOOGLE_DRIVE_FILE_KINDS]).toEqual([
      'document',
      'spreadsheet',
      'text',
    ])
  })

  it('uploads Markdown, CSV and plain text and converts the first two', () => {
    expect(GOOGLE_DRIVE_FILE_KIND_SPECS).toEqual({
      document: {
        uploadMimeType: 'text/markdown',
        targetMimeType: 'application/vnd.google-apps.document',
        typeLabel: 'Google Doc, converted from Markdown',
      },
      spreadsheet: {
        uploadMimeType: 'text/csv',
        targetMimeType: 'application/vnd.google-apps.spreadsheet',
        typeLabel: 'Google Sheet, converted from CSV',
      },
      text: {
        uploadMimeType: 'text/plain',
        targetMimeType: 'text/plain',
        typeLabel: 'Plain text file',
      },
    })
  })

  it('keeps the Markdown upload type in one constant a document uses', () => {
    expect(GOOGLE_DRIVE_MARKDOWN_UPLOAD_MIME_TYPE).toBe('text/markdown')
    expect(GOOGLE_DRIVE_FILE_KIND_SPECS.document.uploadMimeType)
      .toBe(GOOGLE_DRIVE_MARKDOWN_UPLOAD_MIME_TYPE)
  })
})

describe('validateCreateFileInput', () => {
  it('reads a document, a spreadsheet and a text file', () => {
    expect(validateCreateFileInput(document('# Plan\n\nBody.'))).toEqual({
      ok: true,
      value: {
        name: 'Plan',
        kind: 'document',
        content: '# Plan\n\nBody.',
        folderId: null,
      },
    })
    expect(validateCreateFileInput(spreadsheet('a,b\n1,2\n')).ok).toBe(true)
    expect(validateCreateFileInput(text('plain')).ok).toBe(true)
  })

  it('reads a missing folder and the root alias as My Drive and keeps an id',
    () => {
      expect(validateCreateFileInput({ ...text('x'), folderId: 'root' }))
        .toMatchObject({ ok: true, value: { folderId: null } })
      expect(validateCreateFileInput({ ...text('x'), folderId: FOLDER_ID }))
        .toMatchObject({ ok: true, value: { folderId: FOLDER_ID } })
    })

  it.each([
    'short',
    'has spaces in it',
    '../../etc/passwd',
    'name = x or trashed = true',
    '',
  ])('refuses the folder %j', (folderId) => {
    expect(validateCreateFileInput({ ...text('x'), folderId })).toEqual({
      ok: false,
      message: GOOGLE_DRIVE_FILE_REFUSAL_TEXT.folder,
    })
  })

  it.each([
    ['a media type from the model', { ...text('x'), mimeType: 'text/html' }],
    ['an extra key', { ...text('x'), permissions: [] }],
    ['no name', { kind: 'text', content: 'x' }],
    ['a name with a slash', { name: 'a/b', kind: 'text', content: 'x' }],
    ['a name with a leading space', { name: ' a', kind: 'text', content: 'x' }],
    ['a name of 201 characters', { name: 'a'.repeat(201), kind: 'text', content: 'x' }],
    ['a name that is two dots', { name: '..', kind: 'text', content: 'x' }],
    ['no kind', { name: 'Plan', content: 'x' }],
    ['a kind outside the map', { name: 'Plan', kind: 'html', content: 'x' }],
    ['a kind with another case', { name: 'Plan', kind: 'Document', content: 'x' }],
    ['no content', { name: 'Plan', kind: 'text' }],
    ['empty content', text('')],
    ['white space only', text(' \n\t ')],
    ['content that is not text', { name: 'Plan', kind: 'text', content: 4 }],
    ['a null input', null],
    ['an array input', []],
  ])('refuses %s', (_label, input) => {
    expect(validateCreateFileInput(input).ok).toBe(false)
  })

  it.each([
    ['a control character', 'a\u0000b'],
    ['an escape character', 'a\u001Bb'],
    ['a lone carriage return', 'a\rb'],
    ['a right-to-left override', 'abc‮def'],
    ['a left-to-right mark', 'abc‎def'],
    ['a zero width space', 'abc​def'],
    ['a byte order mark', '﻿abc'],
    ['a line separator', 'a b'],
    ['a lone surrogate', 'a\uD800b'],
  ])('refuses %s in the content of every kind', (_label, content) => {
    for (const kind of GOOGLE_DRIVE_FILE_KINDS) {
      const refused = validateCreateFileInput({ name: 'Plan', kind, content })

      expect(refused, `${kind}`).toEqual({
        ok: false,
        message: GOOGLE_DRIVE_FILE_REFUSAL_TEXT.characters,
      })
    }
  })

  it('keeps tabs, line breaks, CRLF, emoji and joiners in the content', () => {
    expect(validateCreateFileInput(text('a\tb\nc\r\nd 👨‍👩‍👧 é Привіт')).ok)
      .toBe(true)
  })

  it('holds 12,000 units and refuses 12,001', () => {
    expect(GOOGLE_DRIVE_FILE_CONTENT_MAX_UNITS).toBe(12_000)
    expect(validateCreateFileInput(text('x'.repeat(12_000))).ok).toBe(true)
    expect(validateCreateFileInput(text('x'.repeat(12_001)))).toEqual({
      ok: false,
      message: GOOGLE_DRIVE_FILE_REFUSAL_TEXT.tooLong,
    })
  })

  it('counts UTF-16 units, so an emoji is two', () => {
    expect(validateCreateFileInput(text('😀'.repeat(6000))).ok).toBe(true)
    expect(validateCreateFileInput(text('😀'.repeat(6001))).ok).toBe(false)
  })

  it('never puts the content in a refusal', () => {
    for (const refusal of Object.values(GOOGLE_DRIVE_FILE_REFUSAL_TEXT)) {
      expect(refusal).not.toMatch(/IMPORTXML|script/)
    }
  })
})

describe('Markdown rules', () => {
  it.each([
    ['an image', '![alt](https://example.test/a.png)'],
    ['an image with no target', 'before ![x] after'],
    ['a script tag', '<script>alert(1)</script>'],
    ['an anchor tag', 'text <a href="https://example.test">x</a>'],
    ['a closing tag', 'x </div>'],
    ['a comment', 'x <!-- hidden --> y'],
    ['a processing instruction', '<?php echo 1 ?>'],
    ['an autolink', '<https://example.test>'],
    ['an uppercase tag', '<IMG SRC=x>'],
    ['a javascript link', '[x](javascript:alert(1))'],
    ['a mixed-case javascript link', '[x](JaVaScRiPt:alert(1))'],
    ['a data link', '[x](data:text/html;base64,AAAA)'],
    ['a file link', '[x](file:///etc/passwd)'],
    ['a link in angle brackets', '[x](<javascript:alert(1)>)'],
    ['a link after a space', '[x]( javascript:alert(1))'],
    ['a protocol-relative link', '[x](//evil.example/x)'],
    ['a relative link', '[x](../secret)'],
    ['an anchor link', '[x](#section)'],
    ['an empty link', '[x]()'],
    ['an encoded scheme', '[x](&#106;avascript:alert(1))'],
    ['a reference definition with a bad scheme', '[x][1]\n\n[1]: javascript:x'],
    ['an indented reference definition', '[x][1]\n\n   [1]: ftp://e.test/x'],
    ['a definition in a blockquote', '> [x]: javascript:alert(1)'],
    ['a definition in a list item', '- [x]: data:text/html,AAAA'],
    ['a definition with an escaped bracket', '[a\\]b]: javascript:x'],
    ['a definition with a label over two lines', '[a\nb]: javascript:x'],
    ['a definition with the target on the next line', '[x]:\n  javascript:x'],
    ['a definition with an angle-bracket target', '[x]: <data:text/html,A>'],
    ['a definition with no target', '[x]:'],
  ])('refuses %s', (_label, content) => {
    expect(validateCreateFileInput(document(content)).ok).toBe(false)
  })

  it.each([
    ['an https link', '[x](https://example.test/a?b=1)'],
    ['an http link', '[x](http://example.test)'],
    ['a mailto link', '[x](mailto:someone@example.test)'],
    ['an upper-case HTTPS link', '[x](HTTPS://example.test)'],
    ['a reference definition with https', '[x][1]\n\n[1]: https://e.test/x'],
    ['a footnote definition', 'Text[^1]\n\n[^1]: A note with words.'],
    ['a definition with https', '[x]: https://example.com'],
    ['a definition in a blockquote with https', '> [x]: HTTPS://example.com'],
    ['a footnote in a list item', '- [^note]: A note with words.'],
    ['a less-than sign before a space', 'when a < b then c'],
    ['a less-than sign before a digit', '1<2 and 3 <4'],
    ['a less-than sign at the end', 'a <'],
    ['headings, lists and tables', '# T\n\n- a\n- b\n\n| a | b |\n|---|---|\n| 1 | 2 |'],
    ['a bold exclamation', 'Wow! **bold** [not a link]'],
    ['code fences', '```ts\nconst a = 1\n```'],
  ])('accepts %s', (_label, content) => {
    expect(validateCreateFileInput(document(content)).ok, content).toBe(true)
  })

  it('reaches the same rules for the text and spreadsheet kinds as none', () => {
    expect(validateCreateFileInput(text('<script>x</script> ![x](y)')).ok)
      .toBe(true)
  })

  it('names the rule it broke without echoing the content', () => {
    expect(validateCreateFileInput(document('![x](y)'))).toEqual({
      ok: false,
      message: GOOGLE_DRIVE_FILE_REFUSAL_TEXT.markdownImage,
    })
    expect(validateCreateFileInput(document('<b>x</b>'))).toEqual({
      ok: false,
      message: GOOGLE_DRIVE_FILE_REFUSAL_TEXT.markdownHtml,
    })
    expect(validateCreateFileInput(document('[x](ftp://e.test)'))).toEqual({
      ok: false,
      message: GOOGLE_DRIVE_FILE_REFUSAL_TEXT.markdownLink,
    })
  })
})

describe('CSV rules', () => {
  it('reads plain, quoted and multi-line cells and a final line break', () => {
    expect(parseStrictCsv('a,b\n1,"x,y"\n"two\nlines","q""uote"\n')).toEqual({
      ok: true,
      value: [['a', 'b'], ['1', 'x,y'], ['two\nlines', 'q"uote']],
    })
    expect(parseStrictCsv('a,b\r\n1,2')).toEqual({
      ok: true,
      value: [['a', 'b'], ['1', '2']],
    })
    expect(parseStrictCsv('a,,c\n,,\n')).toEqual({
      ok: true,
      value: [['a', '', 'c'], ['', '', '']],
    })
    expect(parseStrictCsv('""\n')).toEqual({ ok: true, value: [['']] })
  })

  it.each([
    ['a quote inside a plain cell', 'a,b"c\n'],
    ['text after a closing quote', '"a"b,c\n'],
    ['an unterminated quote', 'a,"b\n'],
    ['an empty line in the middle', 'a,b\n\n1,2\n'],
    ['two final line breaks', 'a,b\n\n'],
    ['a short row', 'a,b,c\n1,2\n'],
    ['a long row', 'a,b\n1,2,3\n'],
    ['only a line break', '\n'],
  ])('refuses %s', (_label, content) => {
    expect(parseStrictCsv(content).ok).toBe(false)
    expect(validateCreateFileInput(spreadsheet(content)).ok).toBe(false)
  })

  it('allows 500 rows and refuses 501', () => {
    const rows = (count: number) => {
      return Array.from({ length: count }, (_unused, index) => {
        return `r${index},1`
      }).join('\n')
    }

    expect(GOOGLE_DRIVE_CSV_MAX_ROWS).toBe(500)
    expect(validateCreateFileInput(spreadsheet(rows(500))).ok).toBe(true)
    expect(validateCreateFileInput(spreadsheet(rows(501)))).toEqual({
      ok: false,
      message: GOOGLE_DRIVE_FILE_REFUSAL_TEXT.csvRows,
    })
  })

  it('allows 26 columns and refuses 27', () => {
    const columns = (count: number) => {
      return Array.from({ length: count }, (_unused, index) => {
        return `c${index}`
      }).join(',')
    }

    expect(GOOGLE_DRIVE_CSV_MAX_COLUMNS).toBe(26)
    expect(validateCreateFileInput(spreadsheet(columns(26))).ok).toBe(true)
    expect(validateCreateFileInput(spreadsheet(columns(27)))).toEqual({
      ok: false,
      message: GOOGLE_DRIVE_FILE_REFUSAL_TEXT.csvColumns,
    })
  })

  it('allows a cell of 2,000 units and refuses 2,001', () => {
    expect(GOOGLE_DRIVE_CSV_CELL_MAX_UNITS).toBe(2000)
    expect(validateCreateFileInput(spreadsheet(`${'x'.repeat(2000)},b`)).ok)
      .toBe(true)
    expect(validateCreateFileInput(spreadsheet(`a,${'x'.repeat(2001)}`)))
      .toEqual({ ok: false, message: GOOGLE_DRIVE_FILE_REFUSAL_TEXT.csvCell })
    expect(validateCreateFileInput(spreadsheet(`"${'x'.repeat(2001)}",b`)).ok)
      .toBe(false)
  })

  it.each([
    ['an equals sign', '=1+1'],
    ['an equals sign with IMPORTXML', '=IMPORTXML("https://e.test","//a")'],
    ['an equals sign with IMAGE', '=IMAGE("https://e.test/a.png")'],
    ['an equals sign with IMPORTDATA', '=IMPORTDATA("https://e.test/a.csv")'],
    ['an at sign', '@SUM(A1:A2)'],
    ['a plus formula', '+SUM(A1:A2)'],
    ['a minus formula', '-1+2'],
    ['a plus sign alone', '+'],
    ['a minus sign alone', '-'],
    ['a minus word', '-cmd|calc'],
    ['a leading space then an equals sign', '  =1+1'],
    ['a leading tab', '\t=1+1'],
    ['a leading tab then text', '\ttext'],
    ['a non-breaking space then an equals sign', ' =1+1'],
    ['a percent after a minus', '-5%'],
    ['a number with a comma', '-1,5'],
    ['an equals sign after a semicolon', 'a;=1+1'],
    ['an at sign after a semicolon', 'a;@SUM(A1)'],
    ['a plus formula after a semicolon', 'a;+SUM(A1)'],
    ['a minus formula after a semicolon', 'a;-1+2'],
    ['an equals sign after a semicolon and a space', 'a; =1+1'],
    ['an equals sign after a tab', 'a\t=1+1'],
    ['a minus word after a tab', 'a\t-cmd|calc'],
  ])('refuses %s as the first cell', (_label, cell) => {
    const quoted = `"${cell.replaceAll('"', '""')}",b\n`
    const isPlain = !/[,"\n]/.test(cell)

    expect(validateCreateFileInput(spreadsheet(quoted)).ok, quoted).toBe(false)

    if (isPlain) {
      expect(validateCreateFileInput(spreadsheet(`${cell},b\n`)).ok, cell)
        .toBe(false)
    }
  })

  it.each([
    ['a quoted equals sign', '"=1+1",b\n'],
    ['a quoted leading carriage return', '"\r\n=1",b\n'],
    ['a formula in a later column', 'a,=1\n'],
    ['a formula in a later row', 'a,b\n1,@x\n'],
    ['a formula in a quoted later cell', 'a,b\n1,"+SUM(A1)"\n'],
    ['a leading line break then a formula', '"\n=1",b\n'],
  ])('refuses %s', (_label, content) => {
    expect(validateCreateFileInput(spreadsheet(content)).ok, content)
      .toBe(false)
  })

  it.each([
    '-1',
    '+1',
    '-12.5',
    '+0.5',
    '-.5',
    '1e5',
    '-1.5e-3',
    '42',
    '3.14',
    '2026-12-01',
    'a=b',
    'x@example.test',
    'a; b',
    'x;1',
    'a;-5',
    'a\t5',
    'plus + minus - words',
    '  padded text',
  ])('accepts the cell %j', (cell) => {
    expect(validateCreateFileInput(spreadsheet(`${cell},b\n`)).ok).toBe(true)
  })

  it('judges a cell by its start only, so an equals sign on a later line '
    + 'of a quoted cell is text', () => {
    expect(validateCreateFileInput(spreadsheet('"x\n=1",b\n')).ok).toBe(true)
  })

  it('names the formula rule in the refusal', () => {
    expect(validateCreateFileInput(spreadsheet('=1'))).toEqual({
      ok: false,
      message: GOOGLE_DRIVE_FILE_REFUSAL_TEXT.csvFormula,
    })
  })
})

describe('the size of the largest valid input', () => {
  function byteLengthOf(value: unknown): number {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength
  }

  function largest(unit: string) {
    return {
      name: '一'.repeat(200),
      kind: 'text',
      content: unit.repeat(
        Math.floor(GOOGLE_DRIVE_FILE_CONTENT_MAX_UNITS / unit.length),
      ),
      folderId: 'f'.repeat(128),
    }
  }

  it.each([
    ['three-byte characters', '一'],
    ['quotes that JSON escapes', '"'],
    ['backslashes that JSON escapes', '\\'],
    ['line breaks that JSON escapes', 'a\n'],
    ['tabs that JSON escapes', 'a\t'],
    ['emoji, two units and four bytes', '😀'],
  ])('is valid and under both caps with %s', (_label, unit) => {
    const input = largest(unit)

    expect(validateCreateFileInput(input).ok, unit).toBe(true)
    expect(byteLengthOf(input)).toBeLessThanOrEqual(
      GOOGLE_DRIVE_FILE_INPUT_MAX_BYTES,
    )
    expect(byteLengthOf(input)).toBeLessThanOrEqual(
      TOOL_APPROVAL_PAYLOAD_MAX_BYTES,
    )
  })

  it('keeps the validator cap under the pending record cap', () => {
    expect(GOOGLE_DRIVE_FILE_INPUT_MAX_BYTES).toBe(48 * 1024)
    expect(GOOGLE_DRIVE_FILE_INPUT_MAX_BYTES)
      .toBeLessThan(TOOL_APPROVAL_PAYLOAD_MAX_BYTES)
    expect(TOOL_APPROVAL_PAYLOAD_MAX_BYTES).toBe(64 * 1024)
  })

  it('is held by the pending approval record, which writes it to KV',
    async () => {
      const input = largest('一')
      const values = new Map<string, string>()
      const kv = {
        put: vi.fn(async (key: string, value: string) => {
          values.set(key, value)
        }),
        get: vi.fn(async (key: string) => values.get(key) ?? null),
        delete: vi.fn(),
      }
      const record: ToolApprovalPendingRecord = {
        version: 1,
        userId: 7,
        chatPublicId: 'chat123',
        messagePublicId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
        toolCallId: 'call_1',
        family: 'google',
        access: 'write',
        toolName: GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME,
        connectorId: null,
        definitionHash: 'a'.repeat(64),
        input,
        signature: 'sig-value',
        reason: 'always-ask',
        rememberOptions: ['once'],
        summary: 'Create the text file',
        auditCallId: null,
        snapshot: {
          model: 'claude-haiku-4-5',
          gateway: null,
          reasoning: 'off',
          connectorIds: [],
        },
      }

      expect(validateCreateFileInput(input).ok).toBe(true)
      await expect(putToolApproval(kv as never, 'approval_abc123', record))
        .resolves.toBeUndefined()
      expect(kv.put).toHaveBeenCalledTimes(2)
      expect(JSON.parse(values.get('tool-approval:approval_abc123')!).input)
        .toEqual(input)
    })

  it('is refused by the pending record once it passes the record cap',
    async () => {
      const kv = { put: vi.fn(), get: vi.fn(), delete: vi.fn() }
      const record = {
        version: 1,
        userId: 7,
        chatPublicId: 'chat123',
        messagePublicId: '01JABCDEFGHJKMNPQRSTVWXYZ0',
        toolCallId: 'call_1',
        family: 'google',
        access: 'write',
        toolName: GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME,
        connectorId: null,
        definitionHash: 'a'.repeat(64),
        input: { content: '一'.repeat(TOOL_APPROVAL_PAYLOAD_MAX_BYTES / 3) },
        signature: 'sig-value',
        reason: 'always-ask',
        rememberOptions: ['once'],
        summary: 'Create the text file',
        auditCallId: null,
        snapshot: {
          model: 'claude-haiku-4-5',
          gateway: null,
          reasoning: 'off',
          connectorIds: [],
        },
      } as ToolApprovalPendingRecord

      await expect(putToolApproval(kv as never, 'approval_abc123', record))
        .rejects.toMatchObject({ status: 413 })
      expect(kv.put).not.toHaveBeenCalled()
    })
})

describe('the create-file card view', () => {
  function view(
    input: Record<string, unknown>,
    driveNames: Parameters<typeof readDriveWriteApprovalView>[2] = null,
  ) {
    return readDriveWriteApprovalView(
      GOOGLE_DRIVE_CREATE_FILE_TOOL_NAME,
      input,
      driveNames,
    )
  }

  it('shows a document with its type, size and whole content', () => {
    const body = '# Plan\n\nOne.\nTwo.'

    expect(view({ name: 'Plan', kind: 'document', content: body }))
      .toEqual({
        kind: 'create-file',
        name: 'Plan',
        fileKind: 'document',
        typeLabel: 'Google Doc, converted from Markdown',
        folder: { isRoot: true, name: null, id: null },
        sizeLabel: '17 bytes, 4 lines',
        contentCountLabel: '4 lines',
        content: body,
        rows: null,
      })
  })

  it('formats kilobytes with one decimal and counts singular lines', () => {
    expect(view({ name: 'Notes', kind: 'text', content: 'x'.repeat(8400) }))
      .toMatchObject({ sizeLabel: '8.2 KB, 1 line', contentCountLabel: '1 line' })
    expect(view({ name: 'Notes', kind: 'text', content: 'x' }))
      .toMatchObject({ sizeLabel: '1 byte, 1 line' })
  })

  it('shows a spreadsheet as rows with the count of rows and columns', () => {
    expect(view({
      name: 'Totals',
      kind: 'spreadsheet',
      content: 'item,count\npens,3\n',
    })).toMatchObject({
      typeLabel: 'Google Sheet, converted from CSV',
      sizeLabel: '2 rows, 2 columns',
      contentCountLabel: '2 rows',
      content: '',
      rows: [['item', 'count'], ['pens', '3']],
    })
    expect(view({ name: 'Totals', kind: 'spreadsheet', content: 'a\n' }))
      .toMatchObject({ sizeLabel: '1 row, 1 column' })
  })

  it('collapses long blank runs in a text file and in a cell', () => {
    const blank = '\n'.repeat(30)

    expect(view({ name: 'Notes', kind: 'text', content: `a${blank}b` }))
      .toMatchObject({ content: 'a\n[29 blank lines]\nb' })
    expect(view({
      name: 'Totals',
      kind: 'spreadsheet',
      content: `"a${blank}b",c\n`,
    })).toMatchObject({ rows: [['a\n[29 blank lines]\nb', 'c']] })
  })

  it('names the folder only for the id the server wrote it for', () => {
    const known = view(
      { name: 'Notes', kind: 'text', content: 'x', folderId: FOLDER_ID },
      { folder: { name: 'Projects', id: FOLDER_ID } },
    )
    const other = view(
      { name: 'Notes', kind: 'text', content: 'x', folderId: FOLDER_ID },
      { folder: { name: 'Other', id: 'other-id-0123456789' } },
    )

    expect(known).toMatchObject({
      folder: { isRoot: false, name: 'Projects', id: FOLDER_ID },
    })
    expect(other).toMatchObject({
      folder: { isRoot: false, name: null, id: FOLDER_ID },
    })
  })

  it('is null for an input the validator refuses and for another tool', () => {
    expect(view({ name: 'Totals', kind: 'spreadsheet', content: '=1' }))
      .toBeNull()
    expect(view({ name: 'Plan', kind: 'document', content: '<b>x</b>' }))
      .toBeNull()
    expect(view({ name: 'Notes', kind: 'text', content: 'x', mimeType: 'x' }))
      .toBeNull()
    expect(readDriveWriteApprovalView('google__gmail_create_draft', {
      name: 'Notes',
      kind: 'text',
      content: 'x',
    }, null)).toBeNull()
  })

  it('is case-insensitive about the tool name like the other views', () => {
    expect(readDriveWriteApprovalView(
      'GOOGLE__DRIVE_CREATE_FILE',
      { name: 'Notes', kind: 'text', content: 'x' },
      null,
    )).not.toBeNull()
  })

  it('headlines the details by File', () => {
    const result = view({ name: 'Notes', kind: 'text', content: 'x' })

    expect(getDriveChangeHeading(result!)).toBe('File')
  })
})

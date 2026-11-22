import { describe, expect, it } from 'vitest'
import {
  DRIVE_FILE_PART_TYPE,
  GOOGLE_DRIVE_COPY_LABEL,
  GOOGLE_DRIVE_EXPORTS,
  GOOGLE_DRIVE_FAILURE_REASONS,
  GOOGLE_PICKER_FRAME_SOURCES,
  buildDriveCopyName,
  buildDriveFileLink,
  driveFilePartFromFile,
  getDriveRefreshFailureReason,
  isDriveFilePart,
  isDriveFileReference,
  isDriveFileId,
  isDriveResourceKey,
  isGooglePickerPagePath,
  sanitizeDriveFileName,
  toDriveFilePart,
  withDriveFileParts,
} from '#shared/utils/google-drive'

const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz-_0123456789'

describe('Drive file ids and links', () => {
  it('accepts Drive id characters and nothing else', () => {
    expect(isDriveFileId(FILE_ID)).toBe(true)
    expect(isDriveFileId('short')).toBe(false)
    expect(isDriveFileId(`${FILE_ID}/../x`)).toBe(false)
    expect(isDriveFileId(`${FILE_ID}?alt=media`)).toBe(false)
    expect(isDriveFileId(42)).toBe(false)
    expect(isDriveResourceKey('0-abc_DEF')).toBe(true)
    expect(isDriveResourceKey('a b')).toBe(false)
    expect(isDriveResourceKey('')).toBe(false)
  })

  it('builds the link on the fixed Drive host', () => {
    expect(buildDriveFileLink(FILE_ID)).toBe(
      `https://drive.google.com/open?id=${FILE_ID}`,
    )
  })
})

describe('the data-drive-file part', () => {
  it('carries the id, name, type and a link, never content', () => {
    const part = toDriveFilePart({
      driveFileId: FILE_ID,
      name: 'Budget',
      mimeType: 'text/csv',
    })

    expect(part).toEqual({
      type: DRIVE_FILE_PART_TYPE,
      data: {
        driveFileId: FILE_ID,
        name: 'Budget',
        mimeType: 'text/csv',
        link: `https://drive.google.com/open?id=${FILE_ID}`,
      },
    })
    expect(isDriveFilePart(part)).toBe(true)
  })

  it('tells a trusted part from the name-only share form', () => {
    const shareForm = {
      type: DRIVE_FILE_PART_TYPE,
      data: { driveFileId: '', name: 'Budget', mimeType: '', link: '' },
    }

    expect(isDriveFilePart(shareForm)).toBe(false)
    expect(isDriveFileReference(shareForm)).toBe(true)
    expect(isDriveFileReference({ type: 'text', text: 'x' })).toBe(false)
    expect(isDriveFileReference(null)).toBe(false)
  })

  it('derives the part from a stored Google copy only', () => {
    expect(driveFilePartFromFile({
      name: 'Budget (first sheet).csv',
      type: 'text/csv',
      externalSource: 'google',
      externalId: FILE_ID,
    })?.data).toMatchObject({ driveFileId: FILE_ID, mimeType: 'text/csv' })
    expect(driveFilePartFromFile({
      name: 'a.txt',
      type: 'text/plain',
      externalSource: null,
      externalId: null,
    })).toBeNull()
    expect(driveFilePartFromFile({
      name: 'a.txt',
      type: 'text/plain',
      externalSource: 'google',
      externalId: 'not an id',
    })).toBeNull()
  })

  it('puts the reference right after the file part it belongs to', () => {
    const fileParts = [{ type: 'file', url: '/files/a' }, {
      type: 'file',
      url: '/files/b',
    }]
    const parts = withDriveFileParts([
      { name: 'a', type: 'text/plain' },
      {
        name: 'b',
        type: 'text/plain',
        externalSource: 'google',
        externalId: FILE_ID,
      },
    ], fileParts)

    expect(parts.map(part => part.type)).toEqual([
      'file',
      'file',
      DRIVE_FILE_PART_TYPE,
    ])
  })
})

describe('copy names and export choices', () => {
  it('names a sheet copy after its first sheet', () => {
    const choice = GOOGLE_DRIVE_EXPORTS['application/vnd.google-apps.spreadsheet']!

    expect(buildDriveCopyName('Budget', choice)).toBe(
      'Budget (first sheet).csv',
    )
    expect(choice.note).toBe('Only the first sheet is included.')
  })

  it('exports Docs to Markdown with a plain text fallback', () => {
    expect(GOOGLE_DRIVE_EXPORTS['application/vnd.google-apps.document'])
      .toMatchObject({
        mimeType: 'text/markdown',
        extension: 'md',
        fallback: { mimeType: 'text/plain', extension: 'txt' },
      })
    expect(GOOGLE_DRIVE_EXPORTS['application/vnd.google-apps.presentation']
      ?.mimeType).toBe('text/plain')
  })

  it('keeps a copy name within 255 characters', () => {
    const name = buildDriveCopyName('x'.repeat(400), {
      extension: 'md',
    })

    expect(name).toHaveLength(255)
    expect(name.endsWith('.md')).toBe(true)
  })

  it('has a plain reason for every failure code', () => {
    for (const reason of Object.values(GOOGLE_DRIVE_FAILURE_REASONS)) {
      expect(reason.length).toBeGreaterThan(10)
    }
  })

  it('states the real limits in the size reasons', () => {
    expect(GOOGLE_DRIVE_FAILURE_REASONS.too_large).toContain('20 MB')
    expect(GOOGLE_DRIVE_FAILURE_REASONS.export_too_large).toContain('10 MB')
  })

  it('does not promise a retention period in the copy label', () => {
    expect(GOOGLE_DRIVE_COPY_LABEL).not.toMatch(/\d/)
  })
})

describe('sanitizeDriveFileName', () => {
  it('turns control characters and separators into single spaces', () => {
    expect(sanitizeDriveFileName('a/b\\c\u0000\n\td‮e.txt'))
      .toBe('a b c d e.txt')
  })

  it('falls back when nothing printable is left', () => {
    expect(sanitizeDriveFileName('\u0000/\\\n')).toBe('Google Drive file')
  })

  it('keeps a short extension when it cuts a long name', () => {
    const name = sanitizeDriveFileName(`${'x'.repeat(400)}.pdf`)

    expect(name).toHaveLength(255)
    expect(name.endsWith('.pdf')).toBe(true)
  })

  it('cleans the base of an export name too', () => {
    expect(buildDriveCopyName('Plan/2026\u0000', { extension: 'md' }))
      .toBe('Plan 2026.md')
  })
})

describe('Picker page and frame sources', () => {
  it('allows only the Picker path, on chat pages only', () => {
    expect(GOOGLE_PICKER_FRAME_SOURCES).toEqual([
      'https://docs.google.com/picker',
      'https://docs.google.com/picker/',
    ])
    expect(isGooglePickerPagePath('/chats/abc')).toBe(true)
    expect(isGooglePickerPagePath('/chats/new?x=1')).toBe(true)
    expect(isGooglePickerPagePath('/shared/abc')).toBe(false)
    expect(isGooglePickerPagePath('/admin/legal')).toBe(false)
    expect(isGooglePickerPagePath('/artifacts/token')).toBe(false)
    expect(isGooglePickerPagePath('/profile/keys')).toBe(false)
  })
})

describe('Drive refresh failure reasons', () => {
  it('has a reason for the two refresh-only codes', () => {
    expect(getDriveRefreshFailureReason('deleted')).toContain('in the trash')
    expect(getDriveRefreshFailureReason('not_a_copy'))
      .toContain('not a copy')
  })

  it('falls back to the import reasons for every other code', () => {
    expect(getDriveRefreshFailureReason('too_large'))
      .toBe(GOOGLE_DRIVE_FAILURE_REASONS.too_large)
    expect(getDriveRefreshFailureReason('no_access'))
      .toBe(GOOGLE_DRIVE_FAILURE_REASONS.no_access)
  })
})

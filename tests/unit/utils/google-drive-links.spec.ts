import { describe, expect, it } from 'vitest'
import {
  GOOGLE_DRIVE_LINKS_PER_MESSAGE_MAX,
  extractGoogleDriveLinks,
  parseGoogleDriveLink,
} from '#shared/utils/google-drive-links'

const FILE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz-_0123456789'
const OTHER_ID = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa-_9876543210'

describe('parseGoogleDriveLink', () => {
  it.each([
    ['document', `https://docs.google.com/document/d/${FILE_ID}/edit`],
    ['spreadsheet', `https://docs.google.com/spreadsheets/d/${FILE_ID}/edit#gid=0`],
    ['presentation', `https://docs.google.com/presentation/d/${FILE_ID}`],
    ['file', `https://drive.google.com/file/d/${FILE_ID}/view?usp=sharing`],
    ['file', `https://drive.google.com/open?id=${FILE_ID}`],
    ['document', `https://docs.google.com/document/u/0/d/${FILE_ID}/edit`],
  ])('reads a %s link', (kind, link) => {
    expect(parseGoogleDriveLink(link)).toEqual({ id: FILE_ID, kind })
  })

  it('keeps a resource key', () => {
    expect(parseGoogleDriveLink(
      `https://drive.google.com/file/d/${FILE_ID}/view?resourcekey=0-abc_DEF`,
    )).toEqual({ id: FILE_ID, kind: 'file', resourceKey: '0-abc_DEF' })
    expect(parseGoogleDriveLink(
      `https://drive.google.com/open?id=${FILE_ID}&resourcekey=0-key`,
    )).toMatchObject({ resourceKey: '0-key' })
  })

  it('drops a resource key that is not a plain key', () => {
    expect(parseGoogleDriveLink(
      `https://docs.google.com/document/d/${FILE_ID}?resourcekey=a%20b`,
    )).toEqual({ id: FILE_ID, kind: 'document' })
  })

  it.each([
    'http://docs.google.com/document/d/' + FILE_ID,
    `https://user:pw@docs.google.com/document/d/${FILE_ID}`,
    `https://docs.google.com:8443/document/d/${FILE_ID}`,
    `https://docs.google.com.evil.example/document/d/${FILE_ID}`,
    `https://evil.example/docs.google.com/document/d/${FILE_ID}`,
    `https://www.docs.google.com/document/d/${FILE_ID}`,
    `https://drive.google.com/drive/folders/${FILE_ID}`,
    `https://drive.google.com/drive/u/0/folders/${FILE_ID}`,
    `https://docs.google.com/forms/d/${FILE_ID}/edit`,
    `https://docs.google.com/document/d/short`,
    `https://docs.google.com/document/d/${FILE_ID}x%2Fy`,
    `https://drive.google.com/open?id=short`,
    `https://drive.google.com/uc?id=${FILE_ID}`,
    `https://drive.google.com/drive/my-drive`,
    'https://docs.google.com/document/',
    'not a link',
    '',
  ])('ignores %s', (link) => {
    expect(parseGoogleDriveLink(link)).toBeNull()
  })

  it('ignores a link longer than the cap', () => {
    expect(parseGoogleDriveLink(
      `https://docs.google.com/document/d/${FILE_ID}/edit?x=${'a'.repeat(3000)}`,
    )).toBeNull()
  })
})

describe('extractGoogleDriveLinks', () => {
  it('finds links inside a message, in order, one per file', () => {
    const text = `Please read https://docs.google.com/document/d/${FILE_ID}/edit `
      + `and https://drive.google.com/open?id=${OTHER_ID}. Again: `
      + `https://drive.google.com/file/d/${FILE_ID}/view then thanks`

    expect(extractGoogleDriveLinks(text)).toMatchObject([
      {
        id: FILE_ID,
        kind: 'document',
        url: `https://docs.google.com/document/d/${FILE_ID}/edit`,
      },
      {
        id: OTHER_ID,
        kind: 'file',
        url: `https://drive.google.com/open?id=${OTHER_ID}`,
      },
    ])
  })

  it('reads a link in Markdown and strips trailing punctuation', () => {
    expect(extractGoogleDriveLinks(
      `[the plan](https://docs.google.com/presentation/d/${FILE_ID}/edit).`,
    )).toMatchObject([{ id: FILE_ID, kind: 'presentation' }])
    expect(extractGoogleDriveLinks(
      `See https://docs.google.com/spreadsheets/d/${FILE_ID}/edit, thanks`,
    )).toMatchObject([{ id: FILE_ID, kind: 'spreadsheet' }])
  })

  it('stops at five links', () => {
    const ids = Array.from({ length: 8 }, (_unused, index) => {
      return `${index}AbCdEfGhIjKlMnOpQrStUvWxYz-_01234567`
    })
    const text = ids.map((id) => {
      return `https://docs.google.com/document/d/${id}/edit`
    }).join(' ')

    expect(extractGoogleDriveLinks(text)).toHaveLength(
      GOOGLE_DRIVE_LINKS_PER_MESSAGE_MAX,
    )
  })

  it('skips a short id at the very end of the text while typing', () => {
    const half = 'https://docs.google.com/document/d/1AbCdEfGhIjKlMn'

    expect(extractGoogleDriveLinks(half)).toEqual([])
    expect(extractGoogleDriveLinks(`${half} `)).toMatchObject([
      { id: '1AbCdEfGhIjKlMn', kind: 'document' },
    ])
    expect(extractGoogleDriveLinks(`${half}/edit`)).toMatchObject([
      { id: '1AbCdEfGhIjKlMn', kind: 'document' },
    ])
  })

  it('accepts a full-length id at the very end of the text', () => {
    expect(extractGoogleDriveLinks(
      `https://docs.google.com/document/d/${FILE_ID}`,
    )).toMatchObject([{ id: FILE_ID, kind: 'document' }])
  })

  it('ignores other links and folder links', () => {
    expect(extractGoogleDriveLinks(
      `https://example.com/document/d/${FILE_ID} `
      + `https://drive.google.com/drive/folders/${FILE_ID} done`,
    )).toEqual([])
  })
})

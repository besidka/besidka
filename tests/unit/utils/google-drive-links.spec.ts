import { describe, expect, it } from 'vitest'
import {
  GOOGLE_DRIVE_LINKS_PER_MESSAGE_MAX,
  extractGoogleDriveLinks,
  findGoogleDriveLinkRanges,
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

  it('reads an uppercase scheme and host, which URL parsing lowercases',
    () => {
      expect(parseGoogleDriveLink(
        `HTTPS://DOCS.GOOGLE.COM/document/d/${FILE_ID}/edit`,
      )).toEqual({ id: FILE_ID, kind: 'document' })
      expect(parseGoogleDriveLink(
        `https://Drive.Google.Com/open?id=${FILE_ID}`,
      )).toEqual({ id: FILE_ID, kind: 'file' })
    })

  it('treats the default port written out as no port, and any other as '
    + 'a foreign link', () => {
    expect(parseGoogleDriveLink(
      `https://docs.google.com:443/document/d/${FILE_ID}/edit`,
    )).toEqual({ id: FILE_ID, kind: 'document' })
    expect(parseGoogleDriveLink(
      `https://docs.google.com:444/document/d/${FILE_ID}/edit`,
    )).toBeNull()
  })

  it('refuses an open link with two id parameters, so no one id is '
    + 'picked for Besidka and another for Google', () => {
    expect(parseGoogleDriveLink(
      `https://drive.google.com/open?id=${FILE_ID}&id=${OTHER_ID}`,
    )).toBeNull()
    expect(parseGoogleDriveLink(
      `https://drive.google.com/open?id=${OTHER_ID}&id=${FILE_ID}`,
    )).toBeNull()
    expect(parseGoogleDriveLink(`https://drive.google.com/open?id=`))
      .toBeNull()
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

  it('skips links in fenced code blocks and inline code', () => {
    const fenced = [
      'Look at this snippet:',
      '```',
      `https://docs.google.com/document/d/${FILE_ID}/edit`,
      '```',
      `and https://docs.google.com/document/d/${OTHER_ID}/edit`,
    ].join('\n')
    const tilde = `~~~md\nhttps://drive.google.com/open?id=${FILE_ID}\n~~~\nend`
    const inline = `use \`https://docs.google.com/document/d/${FILE_ID}/edit\` `
      + `or https://docs.google.com/document/d/${OTHER_ID}/edit`

    expect(extractGoogleDriveLinks(fenced).map(link => link.id))
      .toEqual([OTHER_ID])
    expect(extractGoogleDriveLinks(tilde)).toEqual([])
    expect(extractGoogleDriveLinks(inline).map(link => link.id))
      .toEqual([OTHER_ID])
  })

  it('skips a link in a code block that is still open', () => {
    expect(extractGoogleDriveLinks(
      `\`\`\`\nhttps://docs.google.com/document/d/${FILE_ID}/edit\nmore `,
    )).toEqual([])
  })

  it('keeps a link after a lone backtick', () => {
    expect(extractGoogleDriveLinks(
      `it\`s https://docs.google.com/document/d/${FILE_ID}/edit `,
    )).toHaveLength(1)
  })

  it('treats an id of 28 characters as complete only with more text after '
    + 'it', () => {
    const shortId = '1AbCdEfGhIjKlMnOpQrStUvWxYz'

    expect(shortId).toHaveLength(27)
    expect(extractGoogleDriveLinks(
      `https://docs.google.com/document/d/${shortId}`,
    )).toEqual([])
    expect(extractGoogleDriveLinks(
      `https://docs.google.com/document/d/${shortId}0`,
    )).toHaveLength(1)
  })

  it('ignores other links and folder links', () => {
    expect(extractGoogleDriveLinks(
      `https://example.com/document/d/${FILE_ID} `
      + `https://drive.google.com/drive/folders/${FILE_ID} done`,
    )).toEqual([])
  })

  it('returns the match fields only, never the position', () => {
    expect(extractGoogleDriveLinks(
      `see https://docs.google.com/document/d/${FILE_ID}/edit`,
    )).toEqual([{
      id: FILE_ID,
      kind: 'document',
      url: `https://docs.google.com/document/d/${FILE_ID}/edit`,
    }])
  })
})

describe('findGoogleDriveLinkRanges', () => {
  const docUrl = `https://docs.google.com/document/d/${FILE_ID}/edit`
  const fileUrl = `https://drive.google.com/open?id=${OTHER_ID}`

  function slices(text: string): string[] {
    return findGoogleDriveLinkRanges(text).map((range) => {
      return text.slice(range.start, range.end)
    })
  }

  it('gives the offsets of every link, in reading order', () => {
    const text = `read ${docUrl} and ${fileUrl} please`

    expect(findGoogleDriveLinkRanges(text)).toEqual([
      { start: 5, end: 5 + docUrl.length },
      {
        start: text.indexOf(fileUrl),
        end: text.indexOf(fileUrl) + fileUrl.length,
      },
    ])
    expect(slices(text)).toEqual([docUrl, fileUrl])
  })

  it('leaves trailing punctuation outside the range', () => {
    expect(slices(`see ${docUrl}, then ${fileUrl}.`))
      .toEqual([docUrl, fileUrl])
  })

  it('keeps a second link to the same file', () => {
    expect(slices(`${docUrl} and again ${docUrl} ok`))
      .toEqual([docUrl, docUrl])
  })

  it('does not stop at the per-message cap', () => {
    const count = GOOGLE_DRIVE_LINKS_PER_MESSAGE_MAX + 3
    const text = Array.from({ length: count }, (_value, index) => {
      return `https://docs.google.com/document/d/${FILE_ID}${index}/edit`
    }).join(' ')

    expect(findGoogleDriveLinkRanges(text)).toHaveLength(count)
    expect(extractGoogleDriveLinks(text))
      .toHaveLength(GOOGLE_DRIVE_LINKS_PER_MESSAGE_MAX)
  })

  it('skips links inside code and keeps positions around them', () => {
    const text = `\`${docUrl}\` then ${fileUrl}\n\`\`\`\n${docUrl}\n\`\`\`\n`

    expect(slices(text)).toEqual([fileUrl])
    expect(findGoogleDriveLinkRanges(text)[0]!.start)
      .toBe(text.indexOf(fileUrl))
  })

  it('skips other hosts, folders and a half-typed trailing id', () => {
    const shortId = '1AbCdEfGhIjKlMnOpQrStUvWxYz'

    expect(findGoogleDriveLinkRanges(
      `https://example.com/document/d/${FILE_ID} `
      + `https://drive.google.com/drive/folders/${FILE_ID} done`,
    )).toEqual([])
    expect(findGoogleDriveLinkRanges(
      `https://docs.google.com/document/d/${shortId}`,
    )).toEqual([])
    expect(slices(`https://docs.google.com/document/d/${shortId}0`))
      .toHaveLength(1)
  })

  it('is empty for text without a Google link', () => {
    expect(findGoogleDriveLinkRanges('')).toEqual([])
    expect(findGoogleDriveLinkRanges('hello world')).toEqual([])
  })

  it('agrees with extractGoogleDriveLinks on which links exist', () => {
    const text = `a ${docUrl} b ${fileUrl} c \`${docUrl}\``

    expect(slices(text)).toEqual(extractGoogleDriveLinks(text).map((link) => {
      return link.url
    }))
  })
})

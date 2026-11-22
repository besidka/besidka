import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanMailField,
  decodeBodyData,
  decodeEncodedWords,
  dropQuotedLines,
  htmlToPlainText,
  readMailHeader,
  readMessageContent,
  sanitizeMailText,
} from '~~/server/utils/google/gmail-text'

const BIDI_OVERRIDE = String.fromCodePoint(0x202E)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200B)
const BYTE_ORDER_MARK = String.fromCodePoint(0xFEFF)
const LINE_SEPARATOR = String.fromCodePoint(0x2028)
const ESCAPE = String.fromCodePoint(0x1B)
const JOINER = String.fromCodePoint(0x200D)

function base64Url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url')
}

describe('htmlToPlainText', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('drops scripts, styles, head, comments and images with their content',
    () => {
      const text = htmlToPlainText(
        '<html><head><title>T</title><style>p{}</style></head><body>'
        + '<!-- c --><p>Hello</p><script>alert(1)</script>'
        + '<img src="https://t.example/a.gif" alt="pixel"><svg><text>S</text>'
        + '</svg>done</body></html>',
      )

      expect(text).toBe('Hello\ndone')
    })

  it('never fetches anything it finds in the markup', () => {
    const fetchSpy = vi.fn()

    vi.stubGlobal('fetch', fetchSpy)
    htmlToPlainText(
      '<img src="https://t.example/a.gif"><link href="https://t.example/s.css">'
      + '<a href="https://t.example/x">x</a><iframe src="https://t.example/f">',
    )

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('keeps http, https and mailto links as text and drops other schemes',
    () => {
      const text = htmlToPlainText(
        '<a href="https://a.example/p?x=1&amp;y=2">site</a> '
        + '<a href=\'mailto:bob@example.com\'>mail</a> '
        + '<a href="javascript:evil()">js</a> '
        + '<a href="data:text/html,x">data</a> '
        + '<a href="https://b.example">https://b.example</a>',
      )

      expect(text).toContain('site (https://a.example/p?x=1&y=2)')
      expect(text).toContain('mail (mailto:bob@example.com)')
      expect(text).toContain('js ')
      expect(text).not.toContain('javascript')
      expect(text).not.toContain('data:')
      expect(text).toContain('https://b.example')
      expect(text).not.toContain('https://b.example (https://b.example)')
    })

  it('turns blocks and list items into lines and decodes entities', () => {
    const text = htmlToPlainText(
      '<div>One&nbsp;&amp;&nbsp;two</div><ul><li>a</li><li>b &#169; &#x1F355;'
      + '</li></ul><p>x&unknown;y &#99999999;</p>',
    )

    expect(text).toContain('One & two')
    expect(text).toContain('- a\n- b © 🍕')
    expect(text).toContain('x&unknown;y &#99999999;')
  })

  it('survives unclosed tags and very large hostile input quickly', () => {
    const started = Date.now()

    expect(htmlToPlainText('a < b and <b unclosed')).toContain('a')
    htmlToPlainText('<a'.repeat(300_000))
    htmlToPlainText('<!--'.repeat(100_000))
    htmlToPlainText('<script>'.repeat(100_000))
    htmlToPlainText('&'.repeat(500_000))
    htmlToPlainText(`<a href="${'x'.repeat(5000)}">y</a>`)

    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('strips hidden and bidi characters from the result', () => {
    const text = htmlToPlainText(
      `<p>a${ZERO_WIDTH_SPACE}b${BIDI_OVERRIDE}c${BYTE_ORDER_MARK}</p>`,
    )

    expect(text).toBe('abc')
  })
})

describe('sanitizeMailText', () => {
  it('removes controls and format characters and keeps line breaks', () => {
    expect(sanitizeMailText(
      `a${ESCAPE}b\tc\r\nd${LINE_SEPARATOR}e${ZERO_WIDTH_SPACE}f${BIDI_OVERRIDE}`,
    )).toBe('ab c\nd\nef')
  })

  it('keeps emoji joiners and ordinary text', () => {
    expect(sanitizeMailText(`👨${JOINER}👩 café Привіт`))
      .toBe(`👨${JOINER}👩 café Привіт`)
  })
})

describe('cleanMailField', () => {
  it('puts a header on one line and cuts it', () => {
    expect(cleanMailField('a\r\nBcc: b\n c', 100)).toBe('a Bcc: b c')
    expect(cleanMailField('x'.repeat(300), 50)).toHaveLength(50)
    expect(cleanMailField(undefined, 10)).toBe('')
  })
})

describe('decodeEncodedWords', () => {
  it('decodes B and Q words and joins adjacent words', () => {
    const word = (text: string) => {
      return `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=`
    }

    expect(decodeEncodedWords(`${word('Привіт ')} \r\n ${word('світ')}`))
      .toBe('Привіт світ')
    expect(decodeEncodedWords('=?UTF-8?Q?Caf=C3=A9_menu?=')).toBe('Café menu')
    expect(decodeEncodedWords('=?ISO-8859-1?Q?caf=E9?=')).toBe('café')
  })

  it('leaves plain and malformed values alone', () => {
    expect(decodeEncodedWords('Plain subject')).toBe('Plain subject')
    expect(decodeEncodedWords('=?UTF-8?X?abc?=')).toBe('=?UTF-8?X?abc?=')
    expect(decodeEncodedWords('=?no-such-charset?B?aGk=?=')).toContain('hi')
  })
})

describe('decodeBodyData', () => {
  it('decodes by the declared charset and refuses huge data', () => {
    const latin1 = Buffer.from('café', 'latin1').toString('base64url')

    expect(decodeBodyData(latin1, 'text/plain; charset=ISO-8859-1'))
      .toBe('café')
    expect(decodeBodyData(base64Url('héllo'), null)).toBe('héllo')
    expect(decodeBodyData('x'.repeat(4 * 1024 * 1024), null)).toBe('')
    expect(decodeBodyData('***', null)).toBe('')
  })
})

describe('dropQuotedLines', () => {
  it('replaces each run of quoted lines with one note', () => {
    expect(dropQuotedLines('hi\n> a\n> b\nmiddle\n  > c\nbye')).toBe(
      'hi\n[quoted text omitted]\nmiddle\n[quoted text omitted]\nbye',
    )
  })
})

describe('readMailHeader', () => {
  it('reads a header by any letter case and ignores bad entries', () => {
    const headers = [null, { name: 5 }, { name: 'SuBjEcT', value: 'x' }]

    expect(readMailHeader(headers, 'subject')).toBe('x')
    expect(readMailHeader(headers, 'from')).toBeNull()
    expect(readMailHeader(undefined, 'from')).toBeNull()
  })
})

describe('readMessageContent', () => {
  it('prefers text/plain and lists attachments without reading them', () => {
    const content = readMessageContent({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            { mimeType: 'text/plain', body: { data: base64Url('Plain body') } },
            {
              mimeType: 'text/html',
              body: { data: base64Url('<p>Html body</p>') },
            },
          ],
        },
        {
          mimeType: 'application/pdf',
          filename: `=?UTF-8?Q?Pl=C3=A1n.pdf?=${BIDI_OVERRIDE}`,
          body: { size: 2048, attachmentId: 'A1', data: base64Url('PDFDATA') },
        },
      ],
    })

    expect(content.text).toBe('Plain body')
    expect(content.attachments).toEqual([
      { name: 'Plán.pdf', mimeType: 'application/pdf', size: 2048 },
    ])
  })

  it('converts HTML when there is no plain part', () => {
    const content = readMessageContent({
      mimeType: 'text/html',
      body: { data: base64Url('<p>Only <i>html</i></p>') },
    })

    expect(content.text).toBe('Only html')
  })

  it('stops at a depth and part count limit', () => {
    let deep: Record<string, unknown> = {
      mimeType: 'text/plain',
      body: { data: base64Url('too deep') },
    }

    for (let level = 0; level < 20; level += 1) {
      deep = { mimeType: 'multipart/mixed', parts: [deep] }
    }

    expect(readMessageContent(deep).text).toBe('')

    const wide = readMessageContent({
      mimeType: 'multipart/mixed',
      parts: Array.from({ length: 200 }, (_, index) => ({
        mimeType: 'text/plain',
        body: { data: base64Url(`part-${index}`) },
      })),
    })

    expect(wide.text).toContain('part-0')
    expect(wide.text).not.toContain('part-150')
  })

  it('gives nothing for a payload that is not an object', () => {
    expect(readMessageContent(null)).toEqual({ text: '', attachments: [] })
    expect(readMessageContent('x')).toEqual({ text: '', attachments: [] })
  })
})

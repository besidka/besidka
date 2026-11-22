import { describe, expect, it } from 'vitest'
import {
  GMAIL_DRAFT_BODY_MAX_CHARACTERS,
  GMAIL_DRAFT_MAX_RECIPIENTS,
  GmailDraftError,
  buildGmailDraftMessage,
  buildGmailDraftRaw,
  parseMessageId,
  validateGmailDraft,
} from '~~/server/utils/google/gmail-message'
import type { GmailDraftInput } from '~~/server/utils/google/gmail-message'
import {
  hasUnsafeBodyCharacter,
  hasUnsafeHeaderCharacter,
  parseMailAddress,
} from '#shared/utils/mail-address'

const BASE: GmailDraftInput = {
  to: [{ address: 'alice@example.com' }],
  subject: 'Lunch on Friday',
  body: 'See you then.',
}

const LINE_SEPARATOR = String.fromCodePoint(0x2028)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200B)
const WORD_JOINER = String.fromCodePoint(0x2060)
const BYTE_ORDER_MARK = String.fromCodePoint(0xFEFF)
const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202E)
const RIGHT_TO_LEFT_ISOLATE = String.fromCodePoint(0x2067)
const LEFT_TO_RIGHT_EMBEDDING = String.fromCodePoint(0x202A)
const NUL = String.fromCodePoint(0x00)
const ESCAPE = String.fromCodePoint(0x1B)
const JOINER = String.fromCodePoint(0x200D)
const FAMILY = ['👨', '👩', '👧'].join(JOINER)

function decodeBase64(value: string): string {
  const bytes = Uint8Array.from(atob(value), (character) => {
    return character.charCodeAt(0)
  })

  return new TextDecoder().decode(bytes)
}

function decodeWords(value: string): string {
  const words = [...value.matchAll(/=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/g)]

  return words.map(word => decodeBase64(word[1]!)).join('')
}

function parseMessage(message: string) {
  const separator = message.indexOf('\r\n\r\n')
  const headLines = message.slice(0, separator).split('\r\n')
  const headers = new Map<string, string>()
  let current = ''

  for (const line of headLines) {
    if (line.startsWith(' ')) {
      headers.set(current, `${headers.get(current)}${line}`)

      continue
    }

    current = line.slice(0, line.indexOf(':'))
    headers.set(current, line.slice(line.indexOf(':') + 2))
  }

  const bodyText = message.slice(separator + 4)

  return {
    headLines,
    headers,
    bodyLines: bodyText.split('\r\n').filter(Boolean),
    body: decodeBase64(bodyText.replaceAll('\r\n', '')),
  }
}

function expectRefused(input: GmailDraftInput, code: string) {
  try {
    buildGmailDraftMessage(input)
  } catch (exception) {
    expect(exception).toBeInstanceOf(GmailDraftError)
    expect((exception as GmailDraftError).code).toBe(code)

    return
  }

  throw new Error('The draft was built')
}

describe('buildGmailDraftMessage', () => {
  it('writes fixed headers, CRLF line ends and a base64 body', () => {
    const message = buildGmailDraftMessage({
      ...BASE,
      cc: [{ address: 'bob@example.com', name: 'Bob Smith' }],
      bcc: [{ address: 'carol@example.com' }],
    })
    const parsed = parseMessage(message)

    expect(message).not.toMatch(/(?<!\r)\n/)
    expect(parsed.headers.get('MIME-Version')).toBe('1.0')
    expect(parsed.headers.get('To')).toBe('alice@example.com')
    expect(parsed.headers.get('Cc')).toBe('"Bob Smith" <bob@example.com>')
    expect(parsed.headers.get('Bcc')).toBe('carol@example.com')
    expect(parsed.headers.get('Subject')).toBe('Lunch on Friday')
    expect(parsed.headers.get('Content-Type')).toBe(
      'text/plain; charset="UTF-8"',
    )
    expect(parsed.headers.get('Content-Transfer-Encoding')).toBe('base64')
    expect(parsed.body).toBe('See you then.')
    expect(parsed.headers.has('From')).toBe(false)
  })

  it('normalizes line breaks in the body to CRLF', () => {
    const parsed = parseMessage(buildGmailDraftMessage({
      ...BASE,
      body: 'one\ntwo\rthree\r\nfour',
    }))

    expect(parsed.body).toBe('one\r\ntwo\r\nthree\r\nfour')
  })

  it.each([
    ['CRLF', 'Hi\r\nBcc: evil@example.com'],
    ['LF', 'Hi\nBcc: evil@example.com'],
    ['CR', 'Hi\rBcc: evil@example.com'],
    ['a line separator', `Hi${LINE_SEPARATOR}Bcc: evil@example.com`],
    ['NUL', `Hi${NUL}there`],
    ['a tab', 'Hi\tthere'],
  ])('refuses %s in the subject', (_label, subject) => {
    expectRefused({ ...BASE, subject }, 'invalid_subject')
  })

  it.each([
    ['CRLF', 'Eve\r\nBcc: evil@example.com'],
    ['LF', 'Eve\nBcc: evil@example.com'],
    ['a bidi override', `Eve${RIGHT_TO_LEFT_OVERRIDE}exe.txt`],
    ['a name that looks like an address', 'CEO <ceo@corp.example>'],
    ['an at sign', 'ceo@corp.example'],
    ['an angle bracket', 'Eve>'],
  ])('refuses %s in a display name', (_label, name) => {
    expectRefused(
      { ...BASE, to: [{ address: 'eve@example.com', name }] },
      'invalid_name',
    )
  })

  it.each([
    'eve@example.com\r\nBcc: evil@example.com',
    'eve@example.com\n',
    'eve@example.com\r',
    'eve@example.com>\r\nX-A: b',
    'a@b.com,c@d.com',
    'Eve <eve@example.com>',
    '"eve"@example.com',
    'eve@[127.0.0.1]',
    'eve@@example.com',
    'eve@example',
    'eve@exämple.com',
    'ève@example.com',
    ' eve@example.com',
    '',
  ])('refuses the address %j', (address) => {
    expectRefused({ ...BASE, to: [{ address }] }, 'invalid_address')
  })

  it('never builds a Bcc header from smuggled text', () => {
    const body = 'Hello\r\nBcc: evil@example.com\r\n\r\nMore'
    const message = buildGmailDraftMessage({ ...BASE, body })
    const parsed = parseMessage(message)

    expect(parsed.headers.has('Bcc')).toBe(false)
    expect(parsed.headLines.some(line => line.startsWith('Bcc'))).toBe(false)
    expect(parsed.body).toContain('Bcc: evil@example.com')
    expect(message).not.toContain('evil@example.com')
  })

  it('keeps a subject that merely mentions a header on one line', () => {
    const parsed = parseMessage(buildGmailDraftMessage({
      ...BASE,
      subject: 'Bcc: not a header',
    }))

    expect(parsed.headers.get('Subject')).toBe('Bcc: not a header')
    expect(parsed.headers.has('Bcc')).toBe(false)
  })

  it('encodes a Unicode subject and name as RFC 2047 words', () => {
    const subject = 'Обід з друзями 🍕 и 日本語 café'
    const name = 'Іван Петренко'
    const message = buildGmailDraftMessage({
      ...BASE,
      subject,
      to: [{ address: 'ivan@example.com', name }],
    })
    const parsed = parseMessage(message)

    expect(parsed.headers.get('Subject')).toContain('=?UTF-8?B?')
    expect(decodeWords(parsed.headers.get('Subject')!)).toBe(subject)
    expect(decodeWords(parsed.headers.get('To')!)).toBe(name)
    expect(parsed.headers.get('To')).toMatch(/ <ivan@example\.com>$/)
    expect(message).not.toMatch(/[^ -~\r\n]/)
  })

  it('never splits a multi-byte character across encoded words', () => {
    const subject = '🍕'.repeat(60)
    const parsed = parseMessage(buildGmailDraftMessage({ ...BASE, subject }))
    const words = parsed.headLines.join('').match(/=\?UTF-8\?B\?[^?]+\?=/g)!

    expect(words.length).toBeGreaterThan(1)

    for (const word of words) {
      expect(word.length).toBeLessThanOrEqual(75)
    }

    expect(decodeWords(parsed.headers.get('Subject')!)).toBe(subject)
  })

  it('allows emoji joiners and refuses invisible and bidi characters', () => {
    expect(() => buildGmailDraftMessage({ ...BASE, subject: FAMILY }))
      .not.toThrow()

    for (const character of [
      ZERO_WIDTH_SPACE,
      WORD_JOINER,
      BYTE_ORDER_MARK,
      RIGHT_TO_LEFT_OVERRIDE,
      RIGHT_TO_LEFT_ISOLATE,
    ]) {
      expectRefused({ ...BASE, subject: `a${character}b` }, 'invalid_subject')
      expectRefused({ ...BASE, body: `a${character}b` }, 'invalid_body')
    }
  })

  it('keeps every header line of a long subject under 998 characters', () => {
    const subject = 'word '.repeat(39).trim()
    const message = buildGmailDraftMessage({ ...BASE, subject })

    for (const line of message.split('\r\n')) {
      expect(line.length).toBeLessThanOrEqual(998)
    }

    expect(decodeWords(parseMessage(message).headers.get('Subject')!))
      .toBe(subject)
  })

  it('wraps an over-long body line and keeps the text exact', () => {
    const body = 'a'.repeat(GMAIL_DRAFT_BODY_MAX_CHARACTERS)
    const parsed = parseMessage(buildGmailDraftMessage({ ...BASE, body }))

    for (const line of parsed.bodyLines) {
      expect(line.length).toBeLessThanOrEqual(76)
    }

    expect(parsed.body).toBe(body)
  })

  it('refuses a body or subject over the caps and an empty one', () => {
    expectRefused(
      { ...BASE, body: 'a'.repeat(GMAIL_DRAFT_BODY_MAX_CHARACTERS + 1) },
      'body_too_long',
    )
    expectRefused({ ...BASE, subject: 'a'.repeat(201) }, 'invalid_subject')
    expectRefused({ ...BASE, subject: '   ' }, 'empty_subject')
    expectRefused({ ...BASE, body: ' \n ' }, 'empty_body')
  })

  it('refuses an empty recipient list and one with only cc or bcc', () => {
    expectRefused({ ...BASE, to: [] }, 'no_recipient')
    expectRefused(
      { ...BASE, to: [], cc: [{ address: 'bob@example.com' }] },
      'no_recipient',
    )
    expectRefused(
      { ...BASE, to: [], bcc: [{ address: 'bob@example.com' }] },
      'no_recipient',
    )
  })

  it('caps the recipients in total and drops duplicates', () => {
    const many = Array.from(
      { length: GMAIL_DRAFT_MAX_RECIPIENTS },
      (_, index) => ({ address: `user${index}@example.com` }),
    )

    expect(() => buildGmailDraftMessage({ ...BASE, to: many })).not.toThrow()
    expectRefused(
      { ...BASE, to: many, cc: [{ address: 'extra@example.com' }] },
      'too_many_recipients',
    )

    const deduped = validateGmailDraft({
      ...BASE,
      to: [{ address: 'Alice@Example.com' }],
      cc: [{ address: 'alice@example.com' }, { address: 'bob@example.com' }],
    })

    expect(deduped.to).toHaveLength(1)
    expect(deduped.cc).toEqual([{ address: 'bob@example.com' }])
  })

  it('escapes quotes and backslashes in a plain display name', () => {
    const parsed = parseMessage(buildGmailDraftMessage({
      ...BASE,
      to: [{ address: 'a@example.com', name: 'Al "the" \\ Boss' }],
    }))

    expect(parsed.headers.get('To')).toBe(
      '"Al \\"the\\" \\\\ Boss" <a@example.com>',
    )
  })

  it('writes reply headers only from a strict message id', () => {
    const parsed = parseMessage(buildGmailDraftMessage({
      ...BASE,
      inReplyTo: '<abc.123@mail.example.com>',
      references: ['<first@example.com>', '<abc.123@mail.example.com>'],
    }))

    expect(parsed.headers.get('In-Reply-To')).toBe('<abc.123@mail.example.com>')
    expect(parsed.headers.get('References')).toContain('<first@example.com>')

    for (const bad of [
      '<a@b.com>\r\nBcc: evil@example.com',
      'a@b.com',
      '<a b@c.com>',
      '<a@b.com><c@d.com>',
      '',
    ]) {
      expectRefused({ ...BASE, inReplyTo: bad }, 'invalid_message_id')
      expectRefused({ ...BASE, references: [bad] }, 'invalid_message_id')
    }
  })

  it('keeps the last ten references', () => {
    const references = Array.from({ length: 14 }, (_, index) => {
      return `<id${index}@example.com>`
    })
    const parsed = parseMessage(buildGmailDraftMessage({
      ...BASE,
      inReplyTo: '<id13@example.com>',
      references,
    }))
    const written = parsed.headers.get('References')!.match(/<[^>]+>/g)!

    expect(written).toHaveLength(10)
    expect(written[0]).toBe('<id4@example.com>')
  })

  it('returns a base64url raw value that decodes to the message', () => {
    const subject = 'Pâté?>'
    const raw = buildGmailDraftRaw({ ...BASE, subject })

    expect(raw).not.toMatch(/[+/\s]/)

    const message = decodeBase64(raw.replaceAll('-', '+').replaceAll('_', '/'))

    expect(message).toBe(buildGmailDraftMessage({ ...BASE, subject }))
  })
})

describe('parseMailAddress', () => {
  it.each([
    'a@b.co',
    'first.last+tag@sub.example.com',
    'o\'brien@example.org',
    'x@xn--80ak6aa92e.com',
  ])('accepts %s', (address) => {
    expect(parseMailAddress(address)).toBe(address)
  })

  it('refuses a non-string, a long address and a numeric top level', () => {
    expect(parseMailAddress(undefined)).toBeNull()
    expect(parseMailAddress(`${'a'.repeat(65)}@example.com`)).toBeNull()
    expect(parseMailAddress(`a@${'b'.repeat(250)}.com`)).toBeNull()
    expect(parseMailAddress('a@1.2.3.4')).toBeNull()
    expect(parseMailAddress('a..b@example.com')).toBeNull()
    expect(parseMailAddress('a@-example.com')).toBeNull()
  })
})

describe('character checks', () => {
  it('flags control, separator, bidi and invisible header characters', () => {
    expect(hasUnsafeHeaderCharacter('plain text ✓')).toBe(false)
    expect(hasUnsafeHeaderCharacter('a\nb')).toBe(true)
    expect(hasUnsafeHeaderCharacter(`a${RIGHT_TO_LEFT_OVERRIDE}b`)).toBe(true)
    expect(hasUnsafeHeaderCharacter(`a${ZERO_WIDTH_SPACE}b`)).toBe(true)
  })

  it('allows tabs and line breaks in a body but not other controls', () => {
    expect(hasUnsafeBodyCharacter('a\tb\r\nc')).toBe(false)
    expect(hasUnsafeBodyCharacter(`a${NUL}b`)).toBe(true)
    expect(hasUnsafeBodyCharacter(`a${ESCAPE}b`)).toBe(true)
    expect(hasUnsafeBodyCharacter(`a${LEFT_TO_RIGHT_EMBEDDING}b`)).toBe(true)
  })
})

describe('parseMessageId', () => {
  it('accepts a plain id and refuses anything else', () => {
    expect(parseMessageId('<CAF=abc+d@mail.gmail.com>')).toBe(
      '<CAF=abc+d@mail.gmail.com>',
    )
    expect(parseMessageId('<a@b>\n')).toBeNull()
    expect(parseMessageId(5)).toBeNull()
  })
})

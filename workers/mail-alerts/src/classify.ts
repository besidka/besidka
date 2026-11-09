import {
  MAIL_ALERT_MAILBOXES,
  type MailAlertMailbox,
} from '../../../shared/utils/mail-alert-protocol'

const ENCODED_WORD = /=\?([^?\s]+)\?([bq])\?([^?\s]*)\?=/gi

const WHITESPACE_BETWEEN_ENCODED_WORDS = /(\?=)\s+(?==\?)/g

const HEADER_FOLDING = /\r?\n[ \t]+/g

const COMBINING_MARKS = /\p{M}+/gu

export const HEADER_MAX_LENGTH = {
  subject: 1024,
  from: 512,
  authenticationResults: 1024,
} as const

const ANGLE_ADDRESS = /<([^<>]{0,320})>\s*$/

const DOMAIN = /^[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){1,10}$/

const URGENT_PHRASES = [
  'removal order',
  'nakaz usuniecia',
  'terrorist',
  'terrorystyczn',
  'illegal content',
  'csam',
  'child sexual',
  'court order',
  'subpoena',
  'takedown',
  '2021/784',
  'policj',
  'prokurat',
  'breach',
  'security incident',
  'security report',
  'security issue',
  'vulnerability',
  'naruszenie ochrony danych',
  'naruszenia ochrony danych',
  'naruszeniu ochrony danych',
  'naruszenie danych',
  'naruszenia danych',
  'naruszeniu danych',
  'naruszenie bezpieczenstwa',
  'naruszenia bezpieczenstwa',
  'incydent bezpieczenstwa',
  'wyciek',
  'podatnosc',
]

const URGENT_WORDS = [
  'abw',
  'tco',
  'cve',
  'uodo',
  'puodo',
  'csirt',
  'europol',
]

const AUTHORITY_SENDER_STEMS = ['policj', 'prokurat']

const AUTHORITY_SENDER_WORDS = ['abw', 'uodo', 'puodo', 'europol']

const ADDRESS_OR_ANGLE_ADDR
  = /<[^<>]{0,320}>|[^\s<>"'@,;:]{1,64}@[^\s<>"',;:]{1,255}/g

const AUTHORITY_DOMAIN_SUFFIXES = ['.gov.pl', '.europa.eu']

const AUTHORITY_DOMAINS = ['gov.pl', 'europa.eu']

const CLOUDFLARE_AUTHSERV_ID = /^mx\.cloudflare\.net(?:\s+\d{1,3})?\s*;/i

const AUTHENTICATION_RESULTS_SEPARATOR
  = /,\s*(?=[a-z0-9.-]{1,255}(?:\s+\d{1,3})?\s*;)/i

const DMARC_PASS = /(?:^|[\s;])dmarc=pass\b/i

function decodeBytes(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase()).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text)

  return Uint8Array.from(binary, (character) => {
    return character.charCodeAt(0)
  })
}

function decodeQuotedPrintableWord(text: string): Uint8Array {
  const bytes: number[] = []
  const source = text.replace(/_/g, ' ')

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] as string
    const hex = source.slice(index + 1, index + 3)

    if (character === '=' && /^[0-9a-f]{2}$/i.test(hex)) {
      bytes.push(Number.parseInt(hex, 16))
      index += 2

      continue
    }

    bytes.push(character.charCodeAt(0) & 0xFF)
  }

  return Uint8Array.from(bytes)
}

/**
 * Decodes RFC 2047 encoded words (`=?charset?B|Q?text?=`) in a raw header
 * value, so a Polish subject such as "nakaz usunięcia" can be matched and
 * shown. A word that does not decode is kept as it was.
 */
export function limitHeader(
  value: string | null,
  maxLength: number,
): string {
  return (value ?? '').slice(0, maxLength)
}

export function decodeHeaderValue(raw: string): string {
  const unfolded = raw
    .replace(HEADER_FOLDING, ' ')
    .replace(WHITESPACE_BETWEEN_ENCODED_WORDS, '$1')

  return unfolded.replace(
    ENCODED_WORD,
    (word, charset: string, encoding: string, text: string) => {
      try {
        const bytes = encoding.toLowerCase() === 'b'
          ? decodeBase64(text)
          : decodeQuotedPrintableWord(text)

        return decodeBytes(bytes, charset)
      } catch {
        return word
      }
    },
  )
}

export function normalizeForMatching(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/ł/g, 'l')
    .replace(/Ł/g, 'l')
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function containsWord(text: string, word: string): boolean {
  return new RegExp(`(?:^|[^a-z0-9])${word}(?:$|[^a-z0-9])`).test(text)
}

function looksUrgentText(text: string): boolean {
  return URGENT_PHRASES.some((phrase) => {
    return text.includes(phrase)
  }) || URGENT_WORDS.some((word) => {
    return containsWord(text, word)
  })
}

export function isDmarcPass(authenticationResults: string | null): boolean {
  if (!authenticationResults) {
    return false
  }

  const [firstResult = ''] = limitHeader(
    authenticationResults,
    HEADER_MAX_LENGTH.authenticationResults,
  ).split(AUTHENTICATION_RESULTS_SEPARATOR)
  const trimmed = firstResult.trim()

  if (!CLOUDFLARE_AUTHSERV_ID.test(trimmed)) {
    return false
  }

  return DMARC_PASS.test(trimmed)
}

/**
 * The domain of the From header's address: the last `<addr-spec>` when the
 * header has one, otherwise the whole value. A domain-like string in the
 * display name never counts.
 */
export function extractSenderDomain(header: string | null): string | null {
  const value = limitHeader(header, HEADER_MAX_LENGTH.from).trim()
  const address = ANGLE_ADDRESS.exec(value)?.[1] ?? value
  const domain = address.slice(address.lastIndexOf('@') + 1)
    .trim()
    .toLowerCase()

  if (!address.includes('@') || !DOMAIN.test(domain)) {
    return null
  }

  return domain
}

function isAuthorityDomain(domain: string): boolean {
  return AUTHORITY_DOMAINS.includes(domain)
    || AUTHORITY_DOMAIN_SUFFIXES.some((suffix) => {
      return domain.endsWith(suffix)
    })
}

export interface UrgencyInput {
  subject: string
  fromHeader: string | null
  authenticationResults: string | null
}

/**
 * Flags mail that may start a legal clock: a TCO removal order or another
 * authority request, or a breach or security report. Subject keywords and
 * an authority name in the From display name cannot be authenticated and are
 * matched as they are; an authority sender domain counts only when
 * Cloudflare's own DMARC result passed.
 */
export function isUrgentMail(input: UrgencyInput): boolean {
  const subject = normalizeForMatching(
    limitHeader(input.subject, HEADER_MAX_LENGTH.subject),
  )

  if (looksUrgentText(subject)) {
    return true
  }

  const displayName = normalizeForMatching(
    decodeHeaderValue(limitHeader(input.fromHeader, HEADER_MAX_LENGTH.from))
      .replace(ADDRESS_OR_ANGLE_ADDR, ' '),
  )
  const namesAuthority = AUTHORITY_SENDER_STEMS.some((stem) => {
    return displayName.includes(stem)
  }) || AUTHORITY_SENDER_WORDS.some((word) => {
    return containsWord(displayName, word)
  })

  if (namesAuthority) {
    return true
  }

  if (!isDmarcPass(input.authenticationResults)) {
    return false
  }

  const senderDomain = extractSenderDomain(input.fromHeader)

  return senderDomain !== null && isAuthorityDomain(senderDomain)
}

/**
 * Maps the envelope recipient to one of the alerting mailboxes. Plus
 * addressing (`privacy+tag@`) maps to the base mailbox; anything else gets
 * no alert, though it is still forwarded.
 */
export function resolveMailbox(recipient: string): MailAlertMailbox | null {
  const localPart = recipient.split('@')[0]?.split('+')[0]?.trim()
    .toLowerCase() ?? ''
  const mailbox = MAIL_ALERT_MAILBOXES.find((candidate) => {
    return candidate === localPart
  })

  return mailbox ?? null
}

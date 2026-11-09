export const MAIL_ALERT_MAILBOXES = [
  'privacy',
  'abuse',
  'security',
  'contact',
  'mail-alerts-test',
] as const

export type MailAlertMailbox = typeof MAIL_ALERT_MAILBOXES[number]

export const MAIL_ALERT_ROUTE = '/api/v1/internal/mail-alert'

export const MAIL_ALERT_TIMESTAMP_HEADER = 'x-mail-alert-timestamp'

export const MAIL_ALERT_SIGNATURE_HEADER = 'x-mail-alert-signature'

export const MAIL_ALERT_MAX_CLOCK_SKEW_SECONDS = 300

export const MAIL_ALERT_MAX_BODY_BYTES = 2048

export const MAIL_ALERT_SUBJECT_MAX_LENGTH = 80

export const MAIL_ALERT_RAW_SUBJECT_MAX_LENGTH = 1024

export const MAIL_ALERT_MIN_SECRET_LENGTH = 32

export interface MailAlertPayload {
  mailbox: MailAlertMailbox
  subject: string
  urgent: boolean
}

const INVISIBLE_OR_CONTROL_CHARACTERS
  = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\u2800]/gu

const WHITESPACE_RUN = /\s+/g

const TRUNCATION_MARK = '…'

/**
 * Turns an untrusted mail subject into one short line that is safe to show
 * on a lock screen: control, format (bidi, zero-width) and other
 * default-ignorable characters become spaces,
 * whitespace collapses, and the result is cut to a fixed number of code
 * points.
 */
export function sanitizeMailSubject(raw: string): string {
  const flattened = raw
    .slice(0, MAIL_ALERT_RAW_SUBJECT_MAX_LENGTH)
    .replace(INVISIBLE_OR_CONTROL_CHARACTERS, ' ')
    .replace(WHITESPACE_RUN, ' ')
    .trim()
  const codePoints = Array.from(flattened)

  if (codePoints.length <= MAIL_ALERT_SUBJECT_MAX_LENGTH) {
    return flattened
  }

  return codePoints
    .slice(0, MAIL_ALERT_SUBJECT_MAX_LENGTH - 1)
    .join('')
    .trimEnd() + TRUNCATION_MARK
}

function buildSignedContent(
  timestamp: string,
  body: string,
): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(`${timestamp}.${body}`))
}

function importSigningKey(secret: string, usage: 'sign' | 'verify') {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    [usage],
  )
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => {
    return byte.toString(16).padStart(2, '0')
  }).join('')
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) {
    return null
  }

  const bytes = new Uint8Array(hex.length / 2)

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }

  return bytes
}

export async function signMailAlert(
  secret: string,
  timestamp: string,
  body: string,
): Promise<string> {
  const key = await importSigningKey(secret, 'sign')
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    buildSignedContent(timestamp, body),
  )

  return toHex(signature)
}

/**
 * Checks an HMAC-SHA256 over `<timestamp>.<body>` in constant time and
 * rejects timestamps outside the allowed clock skew, so a captured request
 * cannot be replayed later.
 */
export async function verifyMailAlertSignature(input: {
  secret: string
  timestamp: string | undefined
  signature: string | undefined
  body: string
  nowSeconds: number
}): Promise<boolean> {
  if (
    input.secret.length < MAIL_ALERT_MIN_SECRET_LENGTH
    || !input.timestamp
    || !input.signature
  ) {
    return false
  }

  if (!/^\d{1,12}$/.test(input.timestamp)) {
    return false
  }

  const skew = Math.abs(input.nowSeconds - Number(input.timestamp))

  if (skew > MAIL_ALERT_MAX_CLOCK_SKEW_SECONDS) {
    return false
  }

  const signatureBytes = fromHex(input.signature.toLowerCase())

  if (!signatureBytes) {
    return false
  }

  const key = await importSigningKey(input.secret, 'verify')

  return crypto.subtle.verify(
    'HMAC',
    key,
    signatureBytes,
    buildSignedContent(input.timestamp, input.body),
  )
}

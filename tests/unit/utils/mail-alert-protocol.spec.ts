import { describe, expect, it } from 'vitest'
import {
  MAIL_ALERT_MAX_CLOCK_SKEW_SECONDS,
  MAIL_ALERT_SUBJECT_MAX_LENGTH,
  sanitizeMailSubject,
  signMailAlert,
  verifyMailAlertSignature,
} from '#shared/utils/mail-alert-protocol'

const SECRET = 'protocol-secret-0123456789abcdef0123'
const NOW = 1_800_000_000
const BODY = '{"mailbox":"privacy","subject":"Hi","urgent":false}'

const RIGHT_TO_LEFT_OVERRIDE = String.fromCodePoint(0x202E)
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200B)
const LINE_SEPARATOR = String.fromCodePoint(0x2028)
const SOFT_HYPHEN = String.fromCodePoint(0x00AD)
const HANGUL_FILLER = String.fromCodePoint(0x3164)
const TAG_LATIN_A = String.fromCodePoint(0xE0041)

async function verify(overrides: Partial<{
  secret: string
  timestamp: string | undefined
  signature: string | undefined
  body: string
  nowSeconds: number
}> = {}) {
  const timestamp = String(NOW)
  const signature = await signMailAlert(SECRET, timestamp, BODY)

  return verifyMailAlertSignature({
    secret: SECRET,
    timestamp,
    signature,
    body: BODY,
    nowSeconds: NOW,
    ...overrides,
  })
}

describe('sanitizeMailSubject', () => {
  it('turns control, bidi and zero-width characters into single spaces', () => {
    const raw = `Hello\r\n\tworld${RIGHT_TO_LEFT_OVERRIDE}fdp.exe`
      + `${ZERO_WIDTH_SPACE}x${LINE_SEPARATOR}y\u0007z${SOFT_HYPHEN}`
      + `${HANGUL_FILLER}${TAG_LATIN_A}end`

    expect(sanitizeMailSubject(raw)).toBe('Hello world fdp.exe x y z end')
  })

  it('keeps Polish letters and short subjects unchanged', () => {
    expect(sanitizeMailSubject('Nakaz usunięcia')).toBe('Nakaz usunięcia')
  })

  it('cuts long subjects by code point and marks the cut', () => {
    const subject = sanitizeMailSubject('ż'.repeat(200))

    expect(Array.from(subject)).toHaveLength(MAIL_ALERT_SUBJECT_MAX_LENGTH)
    expect(subject.endsWith('…')).toBe(true)
  })
})

describe('verifyMailAlertSignature', () => {
  it('accepts a fresh signature over the exact body', async () => {
    await expect(verify()).resolves.toBe(true)
  })

  it('rejects a tampered body, a wrong secret or a garbled signature', async () => {
    await expect(verify({ body: BODY.replace('false', 'true ') }))
      .resolves.toBe(false)
    await expect(verify({ secret: 'other-secret' })).resolves.toBe(false)
    await expect(verify({ signature: 'not-hex' })).resolves.toBe(false)
    await expect(verify({ signature: '' })).resolves.toBe(false)
    await expect(verify({ signature: undefined })).resolves.toBe(false)
  })

  it('rejects a timestamp outside the allowed clock skew', async () => {
    const late = NOW + MAIL_ALERT_MAX_CLOCK_SKEW_SECONDS + 1

    await expect(verify({ nowSeconds: late })).resolves.toBe(false)
    await expect(verify({ timestamp: 'abc' })).resolves.toBe(false)
  })

  it('rejects everything when the secret is empty or short', async () => {
    await expect(verify({ secret: '' })).resolves.toBe(false)
    await expect(verify({ secret: 'short' })).resolves.toBe(false)
  })
})

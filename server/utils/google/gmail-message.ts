import {
  MAIL_DISPLAY_NAME_MAX_LENGTH,
  hasUnsafeBodyCharacter,
  hasUnsafeHeaderCharacter,
  parseMailAddress,
} from '#shared/utils/mail-address'

export const GMAIL_DRAFT_MAX_RECIPIENTS = 20
export const GMAIL_DRAFT_SUBJECT_MAX_CHARACTERS = 200
export const GMAIL_DRAFT_BODY_MAX_CHARACTERS = 10_000
export const GMAIL_DRAFT_REFERENCES_MAX = 10
export const GMAIL_DRAFT_MESSAGE_MAX_BYTES = 100_000

const MESSAGE_ID_PATTERN
  = /^<[A-Za-z0-9!#$%&'*+/=?^_`{|}~.-]{1,200}@[A-Za-z0-9.-]{1,200}>$/
const PRINTABLE_ASCII_PATTERN = /^[ -~]*$/
const ENCODED_WORD_MARKER = '=?'
const PLAIN_TEXT_MAX_LENGTH = 60
const ENCODED_WORD_MAX_BYTES = 45
const BASE64_LINE_LENGTH = 76
const BASE64_CHUNK_BYTES = 0x8000
const LINE_BREAK = '\r\n'
const FOLD = `${LINE_BREAK} `

export type GmailDraftErrorCode
  = | 'no_recipient'
    | 'too_many_recipients'
    | 'invalid_address'
    | 'invalid_name'
    | 'invalid_subject'
    | 'empty_subject'
    | 'invalid_body'
    | 'empty_body'
    | 'body_too_long'
    | 'invalid_message_id'
    | 'message_too_large'

export class GmailDraftError extends Error {
  readonly code: GmailDraftErrorCode

  constructor(code: GmailDraftErrorCode, message: string) {
    super(message)
    this.name = 'GmailDraftError'
    this.code = code
  }
}

export interface GmailDraftRecipient {
  address: string
  name?: string
}

export interface GmailDraftInput {
  to: readonly GmailDraftRecipient[]
  cc?: readonly GmailDraftRecipient[]
  bcc?: readonly GmailDraftRecipient[]
  subject: string
  body: string
  inReplyTo?: string
  references?: readonly string[]
}

export interface GmailDraftRecipients {
  to: GmailDraftRecipient[]
  cc: GmailDraftRecipient[]
  bcc: GmailDraftRecipient[]
}

export interface GmailDraftContent extends GmailDraftRecipients {
  subject: string
  body: string
}

/**
 * A Message-ID in the strict form this builder accepts for the reply
 * headers. A header taken from someone else's mail that does not match is
 * left out, so the draft is created without threading instead of carrying
 * text nobody checked.
 */
export function parseMessageId(value: unknown): string | null {
  return typeof value === 'string' && MESSAGE_ID_PATTERN.test(value)
    ? value
    : null
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''

  for (let start = 0; start < bytes.length; start += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(
      ...bytes.subarray(start, start + BASE64_CHUNK_BYTES),
    )
  }

  return btoa(binary)
}

export function encodeBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_')
}

function splitIntoEncodedWordChunks(text: string): string[] {
  const encoder = new TextEncoder()
  const chunks: string[] = []
  let current = ''
  let currentBytes = 0

  for (const character of text) {
    const characterBytes = encoder.encode(character).byteLength

    if (currentBytes + characterBytes > ENCODED_WORD_MAX_BYTES) {
      chunks.push(current)
      current = ''
      currentBytes = 0
    }

    current += character
    currentBytes += characterBytes
  }

  if (current) {
    chunks.push(current)
  }

  return chunks
}

function encodeWords(text: string): string {
  const encoder = new TextEncoder()

  return splitIntoEncodedWordChunks(text)
    .map((chunk) => {
      return `=?UTF-8?B?${bytesToBase64(encoder.encode(chunk))}?=`
    })
    .join(FOLD)
}

function isPlainHeaderText(text: string): boolean {
  return PRINTABLE_ASCII_PATTERN.test(text)
    && !text.includes(ENCODED_WORD_MARKER)
    && text.length <= PLAIN_TEXT_MAX_LENGTH
    && text === text.trim()
}

function encodeHeaderText(text: string): string {
  return isPlainHeaderText(text) ? text : encodeWords(text)
}

function encodeDisplayName(name: string): string {
  if (isPlainHeaderText(name)) {
    return `"${name.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
  }

  return encodeWords(name)
}

function formatMailbox(recipient: GmailDraftRecipient): string {
  return recipient.name
    ? `${encodeDisplayName(recipient.name)} <${recipient.address}>`
    : recipient.address
}

function formatRecipientHeader(
  headerName: string,
  recipients: readonly GmailDraftRecipient[],
): string[] {
  if (recipients.length === 0) {
    return []
  }

  return [`${headerName}: ${recipients.map(formatMailbox).join(`,${FOLD}`)}`]
}

function normalizeLineBreaks(text: string): string {
  return text.replace(/\r\n|\r|\n/g, LINE_BREAK)
}

function encodeBody(body: string): string {
  const encoded = bytesToBase64(new TextEncoder().encode(body))
  const lines: string[] = []

  for (let start = 0; start < encoded.length; start += BASE64_LINE_LENGTH) {
    lines.push(encoded.slice(start, start + BASE64_LINE_LENGTH))
  }

  return lines.join(LINE_BREAK)
}

function validateRecipient(
  recipient: GmailDraftRecipient,
  seen: Set<string>,
): GmailDraftRecipient | null {
  const address = parseMailAddress(recipient.address)

  if (!address) {
    throw new GmailDraftError(
      'invalid_address',
      'A recipient is not a plain email address like name@example.com.',
    )
  }

  const key = address.toLowerCase()

  if (seen.has(key)) {
    return null
  }

  seen.add(key)

  if (recipient.name === undefined) {
    return { address }
  }

  if (
    hasUnsafeHeaderCharacter(recipient.name)
    || recipient.name.length > MAIL_DISPLAY_NAME_MAX_LENGTH
  ) {
    throw new GmailDraftError(
      'invalid_name',
      'A recipient name has a line break, a control or invisible character, '
      + `or is longer than ${MAIL_DISPLAY_NAME_MAX_LENGTH} characters.`,
    )
  }

  const name = recipient.name.trim()

  return name ? { address, name } : { address }
}

function validateRecipients(
  input: Pick<GmailDraftInput, 'to' | 'cc' | 'bcc'>,
): GmailDraftRecipients {
  const total = input.to.length
    + (input.cc?.length ?? 0)
    + (input.bcc?.length ?? 0)

  if (input.to.length === 0) {
    throw new GmailDraftError(
      'no_recipient',
      'A draft needs at least one recipient in "to".',
    )
  }

  if (total > GMAIL_DRAFT_MAX_RECIPIENTS) {
    throw new GmailDraftError(
      'too_many_recipients',
      `A draft takes at most ${GMAIL_DRAFT_MAX_RECIPIENTS} recipients in `
      + 'total.',
    )
  }

  const seen = new Set<string>()
  const validate = (recipients: readonly GmailDraftRecipient[] | undefined) => {
    return (recipients ?? []).flatMap((recipient) => {
      const valid = validateRecipient(recipient, seen)

      return valid ? [valid] : []
    })
  }

  return {
    to: validate(input.to),
    cc: validate(input.cc),
    bcc: validate(input.bcc),
  }
}

function validateSubject(subject: string): string {
  if (hasUnsafeHeaderCharacter(subject)) {
    throw new GmailDraftError(
      'invalid_subject',
      'The subject has a line break, a control or invisible character.',
    )
  }

  const trimmed = subject.trim()

  if (!trimmed) {
    throw new GmailDraftError('empty_subject', 'The subject is empty.')
  }

  if (trimmed.length > GMAIL_DRAFT_SUBJECT_MAX_CHARACTERS) {
    throw new GmailDraftError(
      'invalid_subject',
      `The subject is longer than ${GMAIL_DRAFT_SUBJECT_MAX_CHARACTERS} `
      + 'characters.',
    )
  }

  return trimmed
}

function validateBody(body: string): string {
  if (hasUnsafeBodyCharacter(body)) {
    throw new GmailDraftError(
      'invalid_body',
      'The body has a control character or a text direction control.',
    )
  }

  if (!body.trim()) {
    throw new GmailDraftError('empty_body', 'The body is empty.')
  }

  if (body.length > GMAIL_DRAFT_BODY_MAX_CHARACTERS) {
    throw new GmailDraftError(
      'body_too_long',
      `The body is longer than ${GMAIL_DRAFT_BODY_MAX_CHARACTERS} characters.`,
    )
  }

  return body
}

function validateMessageIds(
  inReplyTo: string | undefined,
  references: readonly string[] | undefined,
): { inReplyTo: string | null, references: string[] } {
  const parsedInReplyTo = inReplyTo === undefined
    ? null
    : parseMessageId(inReplyTo)

  if (inReplyTo !== undefined && !parsedInReplyTo) {
    throw new GmailDraftError(
      'invalid_message_id',
      'The In-Reply-To value is not a plain message id.',
    )
  }

  const parsedReferences = (references ?? []).map((reference) => {
    const parsed = parseMessageId(reference)

    if (!parsed) {
      throw new GmailDraftError(
        'invalid_message_id',
        'A References value is not a plain message id.',
      )
    }

    return parsed
  })

  return {
    inReplyTo: parsedInReplyTo,
    references: parsedReferences.slice(-GMAIL_DRAFT_REFERENCES_MAX),
  }
}

/**
 * Checks everything a draft is made of and returns it in the cleaned form
 * the approval card shows and the builder writes: one list of unique plain
 * addresses, a trimmed subject and the body as given. Never repairs a bad
 * value; a bad one throws a `GmailDraftError` with a sentence for the model.
 */
export function validateGmailDraft(
  input: Pick<GmailDraftInput, 'to' | 'cc' | 'bcc' | 'subject' | 'body'>,
): GmailDraftContent {
  return {
    ...validateRecipients(input),
    subject: validateSubject(input.subject),
    body: validateBody(input.body),
  }
}

/**
 * The RFC 2822 text of a plain-text draft. Pure. The header names are fixed
 * here and never come from input; every value is either checked to hold no
 * control character (so a CR or LF can never end a header early) or encoded
 * (RFC 2047 words, or base64 for the body). No `From`, `Date` or
 * `Message-ID`: Gmail adds them. There is no way to ask this function for
 * anything but a draft body; sending is a different Gmail method that
 * nothing here calls.
 */
export function buildGmailDraftMessage(input: GmailDraftInput): string {
  const content = validateGmailDraft(input)
  const ids = validateMessageIds(input.inReplyTo, input.references)
  const headers = [
    'MIME-Version: 1.0',
    ...formatRecipientHeader('To', content.to),
    ...formatRecipientHeader('Cc', content.cc),
    ...formatRecipientHeader('Bcc', content.bcc),
    ...(ids.inReplyTo ? [`In-Reply-To: ${ids.inReplyTo}`] : []),
    ...(ids.references.length > 0
      ? [`References: ${ids.references.join(FOLD)}`]
      : []),
    `Subject: ${encodeHeaderText(content.subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
  ]
  const message = `${headers.join(LINE_BREAK)}${LINE_BREAK}${LINE_BREAK}${
    encodeBody(normalizeLineBreaks(content.body))
  }${LINE_BREAK}`

  if (new TextEncoder().encode(message).byteLength
    > GMAIL_DRAFT_MESSAGE_MAX_BYTES) {
    throw new GmailDraftError(
      'message_too_large',
      'The draft is too large.',
    )
  }

  return message
}

/**
 * The `raw` value of `users.drafts.create`: the message as base64url.
 */
export function buildGmailDraftRaw(input: GmailDraftInput): string {
  return encodeBase64Url(
    new TextEncoder().encode(buildGmailDraftMessage(input)),
  )
}

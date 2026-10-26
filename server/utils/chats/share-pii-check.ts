import type { UIMessage } from 'ai'
import type {
  SharePiiCheckResult,
  SharePiiDetectorKind,
  SharePiiWarning,
} from '#shared/types/share-pii.d'
import { isPersistedMessageRole } from '#shared/utils/chat-message-role'
import { JEV_SHARE_PII_CHECK } from '#shared/utils/jev-policy'
import { REDACTION_PLACEHOLDER } from '#shared/utils/memory-policy'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import { filterPublicParts } from '~~/server/utils/chats/share-public-parts'
import { jevDecide } from '~~/server/utils/jev/client'
import type { JevStatus } from '~~/server/utils/jev/client'
import { recordJevRoleLog } from '~~/server/utils/jev/logging'
import type { JevLogger } from '~~/server/utils/jev/logging'
import { resolveJevRoleModel } from '~~/server/utils/jev/roles'
import { hasUserLegalConsent } from '~~/server/utils/legal/consent'
import { redactNeverStore } from '~~/server/utils/memory/compliance'

type DbClient = ReturnType<typeof useDb>

export interface SharePiiMessage {
  role: string
  parts: UIMessage['parts']
}

export interface SharePiiCheckInput {
  db: DbClient
  userId: number
  title: string | null
  messages: SharePiiMessage[]
  showFiles: boolean
  logger?: JevLogger
}

const DETECTOR_KIND_ORDER: readonly SharePiiDetectorKind[] = [
  'email',
  'phone',
  'payment-card',
  'iban',
  'national-id',
  'tax-id',
  'passport',
]

const SEGMENT_SEPARATOR = '\n\n'
const MIN_INTERNATIONAL_PHONE_DIGITS = 8
const MAX_INTERNATIONAL_PHONE_DIGITS = 15
const MIN_NATIONAL_PHONE_DIGITS = 9
const MAX_NATIONAL_PHONE_DIGITS = 12
const SURROGATE_RANGE_START = 0xD800
const SURROGATE_HIGH_RANGE_END = 0xDBFF

const EMAIL_PATTERN
  = /(?<![\p{L}\p{N}._%+-])[\p{L}\p{N}._%+-]+@((?:[\p{L}\p{N}-]+\.)+\p{L}{2,})(?![\p{L}\p{N}-])/gu
const RESERVED_EMAIL_DOMAIN_PATTERN
  = /(?:^|\.)example\.(?:com|org|net)$|\.(?:test|invalid|localhost|example)$/i
const INTERNATIONAL_PHONE_PATTERN
  = /(?<![\p{L}\p{N}+])\+\d[\d\s().-]{6,17}\d(?![\p{N}])/gu
const NATIONAL_PHONE_PATTERN
  = /(?<![\p{L}\p{N}])\(?\d{2,3}\)?[\s-]\d{3}[\s-]\d{2,4}(?:[\s-]\d{2,4})?(?![\p{N}])/gu

function countDigits(value: string): number {
  return value.replace(/\D/g, '').length
}

function findEmails(text: string): string[] {
  return [...text.matchAll(EMAIL_PATTERN)]
    .filter((match) => {
      return !RESERVED_EMAIL_DOMAIN_PATTERN.test(match[1]!)
    })
    .map(match => match[0])
}

function findPhones(text: string): string[] {
  const international = [...text.matchAll(INTERNATIONAL_PHONE_PATTERN)]
    .map(match => match[0])
    .filter((candidate) => {
      const digits = countDigits(candidate)

      return digits >= MIN_INTERNATIONAL_PHONE_DIGITS
        && digits <= MAX_INTERNATIONAL_PHONE_DIGITS
    })
  const national = [...text.matchAll(NATIONAL_PHONE_PATTERN)]
    .map(match => match[0])
    .filter((candidate) => {
      const digits = countDigits(candidate)

      return digits >= MIN_NATIONAL_PHONE_DIGITS
        && digits <= MAX_NATIONAL_PHONE_DIGITS
    })

  return [...international, ...national]
}

function describePart(
  part: UIMessage['parts'][number],
  showFiles: boolean,
): string | null {
  if (part.type === 'text' || part.type === 'reasoning') {
    return part.text
  }

  if (part.type === 'file' && showFiles && part.filename) {
    return part.filename
  }

  return null
}

/**
 * The text a public share would show, one segment per message plus the chat
 * title: text and reasoning parts, and file names only when the share shows
 * files. Tool parts are dropped by `filterPublicParts`, the same function the
 * shared view uses.
 */
export function collectSharedChatSegments(input: {
  title: string | null
  messages: SharePiiMessage[]
  showFiles: boolean
}): string[] {
  const segments: string[] = []

  if (input.title?.trim()) {
    segments.push(`Title: ${input.title}`)
  }

  const publicMessages = filterPublicParts(input.messages.filter((message) => {
    return isPersistedMessageRole(message.role)
  }))

  for (const message of publicMessages) {
    const text = message.parts
      .map(part => describePart(part, input.showFiles))
      .filter((piece): piece is string => Boolean(piece?.trim()))
      .join('\n')

    if (text) {
      segments.push(`${message.role === 'user' ? 'User' : 'Assistant'}: ${text}`)
    }
  }

  return segments
}

/**
 * Deterministic detectors over the shared text: email and phone patterns
 * plus the never-store detectors with checksums (payment card by Luhn, IBAN,
 * PESEL, a keyword-gated tax number including РНОКПП, passport). Returns each
 * kind once, in a fixed order, and the segments with every match replaced
 * for sending to TypeSafe AI. Never returns or logs a matched value.
 */
export function detectSharePii(segments: string[]): {
  kinds: SharePiiDetectorKind[]
  redactedSegments: string[]
} {
  const found = new Set<SharePiiDetectorKind>()
  const redactedSegments: string[] = []

  for (const segment of segments) {
    if (findEmails(segment).length > 0) {
      found.add('email')
    }

    if (findPhones(segment).length > 0) {
      found.add('phone')
    }

    const redaction = redactNeverStore(segment)

    for (const kind of DETECTOR_KIND_ORDER) {
      if ((redaction.blocked as Record<string, number | undefined>)[kind]) {
        found.add(kind)
      }
    }

    redactedSegments.push(
      redaction.text
        .replace(EMAIL_PATTERN, REDACTION_PLACEHOLDER)
        .replace(INTERNATIONAL_PHONE_PATTERN, REDACTION_PLACEHOLDER)
        .replace(NATIONAL_PHONE_PATTERN, REDACTION_PLACEHOLDER),
    )
  }

  return {
    kinds: DETECTOR_KIND_ORDER.filter(kind => found.has(kind)),
    redactedSegments,
  }
}

function splitToTokenLimit(text: string, maxTokens: number): string[] {
  if (estimateMemoryTokens(text) <= maxTokens || text.length < 2) {
    return [text]
  }

  let middle = Math.floor(text.length / 2)
  const previousCode = text.charCodeAt(middle - 1)

  if (
    previousCode >= SURROGATE_RANGE_START
    && previousCode <= SURROGATE_HIGH_RANGE_END
  ) {
    middle += 1
  }

  return [
    ...splitToTokenLimit(text.slice(0, middle), maxTokens),
    ...splitToTokenLimit(text.slice(middle), maxTokens),
  ]
}

/**
 * Packs whole segments into chunks of at most `maxTokens` estimated tokens
 * (the conservative default family, so Cyrillic is not undercounted); a
 * single segment above the cap is split in halves until each piece fits.
 */
export function chunkSharePiiSegments(
  segments: string[],
  maxTokens: number,
): string[] {
  const chunks: string[] = []
  let current: string[] = []
  let currentTokens = 0

  for (const segment of segments) {
    for (const piece of splitToTokenLimit(segment, maxTokens)) {
      const pieceTokens = estimateMemoryTokens(piece)

      if (current.length > 0 && currentTokens + pieceTokens > maxTokens) {
        chunks.push(current.join(SEGMENT_SEPARATOR))
        current = []
        currentTokens = 0
      }

      current.push(piece)
      currentTokens += pieceTokens
    }
  }

  if (current.length > 0) {
    chunks.push(current.join(SEGMENT_SEPARATOR))
  }

  return chunks
}

function buildDetectorWarnings(
  kinds: SharePiiDetectorKind[],
): SharePiiWarning[] {
  return kinds.map((kind) => {
    return { kind, source: 'detector' }
  })
}

async function askJev(input: {
  model: NonNullable<Awaited<ReturnType<typeof resolveJevRoleModel>>>
  chunks: string[]
  detectorWarnings: number
  logger?: JevLogger
}): Promise<{ isFlagged: boolean, isComplete: boolean }> {
  const policy = JEV_SHARE_PII_CHECK
  const deadline = AbortSignal.timeout(policy.timeoutMs)
  const scores: number[] = []
  let status: JevStatus = 'ok'
  let calls = 0
  let inputTokens = 0
  let latencyMs = 0
  let isFlagged = false
  let isComplete = true

  for (const chunk of input.chunks) {
    const result = await jevDecide({
      model: input.model,
      state: { [policy.stateKey]: chunk },
      questions: { [policy.questionId]: policy.question },
      timeoutMs: policy.timeoutMs,
      abortSignal: deadline,
    })

    calls += 1
    latencyMs += result.latencyMs

    if (!result.ok) {
      status = result.status
      isComplete = false
      break
    }

    inputTokens += result.inputTokens ?? 0

    const score = result.probabilities[policy.questionId]

    if (score === undefined) {
      status = 'error'
      isComplete = false
      break
    }

    scores.push(score)

    if (score >= policy.warnAtOrAbove) {
      isFlagged = true
      break
    }
  }

  recordJevRoleLog('sharePiiCheck', {
    status,
    calls,
    questions: calls,
    inputTokens,
    latencyMs,
    counts: {
      chunks: input.chunks.length,
      detectorWarnings: input.detectorWarnings,
      flagged: isFlagged ? 1 : 0,
    },
    scores,
  }, input.logger)

  return { isFlagged, isComplete }
}

/**
 * The share personal-data check. Deterministic detectors run first and their
 * warnings are always returned. TypeSafe AI Jev then reads the redacted text
 * in chunks only for a user with current legal consent, a saved TypeSafe AI
 * key and the `sharePiiCheck` role on, with one shared deadline. `checked`
 * is true only when Jev answered for every chunk it was asked about (or
 * flagged one); without a key, role or consent, or on any Jev failure, it is
 * false and the caller shows the generic reminder next to the detector
 * warnings. The result never carries text, and only counts and statuses are
 * logged.
 */
export async function checkSharedChatForPii(
  input: SharePiiCheckInput,
): Promise<SharePiiCheckResult> {
  const segments = collectSharedChatSegments(input)
  const { kinds, redactedSegments } = detectSharePii(segments)
  const warnings = buildDetectorWarnings(kinds)

  if (redactedSegments.length === 0) {
    return { warnings, checked: true }
  }

  const model = await resolveJevRoleModel({
    db: input.db,
    userId: input.userId,
    role: 'sharePiiCheck',
    logger: input.logger,
  })

  if (!model) {
    return { warnings, checked: false }
  }

  if (!await hasUserLegalConsent(input.userId, input.db)) {
    return { warnings, checked: false }
  }

  const outcome = await askJev({
    model,
    chunks: chunkSharePiiSegments(
      redactedSegments,
      JEV_SHARE_PII_CHECK.maxChunkTokens,
    ),
    detectorWarnings: warnings.length,
    logger: input.logger,
  })

  if (outcome.isFlagged) {
    warnings.push({ kind: 'personal-data', source: 'typesafe' })
  }

  return { warnings, checked: outcome.isFlagged || outcome.isComplete }
}

import { and, asc, count, eq, gte, isNull, lt, or, sql } from 'drizzle-orm'
import type { LegalNotice } from '#shared/utils/legal-notices'
import {
  LEGAL_NOTICES,
  getRequiredNoticeDays,
  parseNoticeEffectiveInstant,
  parseNoticeInstant,
} from '#shared/utils/legal-notices'
import * as schema from '~~/server/db/schema'
import {
  EMAIL_NOOP_MESSAGE_ID,
  EMAIL_NOT_CONFIGURED_CODE,
  getEmailErrorCode,
} from '~~/server/utils/email'
import type { RenderedEmail } from '~~/server/utils/email-template'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { buildLegalNoticeEmail } from '~~/server/utils/legal/notice-email'
import {
  renderLegalNoticeEmail,
  sendLegalNoticeEmail,
} from '~~/server/utils/legal/notice-sender'
import type {
  SendLegalNoticeEmailInput,
} from '~~/server/utils/legal/notice-sender'

type DbClient = ReturnType<typeof useDb>

export const LEGAL_NOTICE_MAX_ATTEMPTS = 3

export const LEGAL_NOTICE_FAILED_BACKOFF_MS = 30 * 60 * 1000

export const LEGAL_NOTICE_STALE_SENDING_MS = 60 * 60 * 1000

const MILLISECONDS_PER_DAY = 86_400_000

const QUOTA_ERROR_CODES: ReadonlySet<string> = new Set([
  'E_RATE_LIMIT_EXCEEDED',
  'E_DAILY_LIMIT_EXCEEDED',
])

const SYSTEMIC_ERROR_CODES: ReadonlySet<string> = new Set([
  EMAIL_NOT_CONFIGURED_CODE,
  'E_SENDER_NOT_VERIFIED',
  'E_SENDER_NOT_ALLOWED',
  'E_SENDER_DOMAIN_NOT_AVAILABLE',
  'E_RECIPIENT_NOT_ALLOWED',
])

export const LEGAL_NOTICE_FAILURE_STREAK_LIMIT = 3

const UNKNOWN_ERROR_CODE = 'E_UNKNOWN'

const NOOP_ERROR_CODE = 'E_EMAIL_NOOP'

const FOREIGN_KEY_ERROR_MESSAGE = 'FOREIGN KEY CONSTRAINT FAILED'

const FOREIGN_KEY_ERROR_CODE = 'SQLITE_CONSTRAINT_FOREIGNKEY'

export type LegalNoticeSweepStopReason
  = | 'no-active-notice'
    | 'completed'
    | 'quota'
    | 'daily-cap'
    | 'max-runtime'
    | 'consecutive-failures'
    | 'email-noop'
    | 'privacy-email-missing'
    | 'error'

export interface SweepLegalNoticesInput {
  batchSize: number
  maxRuntimeMs: number
  dailyCap: number
  privacyEmail: string
  logger?: { set: (fields: Record<string, unknown>) => void }
  db?: DbClient
  now?: () => Date
  notices?: readonly LegalNotice[]
  renderNotice?: (props: Record<string, unknown>) => Promise<RenderedEmail>
  sendNotice?: (
    input: SendLegalNoticeEmailInput,
  ) => Promise<{ messageId: string }>
}

export interface SweepLegalNoticesNoticeCount {
  noticeId: string
  selectedCount: number
  sentCount: number
  skippedCount: number
  failedCount: number
  lateDeliveries: number
}

export interface SweepLegalNoticesResult {
  selectedCount: number
  sentCount: number
  skippedCount: number
  failedCount: number
  lateDeliveries: number
  claimMissedCount: number
  userDeletedCount: number
  errorCodes: Record<string, number>
  notices: SweepLegalNoticesNoticeCount[]
  stopReason: LegalNoticeSweepStopReason
  runtimeMs: number
}

interface Candidate {
  userId: number
  email: string
}

interface Claim {
  id: number
  attempts: number
}

interface FailedClaim {
  claim: Claim
  errorCode: string
}

function isSkippableErrorCode(code: string): boolean {
  return code === 'E_RECIPIENT_SUPPRESSED' || code.startsWith('E_VALIDATION')
}

function isForeignKeyViolation(exception: unknown): boolean {
  let current: unknown = exception

  for (let depth = 0; depth < 5 && current; depth++) {
    const message = current instanceof Error
      ? current.message.toUpperCase()
      : ''
    const code = (current as { code?: unknown }).code

    if (
      message.includes(FOREIGN_KEY_ERROR_MESSAGE)
      || code === FOREIGN_KEY_ERROR_CODE
    ) {
      return true
    }

    current = current instanceof Error ? current.cause : undefined
  }

  return false
}

function startOfUtcDay(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / MILLISECONDS_PER_DAY)
    * MILLISECONDS_PER_DAY)
}

export function getNoticesInSendWindow(
  notices: readonly LegalNotice[],
  instant: Date,
): LegalNotice[] {
  const timestamp = instant.getTime()

  return notices
    .filter((notice) => {
      return parseNoticeInstant(notice.sendFrom) <= timestamp
        && timestamp < parseNoticeEffectiveInstant(notice.effectiveAt)
    })
    .sort((first, second) => {
      return parseNoticeInstant(first.sendFrom)
        - parseNoticeInstant(second.sendFrom)
    })
}

async function countSentToday(db: DbClient, instant: Date): Promise<number> {
  const dayStart = startOfUtcDay(instant)
  const dayEnd = new Date(dayStart.getTime() + MILLISECONDS_PER_DAY)
  const [row] = await db
    .select({ total: count() })
    .from(schema.legalNoticeDeliveries)
    .where(and(
      eq(schema.legalNoticeDeliveries.status, 'sent'),
      gte(schema.legalNoticeDeliveries.sentAt, dayStart),
      lt(schema.legalNoticeDeliveries.sentAt, dayEnd),
    ))

  return row?.total ?? 0
}

function retryableDeliveryCondition(instant: Date) {
  const failedCutoff = new Date(
    instant.getTime() - LEGAL_NOTICE_FAILED_BACKOFF_MS,
  )
  const staleCutoff = new Date(
    instant.getTime() - LEGAL_NOTICE_STALE_SENDING_MS,
  )

  return and(
    lt(schema.legalNoticeDeliveries.attempts, LEGAL_NOTICE_MAX_ATTEMPTS),
    or(
      and(
        eq(schema.legalNoticeDeliveries.status, 'failed'),
        lt(schema.legalNoticeDeliveries.updatedAt, failedCutoff),
      ),
      and(
        eq(schema.legalNoticeDeliveries.status, 'sending'),
        lt(schema.legalNoticeDeliveries.updatedAt, staleCutoff),
      ),
    ),
  )
}

export async function selectLegalNoticeCandidates(
  db: DbClient,
  notice: LegalNotice,
  instant: Date,
  limit: number,
): Promise<Candidate[]> {
  return await db
    .select({
      userId: schema.users.id,
      email: schema.users.email,
    })
    .from(schema.users)
    .leftJoin(
      schema.legalNoticeDeliveries,
      and(
        eq(schema.legalNoticeDeliveries.userId, schema.users.id),
        eq(schema.legalNoticeDeliveries.noticeId, notice.id),
      ),
    )
    .where(and(
      eq(schema.users.emailVerified, true),
      lt(
        schema.users.createdAt,
        new Date(parseNoticeInstant(notice.publishedAt)),
      ),
      or(
        isNull(schema.legalNoticeDeliveries.id),
        retryableDeliveryCondition(instant),
      ),
    ))
    .orderBy(asc(schema.users.id))
    .limit(limit)
}

async function claimDelivery(
  db: DbClient,
  notice: LegalNotice,
  candidate: Candidate,
  instant: Date,
): Promise<Claim | null> {
  const [inserted] = await db
    .insert(schema.legalNoticeDeliveries)
    .values({
      userId: candidate.userId,
      noticeId: notice.id,
      status: 'sending',
      attempts: 1,
      createdAt: instant,
      updatedAt: instant,
    })
    .onConflictDoNothing()
    .returning({
      id: schema.legalNoticeDeliveries.id,
      attempts: schema.legalNoticeDeliveries.attempts,
    })

  if (inserted) {
    return inserted
  }

  const [reclaimed] = await db
    .update(schema.legalNoticeDeliveries)
    .set({
      status: 'sending',
      attempts: sql`${schema.legalNoticeDeliveries.attempts} + 1`,
      updatedAt: instant,
    })
    .where(and(
      eq(schema.legalNoticeDeliveries.userId, candidate.userId),
      eq(schema.legalNoticeDeliveries.noticeId, notice.id),
      retryableDeliveryCondition(instant),
    ))
    .returning({
      id: schema.legalNoticeDeliveries.id,
      attempts: schema.legalNoticeDeliveries.attempts,
    })

  return reclaimed ?? null
}

async function markDelivery(
  db: DbClient,
  claim: Claim,
  values: Partial<typeof schema.legalNoticeDeliveries.$inferInsert>,
  instant: Date,
): Promise<void> {
  await db
    .update(schema.legalNoticeDeliveries)
    .set({ ...values, updatedAt: instant })
    .where(eq(schema.legalNoticeDeliveries.id, claim.id))
}

/**
 * One cron tick of legal change notice delivery. Each recipient is claimed
 * with an insert-or-guarded-update before the send, so two overlapping ticks
 * never mail the same user twice. A claim that is not completed within an
 * hour is treated as a Worker that died mid-send and is retried, which is the
 * only way a user can receive the notice twice.
 *
 * The email is rendered once per notice per tick. The tick stops, and refunds
 * the attempts it used up, when the failure is not about one recipient: a
 * quota stop, a missing binding or sender, a send that was a no-op, or three
 * failures in a row.
 */
export async function sweepLegalNotices(
  input: SweepLegalNoticesInput,
): Promise<SweepLegalNoticesResult> {
  const db = input.db ?? useDb()
  const clock = input.now ?? (() => new Date())
  const renderNotice = input.renderNotice ?? renderLegalNoticeEmail
  const sendNotice = input.sendNotice ?? sendLegalNoticeEmail
  const startedAt = clock()
  const result: SweepLegalNoticesResult = {
    selectedCount: 0,
    sentCount: 0,
    skippedCount: 0,
    failedCount: 0,
    lateDeliveries: 0,
    claimMissedCount: 0,
    userDeletedCount: 0,
    errorCodes: {},
    notices: [],
    stopReason: 'no-active-notice',
    runtimeMs: 0,
  }
  let failureStreak: FailedClaim[] = []

  function finish(stopReason: LegalNoticeSweepStopReason) {
    result.stopReason = stopReason
    result.runtimeMs = clock().getTime() - startedAt.getTime()

    return result
  }

  function countErrorCode(code: string) {
    result.errorCodes[code] = (result.errorCodes[code] ?? 0) + 1
  }

  async function refundFailedClaims(failedClaims: FailedClaim[]) {
    for (const { claim, errorCode } of failedClaims) {
      await markDelivery(db, claim, {
        status: 'failed',
        attempts: Math.max(claim.attempts - 1, 0),
        lastErrorCode: errorCode,
      }, clock())
    }
  }

  const activeNotices = getNoticesInSendWindow(
    input.notices ?? LEGAL_NOTICES,
    startedAt,
  )

  if (activeNotices.length === 0) {
    return finish('no-active-notice')
  }

  if (!input.privacyEmail) {
    return finish('privacy-email-missing')
  }

  let sentToday = await countSentToday(db, startedAt)
  let remainingBatch = input.batchSize

  for (const notice of activeNotices) {
    const limit = Math.min(remainingBatch, input.dailyCap - sentToday)

    if (limit <= 0) {
      return finish(
        input.dailyCap - sentToday <= 0 ? 'daily-cap' : 'completed',
      )
    }

    const candidates = await selectLegalNoticeCandidates(
      db,
      notice,
      startedAt,
      limit,
    )
    const noticeCount: SweepLegalNoticesNoticeCount = {
      noticeId: notice.id,
      selectedCount: candidates.length,
      sentCount: 0,
      skippedCount: 0,
      failedCount: 0,
      lateDeliveries: 0,
    }

    result.notices.push(noticeCount)
    result.selectedCount += candidates.length
    remainingBatch -= candidates.length

    if (candidates.length === 0) {
      continue
    }

    const content = buildLegalNoticeEmail(notice, input.privacyEmail)
    const requiredNoticeMs = getRequiredNoticeDays(notice)
      * MILLISECONDS_PER_DAY
    let rendered: RenderedEmail

    try {
      rendered = await renderNotice(content.props)
    } catch (exception) {
      input.logger?.set({
        attributes: {
          legalNoticeSweepError: {
            phase: 'render',
            noticeId: notice.id,
            message: exceptionMessage(exception),
          },
        },
      })

      return finish('error')
    }

    for (const candidate of candidates) {
      const claimInstant = clock()

      if (claimInstant.getTime() - startedAt.getTime() >= input.maxRuntimeMs) {
        return finish('max-runtime')
      }

      try {
        let claim: Claim | null

        try {
          claim = await claimDelivery(db, notice, candidate, claimInstant)
        } catch (exception) {
          if (!isForeignKeyViolation(exception)) {
            throw exception
          }

          result.userDeletedCount += 1

          continue
        }

        if (!claim) {
          result.claimMissedCount += 1

          continue
        }

        let sent: { messageId: string } | null = null
        let errorCode = UNKNOWN_ERROR_CODE

        try {
          sent = await sendNotice({
            to: candidate.email,
            subject: content.subject,
            html: rendered.html,
            text: rendered.text,
          })
        } catch (exception) {
          errorCode = getEmailErrorCode(exception) ?? UNKNOWN_ERROR_CODE
        }

        if (sent && sent.messageId === EMAIL_NOOP_MESSAGE_ID) {
          countErrorCode(NOOP_ERROR_CODE)
          await refundFailedClaims([{ claim, errorCode: NOOP_ERROR_CODE }])
          noticeCount.failedCount += 1
          result.failedCount += 1

          return finish('email-noop')
        }

        if (sent) {
          const sentAt = clock()

          await markDelivery(db, claim, {
            status: 'sent',
            messageId: sent.messageId,
            sentAt,
            lastErrorCode: null,
          }, sentAt)
          failureStreak = []
          noticeCount.sentCount += 1
          result.sentCount += 1
          sentToday += 1

          if (
            parseNoticeEffectiveInstant(notice.effectiveAt) - sentAt.getTime()
            < requiredNoticeMs
          ) {
            noticeCount.lateDeliveries += 1
            result.lateDeliveries += 1
          }

          if (input.dailyCap - sentToday <= 0) {
            return finish('daily-cap')
          }

          continue
        }

        countErrorCode(errorCode)

        if (QUOTA_ERROR_CODES.has(errorCode)) {
          await refundFailedClaims([{ claim, errorCode }])
          noticeCount.failedCount += 1
          result.failedCount += 1

          return finish('quota')
        }

        if (isSkippableErrorCode(errorCode)) {
          await markDelivery(db, claim, {
            status: 'skipped',
            lastErrorCode: errorCode,
          }, clock())
          failureStreak = []
          noticeCount.skippedCount += 1
          result.skippedCount += 1

          continue
        }

        noticeCount.failedCount += 1
        result.failedCount += 1
        failureStreak.push({ claim, errorCode })

        const isSystemic = SYSTEMIC_ERROR_CODES.has(errorCode)
        const isStreakComplete = failureStreak.length
          >= LEGAL_NOTICE_FAILURE_STREAK_LIMIT

        if (isSystemic || isStreakComplete) {
          await refundFailedClaims(failureStreak)

          return finish('consecutive-failures')
        }

        await markDelivery(db, claim, {
          status: 'failed',
          lastErrorCode: errorCode,
        }, clock())
      } catch (exception) {
        input.logger?.set({
          attributes: {
            legalNoticeSweepError: {
              phase: 'delivery-bookkeeping',
              noticeId: notice.id,
              message: exceptionMessage(exception),
            },
          },
        })

        return finish('error')
      }
    }
  }

  return finish('completed')
}

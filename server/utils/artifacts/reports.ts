import type { RequestEvent } from 'nuxt/server'
import type { ArtifactReportReason } from '#shared/utils/artifacts'
import type { ArtifactReportLocation } from '~~/server/utils/artifacts/report-emails'
import { eq } from 'drizzle-orm'
import { createError } from 'evlog'
import { getRequestHeader, readValidatedBody } from 'nuxt/server'
import { z } from 'zod'
import {
  ARTIFACT_REPORT_COPYRIGHT_WORK_MAX,
  ARTIFACT_REPORT_DETAILS_MAX,
  ARTIFACT_REPORT_DETAILS_MIN,
  ARTIFACT_MAX_VERSIONS,
  ARTIFACT_REPORT_EMAIL_MAX,
  ARTIFACT_REPORT_NAME_MAX,
  ARTIFACT_REPORT_REASONS,
  ARTIFACT_REPORT_URGENT_REASONS,
} from '#shared/utils/artifacts'
import * as schema from '~~/server/db/schema'
import {
  sendArtifactReportMailboxEmail,
  sendArtifactReportReceiptEmail,
} from '~~/server/utils/artifacts/report-emails'
import {
  consumeArtifactReportReceiptSlot,
  enforceArtifactReportRateLimit,
} from '~~/server/utils/artifacts/report-rate-limit'
import { redactArtifactSharePath } from '~~/server/utils/artifacts/share-redaction'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import {
  TURNSTILE_MISCONFIGURED_CODE,
  TURNSTILE_MISSING_RESPONSE_CODE,
  verifyTurnstileToken,
} from '~~/server/utils/turnstile'

export const ARTIFACT_REPORT_TURNSTILE_ACTION = 'report'
export const TURNSTILE_REQUIRED_CODE = 'turnstile_required'
export const TURNSTILE_FAILED_CODE = 'turnstile_failed'
export const TURNSTILE_UNAVAILABLE_CODE = 'turnstile_unavailable'

const TURNSTILE_TOKEN_MAX = 2048

const NO_CONTROL_CHARACTERS_PATTERN = /^[^\p{Cc}]*$/u
const NO_CONTROL_CHARACTERS_MESSAGE = 'Names cannot contain line breaks or '
  + 'control characters'

const emailSchema = z.email()

function singleLineName() {
  return z.string()
    .trim()
    .max(ARTIFACT_REPORT_NAME_MAX)
    .regex(NO_CONTROL_CHARACTERS_PATTERN, NO_CONTROL_CHARACTERS_MESSAGE)
}

const copyrightSchema = z.object({
  work: z.string().trim().min(1).max(ARTIFACT_REPORT_COPYRIGHT_WORK_MAX),
  signature: singleLineName().min(1),
  ownerName: singleLineName().optional(),
  unauthorisedUse: z.literal(true),
  authority: z.literal(true),
})

export const artifactReportBodySchema = z.object({
  reason: z.enum(ARTIFACT_REPORT_REASONS),
  details: z.string()
    .trim()
    .min(ARTIFACT_REPORT_DETAILS_MIN)
    .max(ARTIFACT_REPORT_DETAILS_MAX),
  reporterName: singleLineName().optional(),
  reporterEmail: z.string().trim().max(ARTIFACT_REPORT_EMAIL_MAX).optional(),
  goodFaith: z.literal(true),
  turnstileToken: z.string().trim().max(TURNSTILE_TOKEN_MAX).optional(),
  copyright: copyrightSchema.optional(),
  version: z.number().int().min(1).max(ARTIFACT_MAX_VERSIONS).optional(),
}).superRefine((body, context) => {
  const email = body.reporterEmail

  if (email && !emailSchema.safeParse(email).success) {
    context.addIssue({
      code: 'custom',
      path: ['reporterEmail'],
      message: 'Enter a valid email address',
    })
  }

  if (body.reason === 'copyright' && !body.copyright) {
    context.addIssue({
      code: 'custom',
      path: ['copyright'],
      message: 'A copyright notice needs the work, your signature and both '
        + 'statements',
    })
  }

  if (body.reason === 'csam') {
    return
  }

  if (!body.reporterName) {
    context.addIssue({
      code: 'custom',
      path: ['reporterName'],
      message: 'Your name is required for this kind of report',
    })
  }

  if (!body.reporterEmail) {
    context.addIssue({
      code: 'custom',
      path: ['reporterEmail'],
      message: 'Your email is required for this kind of report',
    })
  }
})

export type ArtifactReportBody = z.infer<typeof artifactReportBodySchema>

export interface ArtifactReportTarget {
  artifactInternalId: number
  shareInternalId: number | null
  chatShareId: string | null
  reportedVersion: number | null
  location: ArtifactReportLocation
}

export interface SubmittedArtifactReport {
  ok: true
}

export function isUrgentArtifactReportReason(
  reason: ArtifactReportReason,
): boolean {
  return (ARTIFACT_REPORT_URGENT_REASONS as readonly string[]).includes(reason)
}

/**
 * The stored and mailed report text: the reporter's own words, then for a
 * copyright notice the elements of the Terms of Use "Copyright complaints"
 * section that are not separate fields (signature, the work, the owner,
 * both statements). Element 3, the exact URL, is the share the server
 * resolved, never a URL the client sent. Any `/a/<token>` link the
 * reporter pasted, encoded or not, is reduced to `/a/[token]`, so a live
 * token never reaches the row or the mailbox.
 */
export function composeArtifactReportDetails(body: ArtifactReportBody): string {
  const lines = body.reason === 'copyright' && body.copyright
    ? [
      body.details,
      '',
      'Copyright notice',
      `Signature: ${body.copyright.signature}`,
      `Work: ${body.copyright.work}`,
      `Rights owner: ${body.copyright.ownerName || 'the reporter'}`,
      'Location: the reported link, filled in by Besidka',
      'Good-faith statement: the use is not authorised by the owner, its '
      + 'agent or the law',
      'Accuracy statement: the notice is accurate and the reporter owns the '
      + 'right or is authorised to act for the owner',
    ]
    : [body.details]

  return redactArtifactSharePath(lines.join('\n')) as string
}

async function assertTurnstile(
  event: RequestEvent,
  token: string | undefined,
  logger: ReturnType<typeof useRequestLogger>,
): Promise<void> {
  const verification = await verifyTurnstileToken(token, {
    expectedAction: ARTIFACT_REPORT_TURNSTILE_ACTION,
    remoteIp: getRequestHeader(event, 'cf-connecting-ip') ?? null,
  })

  logger.set({
    attributes: {
      artifacts: {
        reportTurnstile: {
          ok: verification.ok,
          skipped: verification.skipped,
          errorCodes: verification.errorCodes,
        },
      },
    },
  })

  if (verification.ok) {
    return
  }

  if (verification.errorCodes.includes(TURNSTILE_MISCONFIGURED_CODE)) {
    throw createError({
      message: 'Reports from signed-out visitors are unavailable',
      status: 503,
      code: TURNSTILE_UNAVAILABLE_CODE,
      why: 'The anti-abuse check is required but not configured',
      fix: 'Sign in and report again, or email the privacy address on the '
        + 'Privacy Policy',
    })
  }

  if (verification.errorCodes.includes(TURNSTILE_MISSING_RESPONSE_CODE)) {
    throw createError({
      message: 'Complete the check before sending',
      status: 400,
      code: TURNSTILE_REQUIRED_CODE,
      why: 'Reports from signed-out visitors need the anti-abuse check',
      fix: 'Complete the check, or sign in and report again',
    })
  }

  throw createError({
    message: 'The anti-abuse check failed',
    status: 403,
    code: TURNSTILE_FAILED_CODE,
    why: 'Turnstile did not accept the check',
    fix: 'Reload the check and send the report again',
  })
}

async function findVerifiedAccountEmail(
  db: ReturnType<typeof useDb>,
  userId: number,
): Promise<string | null> {
  const [user] = await db
    .select({
      email: schema.users.email,
      emailVerified: schema.users.emailVerified,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1)

  return user?.emailVerified && user.email ? user.email : null
}

/**
 * The report flow shared by artifact share links and artifacts in shared
 * chats (DSA Art. 16 notice): validates the body, rate limits the reporter
 * (5 an hour per user, or per client IP keyed by an HMAC of the address),
 * runs Turnstile for signed-out reporters, resolves the reported artifact
 * and version, stores the report without any IP, emails the privacy
 * mailbox (an `[URGENT]` subject for csam, terrorism and threat to life)
 * and sends a receipt: to the typed address for a signed-out reporter, to
 * the verified account email for a signed-in one, at most 3 per address
 * per 24 hours. Email failures are logged and never fail the report. The
 * share token and the IP never reach the row, the emails or the logs.
 */
export async function submitArtifactReport(
  event: RequestEvent,
  resolveTarget: (body: ArtifactReportBody) => Promise<ArtifactReportTarget>,
): Promise<SubmittedArtifactReport> {
  const logger = useRequestLogger(event)
  const body = await readValidatedBody(
    event,
    artifactReportBodySchema.safeParse,
  )

  if (!body.success) {
    throw createError({
      message: 'Invalid report',
      status: 400,
      why: body.error.issues
        .map((issue) => {
          return issue.message
        })
        .join('; '),
    })
  }

  const session = await useUserSession()
  const reporterUserId = session ? parseInt(session.user.id) : null

  await enforceArtifactReportRateLimit(event, reporterUserId, logger)

  if (reporterUserId === null) {
    await assertTurnstile(event, body.data.turnstileToken, logger)
  }

  const target = await resolveTarget(body.data)
  const priority = isUrgentArtifactReportReason(body.data.reason)
    ? 'urgent'
    : 'normal'
  const details = composeArtifactReportDetails(body.data)
  const reporterName = body.data.reporterName || null
  const reporterEmail = body.data.reporterEmail || null
  const db = useDb()
  const [report] = await db.insert(schema.artifactReports).values({
    artifactId: target.artifactInternalId,
    shareId: target.shareInternalId,
    chatShareId: target.chatShareId,
    reportedVersion: target.reportedVersion,
    reporterUserId,
    reporterName,
    reporterEmail,
    reason: body.data.reason,
    details,
    status: 'open',
    priority,
  }).returning({
    id: schema.artifactReports.id,
    createdAt: schema.artifactReports.createdAt,
  })

  if (!report) {
    throw createError({
      message: 'Failed to save the report',
      status: 500,
    })
  }

  logger.set({
    attributes: {
      artifacts: {
        operation: 'report',
        reportId: report.id,
        artifactId: target.location.artifactId,
        shareId: target.location.shareId,
        chatShareId: target.chatShareId,
        reportedVersion: target.reportedVersion,
        reason: body.data.reason,
        priority,
        signedIn: reporterUserId !== null,
      },
    },
  })

  await sendArtifactReportMailboxEmail({
    reportId: report.id,
    reason: body.data.reason,
    priority,
    location: target.location,
    reporterUserId,
    reporterName,
    reporterEmail,
    details,
    createdAt: report.createdAt,
    logger,
  })

  const receiptAddress = reporterUserId === null
    ? reporterEmail
    : await findVerifiedAccountEmail(db, reporterUserId)

  if (!receiptAddress) {
    logger.set({
      attributes: {
        artifacts: {
          receiptSent: false,
          receiptSkipped: reporterUserId === null
            ? 'no-email'
            : 'no-verified-account-email',
        },
      },
    })

    return { ok: true }
  }

  if (!await consumeArtifactReportReceiptSlot(receiptAddress, logger)) {
    logger.set({ attributes: { artifacts: { receiptSent: false } } })

    return { ok: true }
  }

  const receiptSent = await sendArtifactReportReceiptEmail({
    to: receiptAddress,
    reason: body.data.reason,
    location: target.location,
    createdAt: report.createdAt,
    logger,
  })

  if (receiptSent) {
    await db.update(schema.artifactReports)
      .set({ receiptSentAt: new Date() })
      .where(eq(schema.artifactReports.id, report.id))
  }

  logger.set({ attributes: { artifacts: { receiptSent } } })

  return { ok: true }
}

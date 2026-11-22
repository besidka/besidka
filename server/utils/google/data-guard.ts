import {
  and,
  eq,
  isNotNull,
  isNull,
  notInArray,
  or,
} from 'drizzle-orm'
import { createError } from 'evlog'
import { GOOGLE_EXTERNAL_SOURCES } from '#shared/utils/google-data-policy'
import type { GoogleDataDecision } from '#shared/utils/google-data-policy'
import {
  decideGoogleDataRecipient,
  googleDataRefusalFix,
  googleDataRefusalReason,
} from '#shared/utils/google-data-recipient'
import type { GoogleDataRecipient } from '#shared/utils/google-data-recipient'
import { isWebSearchTool } from '#shared/utils/message-metadata'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { JevRerankModelResolver } from '~~/server/utils/jev/rerank'

type DbClient = ReturnType<typeof useDb>

export const GOOGLE_DATA_RECIPIENT_REFUSED_CODE
  = 'google-data-recipient-refused'

export const GOOGLE_DATA_SHARE_OPT_IN_CODE = 'google-data-share-opt-in'

export interface GoogleDataGuardDecision extends GoogleDataDecision {
  message: string
  fix: string
}

/**
 * Whether the user confirmed that their Gemini key is on a Google Cloud
 * project with billing enabled (`keys.paid_tier_confirmed_at`). One D1
 * read; a failed read means not confirmed.
 */
export async function readGeminiPaidTierConfirmed(
  db: DbClient,
  userId: number,
  logger?: LoggerLike,
): Promise<boolean> {
  try {
    const row = await db.query.keys.findFirst({
      where: { userId, provider: 'google' },
      columns: { paidTierConfirmedAt: true },
    })

    return !!row?.paidTierConfirmedAt
  } catch (exception) {
    logger?.set({
      attributes: {
        googleDataGuard: {
          paidTierRead: 'failed',
          error: exceptionMessage(exception),
        },
      },
    })

    return false
  }
}

function needsPaidTierFact(recipient: GoogleDataRecipient): boolean {
  return !recipient.gatewayId && recipient.providerId === 'google'
}

/**
 * Whether Google-derived content may go to `recipient`, and why not. The
 * Gemini paid-tier fact is read from D1 only for a direct Gemini model.
 * `gatewaySafeguardsSent` must be true only on a call that really sends the
 * gateway's zero-data-retention or no-payload-logging setting.
 */
export async function decideGoogleDataGuard(input: {
  db: DbClient
  userId: number
  recipient: GoogleDataRecipient
  gatewaySafeguardsSent: boolean
  logger?: LoggerLike
}): Promise<GoogleDataGuardDecision> {
  const geminiPaidTierConfirmed = needsPaidTierFact(input.recipient)
    ? await readGeminiPaidTierConfirmed(input.db, input.userId, input.logger)
    : false
  const decision = decideGoogleDataRecipient(input.recipient, {
    geminiPaidTierConfirmed,
    gatewaySafeguardsSent: input.gatewaySafeguardsSent,
  })

  return {
    ...decision,
    message: googleDataRefusalReason(decision, input.recipient),
    fix: googleDataRefusalFix(decision, input.recipient),
  }
}

function recordGuardDecision(
  decision: GoogleDataGuardDecision,
  site: string,
  logger?: LoggerLike,
) {
  logger?.set({
    attributes: {
      googleDataGuard: {
        site,
        allowed: decision.allowed,
        reason: decision.reason,
        recipient: decision.recipientId,
        unmet: decision.unmetConditions,
      },
    },
  })
}

export function createGoogleDataRecipientError(
  decision: GoogleDataGuardDecision,
) {
  return createError({
    message: 'This model cannot be used in a chat with Google data.',
    status: 403,
    code: GOOGLE_DATA_RECIPIENT_REFUSED_CODE,
    why: decision.message,
    fix: decision.fix,
    data: {
      reason: GOOGLE_DATA_RECIPIENT_REFUSED_CODE,
      recipient: decision.recipientId,
    },
  })
}

/**
 * Sharing a chat that holds Google data needs the owner's explicit opt-in in
 * the share request, naming the Google content (pre-check row 2, APIs Terms
 * §5(c)).
 */
export function createGoogleDataShareOptInError() {
  return createError({
    message: 'Confirm sharing the Google content in this chat.',
    status: 409,
    code: GOOGLE_DATA_SHARE_OPT_IN_CODE,
    why: 'This chat holds content from Google Drive, Calendar or Gmail. '
      + 'Replies that repeat it would be visible to anyone with the link.',
    fix: 'Tick "Share the Google content in this chat" and share again.',
    data: { reason: GOOGLE_DATA_SHARE_OPT_IN_CODE },
  })
}

/**
 * The send-side guard: in a chat that holds Google data, a refused recipient
 * stops the request before any content leaves, with a 403 that names what
 * the user can do. A chat without Google data returns at once, with no D1
 * read.
 */
export async function assertGoogleDataRecipient(input: {
  holdsGoogleData: boolean
  db: DbClient
  userId: number
  recipient: GoogleDataRecipient
  gatewaySafeguardsSent: boolean
  site: string
  logger?: LoggerLike
}): Promise<void> {
  if (!input.holdsGoogleData) {
    return
  }

  const decision = await decideGoogleDataGuard(input)

  recordGuardDecision(decision, input.site, input.logger)

  if (!decision.allowed) {
    throw createGoogleDataRecipientError(decision)
  }
}

/**
 * The background-side guard: true when the call may run. In a chat that
 * holds Google data a refused recipient returns false, and the caller skips
 * the call silently; only ids and the reason are logged.
 */
export async function mayRunWithGoogleData(input: {
  holdsGoogleData: boolean
  db: DbClient
  userId: number
  recipient: GoogleDataRecipient
  gatewaySafeguardsSent: boolean
  site: string
  logger?: LoggerLike
}): Promise<boolean> {
  if (!input.holdsGoogleData) {
    return true
  }

  const decision = await decideGoogleDataGuard(input)

  recordGuardDecision(decision, input.site, input.logger)

  return decision.allowed
}

/**
 * The send's tools without any web search (native, Brave, Exa) in a chat
 * that holds Google data: the pre-check skips Brave and Exa there, and a
 * query the model writes can carry Google content to a search engine,
 * whatever the tool approvals setting.
 */
export function withoutWebSearchForGoogleData<Tool>(
  tools: readonly Tool[],
  holdsGoogleData: boolean,
): Tool[] {
  return holdsGoogleData
    ? tools.filter(tool => !isWebSearchTool(tool))
    : [...tools]
}

/**
 * The TypeSafe AI rerank resolver of a send in a chat that holds Google
 * data: no model, so search and knowledge results keep their own order and
 * nothing reaches TypeSafe AI.
 */
export const disabledRerankModelResolver: JevRerankModelResolver = () => {
  return Promise.resolve(null)
}

/**
 * The rerank resolver of a send that starts without Google data: once a
 * Google result arrived in this send (`google` taint), no later search or
 * knowledge rerank reaches TypeSafe AI.
 */
export function withGoogleTaintRerankStop(
  resolver: JevRerankModelResolver,
  holdsGoogleTaint: () => boolean,
): JevRerankModelResolver {
  return () => {
    return holdsGoogleTaint() ? Promise.resolve(null) : resolver()
  }
}

/**
 * Connectors in a chat that holds Google data run only under tool
 * approvals: the Google egress ask (rule 12) is the only thing that keeps
 * Google content from reaching a user-added MCP server unasked, and it needs
 * approvals to run.
 */
export function mayOfferConnectorsWithGoogleData(input: {
  holdsGoogleData: boolean
  toolApprovalsActive: boolean
}): boolean {
  return !input.holdsGoogleData || input.toolApprovalsActive
}

/**
 * A file that is not a copy of a Google file: `external_source` is null or
 * not one of `GOOGLE_EXTERNAL_SOURCES`. Google copies stay out of MCP, the
 * Besidka file tools and share grants.
 */
export function fileIsNotGoogleCopy() {
  return or(
    isNull(schema.files.externalSource),
    notInArray(schema.files.externalSource, [...GOOGLE_EXTERNAL_SOURCES]),
  )
}

/**
 * Whether the chat an artifact was written in holds Google data: the
 * artifact's source may quote it. An artifact with no origin chat, or whose
 * chat is gone, reads as not flagged.
 */
export async function readArtifactHoldsGoogleData(
  db: DbClient,
  artifactInternalId: number,
): Promise<boolean> {
  const row = await db.select({ id: schema.artifacts.id })
    .from(schema.artifacts)
    .innerJoin(
      schema.chats,
      eq(schema.chats.id, schema.artifacts.originChatId),
    )
    .where(and(
      eq(schema.artifacts.id, artifactInternalId),
      isNotNull(schema.chats.googleDataAt),
    ))
    .get()

  return !!row
}

/**
 * Whether a share may be shown for a chat that holds Google data: the share
 * was created or updated (with the explicit opt-in) after the chat was
 * flagged. `chat_shares.updated_at` changes only when the owner creates or
 * re-creates the share, so a share made before the flag stays hidden until
 * the owner shares again and opts in.
 */
export function isShareVisibleForGoogleData(input: {
  googleDataAt: Date | null | undefined
  shareUpdatedAt: Date | null | undefined
}): boolean {
  if (!input.googleDataAt) {
    return true
  }

  if (!input.shareUpdatedAt) {
    return false
  }

  return input.shareUpdatedAt.getTime() > input.googleDataAt.getTime()
}

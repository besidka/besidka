import {
  and,
  eq,
  isNotNull,
  isNull,
  inArray,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import { createError } from 'evlog'
import {
  GOOGLE_EXTERNAL_SOURCES,
  isGoogleExternalSource,
} from '#shared/utils/google-data-policy'
import type { GoogleDataDecision } from '#shared/utils/google-data-policy'
import {
  decideGoogleDataRecipient,
  googleDataRefusalFix,
  googleDataRefusalReason,
} from '#shared/utils/google-data-recipient'
import type { GoogleDataRecipient } from '#shared/utils/google-data-recipient'
import { GOOGLE_GMAIL_THREAD_REFERENCE_KIND } from '#shared/utils/google-gmail-tools'
import { isWebSearchTool } from '#shared/utils/message-metadata'
import { collectArtifactAttachments } from '#shared/utils/artifacts'
import * as schema from '~~/server/db/schema'
import { collectReferencedArtifactIds } from '~~/server/utils/artifacts/message-parts'
import { decodeArtifactId } from '~~/server/utils/artifacts/store'
import { extractLocalFileStorageKey } from '#shared/utils/files'
import { getOwnedFilesByStorageKeys } from '~~/server/utils/files/file-governance'
import { isGoogleToolPart } from '~~/server/utils/tool-approval/google'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { unwrapRetryError } from '~~/server/utils/chats/provider-error-summary'
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

/**
 * The 403 for a refused recipient. On a continuation (an approval answer or
 * a next tool round) the paused reply is bound to the model it started on,
 * so switching the model does not resume it: the way out is a new message
 * on an allowed model.
 */
export function createGoogleDataRecipientError(
  decision: GoogleDataGuardDecision,
  continuation = false,
) {
  return createError({
    message: continuation
      ? 'This reply cannot continue: its model cannot be used in a chat '
      + 'with Google data.'
      : 'This model cannot be used in a chat with Google data.',
    status: 403,
    code: GOOGLE_DATA_RECIPIENT_REFUSED_CODE,
    why: decision.message,
    fix: continuation
      ? 'Send a new message with a model from Anthropic, OpenAI or xAI, or '
      + 'start a new chat. The paused reply stays as it is.'
      : decision.fix,
    data: {
      reason: GOOGLE_DATA_RECIPIENT_REFUSED_CODE,
      recipient: decision.recipientId,
    },
  })
}

const ZDR_NOT_ATTESTED_PATTERN = /zdr_not_attested/i

function errorStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }

  const { statusCode, status } = error as {
    statusCode?: unknown
    status?: unknown
  }

  if (typeof statusCode === 'number') {
    return statusCode
  }

  return typeof status === 'number' ? status : undefined
}

/**
 * The Google-specific reason for a Vercel AI Gateway refusal of a call that
 * carried `zeroDataRetention` (pre-check, gateway table): a 403 (a Hobby team
 * cannot request zero data retention) or `zdr_not_attested` (an upstream BYOK
 * key not marked ZDR-compliant). Empty for any other error, so the caller can
 * spread it into `normalizeChatError`.
 */
export function googleSafeguardGatewayErrorOverride(input: {
  gatewayId: string | undefined
  safeguardsSent: boolean
  error: unknown
}): { message?: string, why?: string, fix?: string, status?: number } {
  if (input.gatewayId !== 'vercel' || !input.safeguardsSent) {
    return {}
  }

  const error = unwrapRetryError(input.error)
  const status = errorStatusOf(error)
  const text = error instanceof Error ? error.message : String(error)
  const notAttested = ZDR_NOT_ATTESTED_PATTERN.test(text)

  if (status !== 403 && !notAttested) {
    return {}
  }

  return {
    message: 'Vercel AI Gateway refused zero data retention, which Besidka '
      + 'requests when Google data can reach this chat.',
    why: notAttested
      ? 'The upstream key for this model is not marked as zero data '
      + 'retention compliant (zdr_not_attested).'
      : 'Zero data retention needs a Vercel Pro or Enterprise team, or a '
        + 'team with purchased credits. A Hobby team gets 403.',
    fix: 'Pick a model from Anthropic, OpenAI or xAI on your own key for '
      + 'this chat, or upgrade the Vercel team.',
    status: 403,
  }
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
  continuation?: boolean
  logger?: LoggerLike
}): Promise<void> {
  if (!input.holdsGoogleData) {
    return
  }

  const decision = await decideGoogleDataGuard(input)

  recordGuardDecision(decision, input.site, input.logger)

  if (!decision.allowed) {
    throw createGoogleDataRecipientError(decision, input.continuation)
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
 * The statements that go into the same D1 batch as a write that brings new
 * Google content into a chat: set `chats.google_data_at` once (the first
 * time is kept) and clear the chat share's opt-in, so a share pauses until
 * the owner opts in again for the new content.
 */
export function buildGoogleContentPersistStatements(
  db: DbClient,
  chatPublicId: string,
) {
  return [
    db.update(schema.chats)
      .set({
        googleDataAt: sql`coalesce(${schema.chats.googleDataAt}, ${Math.floor(Date.now() / 1000)})`,
      })
      .where(eq(schema.chats.id, chatPublicId)),
    db.update(schema.chatShares)
      .set({ googleOptInAt: null, indexable: false })
      .where(eq(schema.chatShares.chatId, chatPublicId)),
  ] as const
}

/**
 * Flags a chat that a send found to hold Google content before the guard
 * (a Google copy or a marked item attached or referenced), and clears its
 * share opt-in when that content is new in this send. Not best effort: a
 * failure stops the send.
 */
export async function flagChatGoogleData(
  db: DbClient,
  chatPublicId: string,
  clearsShareOptIn: boolean,
): Promise<void> {
  const [flag, clearOptIn] = buildGoogleContentPersistStatements(
    db,
    chatPublicId,
  )

  await db.batch(clearsShareOptIn ? [flag, clearOptIn] : [flag])
}

/**
 * A file that holds no Google content: not a copy of a Google file
 * (`external_source` null or not one of `GOOGLE_EXTERNAL_SOURCES`) and not
 * written in a send that held Google data (`google_derived_at` null).
 * Only such files reach MCP, the Besidka file tools of a send without Google
 * data, and project knowledge.
 */
export function fileHoldsNoGoogleContent() {
  return and(
    or(
      isNull(schema.files.externalSource),
      notInArray(schema.files.externalSource, [...GOOGLE_EXTERNAL_SOURCES]),
    ),
    isNull(schema.files.googleDerivedAt),
  )
}

/**
 * How a reader treats Google content (Google copies and marked artifacts
 * and files): `hidden` for MCP clients (filtered out, an id answers 404),
 * `withheld` for the Besidka tools of a chat without Google data (listed
 * out, a read answers a short notice so the model can tell the user), and
 * `allowed` inside a send that already holds Google data, whose model the
 * guard cleared.
 */
export type GoogleContentAccess = 'hidden' | 'withheld' | 'allowed'

export const GOOGLE_CONTENT_WITHHELD_MESSAGE = 'This item holds content '
  + 'from Google and is not available in this chat. Tell the user to open it '
  + 'in the chat it came from.'

export function createGoogleContentWithheldError() {
  return createError({
    message: GOOGLE_CONTENT_WITHHELD_MESSAGE,
    status: 403,
    why: 'The item was written in a chat that holds Google data.',
    fix: 'Open the chat the item came from.',
  })
}

/**
 * An artifact not written in a send that held Google data
 * (`artifacts.google_derived_at` null).
 */
export function artifactHoldsNoGoogleContent() {
  return isNull(schema.artifacts.googleDerivedAt)
}

/**
 * Whether a file row holds Google content: a Google copy or a file a send
 * that held Google data wrote.
 */
export function isGoogleContentFile(file: {
  externalSource?: string | null
  googleDerivedAt?: Date | null
}): boolean {
  return isGoogleExternalSource(file.externalSource) || !!file.googleDerivedAt
}

/**
 * The Google content a send carries before any model call: file parts of
 * the chat and the new message whose file is a Google copy or carries the
 * derived mark, and attached or referenced artifacts with the mark. One
 * query per kind, only when there is something to look up. `newMessage`
 * says whether the new message itself brought such content.
 */
export async function findSendGoogleContent(input: {
  db: DbClient
  userId: number
  storageKeys: readonly string[]
  newMessageStorageKeys: readonly string[]
  artifactIds: readonly number[]
  newMessageArtifactIds: readonly number[]
}): Promise<{ holdsGoogleContent: boolean, newMessage: boolean }> {
  const markedKeys = new Set<string>()
  const markedArtifactIds = new Set<number>()
  const storageKeys = [...new Set(input.storageKeys)]
  const artifactIds = [...new Set(input.artifactIds)]

  const ownedFiles = storageKeys.length > 0
    ? await getOwnedFilesByStorageKeys(input.userId, storageKeys)
    : new Map()

  for (const [storageKey, file] of ownedFiles) {
    if (isGoogleContentFile(file)) {
      markedKeys.add(storageKey)
    }
  }

  for (const chunk of chunkValues(artifactIds)) {
    const rows = await input.db.select({ id: schema.artifacts.id })
      .from(schema.artifacts)
      .where(and(
        eq(schema.artifacts.userId, input.userId),
        inArray(schema.artifacts.id, chunk),
        isNotNull(schema.artifacts.googleDerivedAt),
      ))

    for (const row of rows) {
      markedArtifactIds.add(row.id)
    }
  }

  const newMessage = input.newMessageStorageKeys.some((key) => {
    return markedKeys.has(key)
  }) || input.newMessageArtifactIds.some((id) => {
    return markedArtifactIds.has(id)
  })

  return {
    holdsGoogleContent: markedKeys.size > 0 || markedArtifactIds.size > 0,
    newMessage,
  }
}

function fileStorageKeysOf(parts: unknown): string[] {
  if (!Array.isArray(parts)) {
    return []
  }

  return parts.flatMap((part: unknown) => {
    const record = part as { type?: unknown, url?: unknown } | null

    if (record?.type !== 'file' || typeof record.url !== 'string') {
      return []
    }

    const storageKey = extractLocalFileStorageKey(record.url)

    return storageKey ? [storageKey] : []
  })
}

function internalArtifactIdsOf(publicIds: readonly string[]): number[] {
  return publicIds.flatMap((publicId) => {
    const internalId = decodeArtifactId(publicId)

    return internalId === null ? [] : [internalId]
  })
}

/**
 * Whether a send carries Google content it must treat as Google data before
 * the guard runs: a Google copy or a marked file attached to any message of
 * the chat or to the new message, or a marked artifact attached or referenced
 * there. No query runs when there is nothing to look up, so an ordinary send
 * without files or artifacts costs nothing.
 */
export async function resolveSendGoogleContent(input: {
  db: DbClient
  userId: number
  chatMessages: ReadonlyArray<{ role: string, parts: unknown }>
  newMessageParts: unknown
}): Promise<{ holdsGoogleContent: boolean, newMessage: boolean }> {
  const newMessageStorageKeys = fileStorageKeysOf(input.newMessageParts)
  const storageKeys = [
    ...input.chatMessages.flatMap((message) => {
      return fileStorageKeysOf(message.parts)
    }),
    ...newMessageStorageKeys,
  ]
  const newMessage = { role: 'user', parts: input.newMessageParts }
  const newMessageArtifactIds = internalArtifactIdsOf(
    collectArtifactAttachments([newMessage]).map((attachment) => {
      return attachment.artifactId
    }),
  )
  const artifactIds = [
    ...internalArtifactIdsOf(
      collectArtifactAttachments(input.chatMessages).map((attachment) => {
        return attachment.artifactId
      }),
    ),
    ...internalArtifactIdsOf(collectReferencedArtifactIds(input.chatMessages)),
    ...newMessageArtifactIds,
  ]

  if (storageKeys.length === 0 && artifactIds.length === 0) {
    return { holdsGoogleContent: false, newMessage: false }
  }

  return await findSendGoogleContent({
    db: input.db,
    userId: input.userId,
    storageKeys,
    newMessageStorageKeys,
    artifactIds,
    newMessageArtifactIds,
  })
}

const LOOKUP_CHUNK_SIZE = 90

function chunkValues<Value>(values: readonly Value[]): Value[][] {
  const chunks: Value[][] = []

  for (let start = 0; start < values.length; start += LOOKUP_CHUNK_SIZE) {
    chunks.push(values.slice(start, start + LOOKUP_CHUNK_SIZE))
  }

  return chunks
}

/**
 * Whether a share may be shown: always for a chat without Google data; for a
 * flagged chat only while the share carries the owner's stored opt-in
 * (`chat_shares.google_opt_in_at`). New Google content clears the opt-in in
 * the same batch that stores it, so the share pauses until the owner opts
 * in again.
 */
export function isShareVisibleForGoogleData(input: {
  googleDataAt: Date | null | undefined
  googleOptInAt: Date | null | undefined
}): boolean {
  return !input.googleDataAt || !!input.googleOptInAt
}

const GOOGLE_ITEM_NAMES_MAX = 20

function googleReferenceTitlesOf(parts: unknown): string[] {
  if (!Array.isArray(parts)) {
    return []
  }

  return parts.flatMap((part: unknown) => {
    if (!isGoogleToolPart(part)) {
      return []
    }

    const output = (part as { output?: unknown }).output
    const references = typeof output === 'object' && output !== null
      ? (output as { references?: unknown }).references
      : undefined

    return Array.isArray(references)
      ? references.flatMap((reference: unknown) => {
        const label = googleReferenceLabel(reference)

        return label ? [label] : []
      })
      : []
  })
}

/**
 * The name the share dialog shows for one stored reference: its title, or
 * for an email thread (which stores no subject) "Email thread from <day>"
 * from Gmail's own timestamp.
 */
function googleReferenceLabel(reference: unknown): string | null {
  const record = reference as {
    title?: unknown
    kind?: unknown
    date?: unknown
  } | null

  if (typeof record?.title === 'string' && record.title.trim()) {
    return record.title.trim()
  }

  if (record?.kind !== GOOGLE_GMAIL_THREAD_REFERENCE_KIND) {
    return null
  }

  const day = typeof record.date === 'string' && /^\d{4}-\d{2}-\d{2}/
    .test(record.date)
    ? record.date.slice(0, 10)
    : null

  return day ? `Email thread from ${day}` : 'Email thread'
}

/**
 * The names of the Google items in a chat, for the share opt-in that must
 * name the Google content (pre-check row 2): titles of the stored Google
 * references, and the names of attached Google copies and marked files. At
 * most 20, without duplicates.
 */
export async function listChatGoogleItemNames(input: {
  db: DbClient
  userId: number
  chatId: string
}): Promise<string[]> {
  const messages = await input.db.query.messages.findMany({
    where: { chatId: input.chatId },
    columns: { parts: true },
  })
  const names = new Set<string>()
  const storageKeys: string[] = []

  for (const message of messages) {
    for (const title of googleReferenceTitlesOf(message.parts)) {
      names.add(title)
    }

    storageKeys.push(...fileStorageKeysOf(message.parts))
  }

  for (const chunk of chunkValues([...new Set(storageKeys)])) {
    const rows = await input.db.select({ name: schema.files.name })
      .from(schema.files)
      .where(and(
        eq(schema.files.userId, input.userId),
        inArray(schema.files.storageKey, chunk),
        or(
          inArray(schema.files.externalSource, [...GOOGLE_EXTERNAL_SOURCES]),
          isNotNull(schema.files.googleDerivedAt),
        ),
      ))

    for (const row of rows) {
      names.add(row.name)
    }
  }

  return [...names].slice(0, GOOGLE_ITEM_NAMES_MAX)
}

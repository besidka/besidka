import type { UIMessage } from 'ai'
import type { KVNamespace } from '@cloudflare/workers-types'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import {
  GOOGLE_TOOL_OUTPUT_MAX_BYTES,
  googleToolResultHoldsContent,
  isGoogleToolName,
  withoutReferenceNames,
} from '#shared/utils/google-tool-approvals'
import { GOOGLE_SERVICES } from '#shared/utils/google-tool-catalog'
import type { GoogleService } from '#shared/utils/google-tool-catalog'
import { TOOL_APPROVAL_RECORD_VERSION } from '#shared/utils/tool-approval-policy'
import * as schema from '~~/server/db/schema'
import { readBesidkaChatSettings } from '~~/server/utils/besidka-tools/chat-settings'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { StashedResult } from '~~/server/utils/tool-approval/continuation'
import {
  deleteToolApprovalResult,
  getToolApprovalResult,
  toolApprovalResultIdOf,
} from '~~/server/utils/tool-approval/kv'
import type { ToolApprovalResultRecord } from '~~/server/utils/tool-approval/kv'

type UiMessagePart = UIMessage['parts'][number]
type DbClient = ReturnType<typeof useDb>

const TOOL_PART_PREFIX = 'tool-'
const CODE_EXECUTION_MODEL_TOOL = 'code_execution'
const REFERENCES_MAX = 50
const REFERENCE_ID_MAX_LENGTH = 256
const REFERENCE_TITLE_MAX_LENGTH = 300
const REFERENCE_LINK_MAX_LENGTH = 2048
const REFERENCE_DATE_MAX_LENGTH = 64
const REFERENCE_KIND_MAX_LENGTH = 32
const REFERENCE_PARENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export const GOOGLE_TOOL_ERROR_PERSISTED_TEXT = 'The Google tool did not '
  + 'return a result.'

export const GOOGLE_TOOL_BODY_NOT_KEPT_NOTE = 'The content of this Google '
  + 'result is kept only for the reply that fetched it. Run the tool again '
  + 'if you need it.'

export const GOOGLE_TOOL_BODY_TOO_LARGE_NOTE = 'This Google result was larger '
  + 'than 64 KiB, so its content was not kept. Ask the user to narrow the '
  + 'request, for example to one file or a shorter date range.'

export const GOOGLE_TOOL_BODY_UNAVAILABLE_NOTE = 'The content of this Google '
  + 'result could not be kept while the reply waited for approval. Run the '
  + 'tool again if you need it.'

/**
 * One item a Google tool result points at: a Drive file, a Calendar event,
 * a Gmail thread. Only these fields reach `messages.parts`.
 */
export interface GoogleToolReference {
  id: string
  kind?: string
  title?: string
  link?: string
  date?: string
  parentId?: string
}

/**
 * What a Google tool returns: the references to keep, and anything else
 * the model needs in this turn (the body). The body never reaches D1.
 */
export interface GoogleToolOutput {
  references: GoogleToolReference[]
  [field: string]: unknown
}

/**
 * The stored form of a Google tool result: the sanitized references, a
 * marker that the body was removed and a short note that tells the model
 * why.
 */
export interface GoogleToolPersistedOutput {
  references: GoogleToolReference[]
  bodyRemoved: true
  note: string
}

export interface GoogleToolResultOwner {
  userId: number
  chatPublicId: string
  messagePublicId: string
}

export interface GoogleResultStashEntry {
  resultId: string
  record: ToolApprovalResultRecord
}

interface GoogleToolResultBody extends StashedResult {
  toolCallId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function serializedBytes(value: unknown): number {
  const serialized = JSON.stringify(value)

  return serialized === undefined
    ? 0
    : new TextEncoder().encode(serialized).byteLength
}

function toolNameOfPart(part: Record<string, unknown>): string | null {
  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' ? part.toolName : null
  }

  return typeof part.type === 'string' && part.type.startsWith(TOOL_PART_PREFIX)
    ? part.type.slice(TOOL_PART_PREFIX.length)
    : null
}

/**
 * A tool part of a Google tool, static (`tool-google__*`) or dynamic. Every
 * such part is redacted for D1, whatever its origin.
 */
export function isGoogleToolPart(
  part: unknown,
): part is Record<string, unknown> {
  return isRecord(part) && isGoogleToolName(toolNameOfPart(part))
}

function isStaticGoogleToolPart(part: unknown): boolean {
  return isRecord(part)
    && part.type !== 'dynamic-tool'
    && isGoogleToolPart(part)
}

function hasRanState(part: Record<string, unknown>): boolean {
  return part.state === 'output-available' || part.state === 'output-error'
}

/**
 * Whether parts hold a Google result: a static `tool-google__*` part with
 * an output. A registered Google tool always produces a static part; a
 * model-invented `google__x` call, or a Google call that failed, brought no
 * content and does not count. Works on parts already redacted for D1.
 */
export function hasGoogleToolResult(parts: unknown): boolean {
  return Array.isArray(parts) && parts.some((part) => {
    return isStaticGoogleToolPart(part)
      && (part as Record<string, unknown>).state === 'output-available'
      && googleToolResultHoldsContent(
        toolNameOfPart(part as Record<string, unknown>),
        (part as Record<string, unknown>).output,
      )
  })
}

/**
 * Whether the reply holds something the sticky chat flag is for: a Google
 * result that returned data, or a file or code execution run the send marks
 * as Google-derived. A Google call that only failed (a refused id, a Drive
 * error) keeps its transient taint for the rest of the send but never sets
 * the flag.
 */
export function holdsStickyGoogleFlagTrigger(parts: unknown): boolean {
  if (hasGoogleToolResult(parts)) {
    return true
  }

  return Array.isArray(parts) && parts.some((part) => {
    return isRecord(part)
      && (
        part.type === 'file'
        || toolNameOfPart(part) === CODE_EXECUTION_MODEL_TOOL
      )
  })
}

/**
 * Whether a step content item of the model stream (`tool-result`) came from
 * a Google tool, so the send can tell the client that the chat now holds
 * Google data.
 */
export function isGoogleToolResultContent(content: unknown): boolean {
  return isRecord(content)
    && content.type === 'tool-result'
    && isGoogleToolName(content.toolName)
    && googleToolResultHoldsContent(content.toolName, content.output)
}

/**
 * Whether a chat holds content from Google: the sticky
 * `chats.google_data_at` flag, set once and never cleared, a Google result
 * still in the given messages (a chat from before the flag), or a marked
 * artifact or document that names the chat as its origin
 * (`holdsMarkedOrigin`, from `chatMarkedOriginExtras`). It does not read file
 * parts: `resolveSendGoogleContent` finds an attached Google copy or marked
 * file at send start and flags the chat. The one function every send,
 * branch and later data guard asks.
 */
export function chatHoldsGoogleData(input: {
  googleDataAt?: Date | number | null
  messages?: ReadonlyArray<{ parts: unknown }>
  holdsMarkedOrigin?: boolean | number | null
}): boolean {
  if (input.googleDataAt || input.holdsMarkedOrigin) {
    return true
  }

  return (input.messages ?? []).some((message) => {
    return hasGoogleToolResult(message.parts)
  })
}

/**
 * The code execution gate of a send in a chat that holds Google data: Run
 * code is not offered at all, because its code, output and files are
 * stored without any Google marking and the provider runs it inside its
 * own response, where no approval can stop it.
 */
export function withholdCodeExecutionForGoogleData<
  Gate extends { tools: string[], active: boolean, filesActive: boolean },
>(gate: Gate, holdsGoogleData: boolean): Gate {
  if (!holdsGoogleData) {
    return gate
  }

  return {
    ...gate,
    tools: gate.tools.filter(tool => tool !== CODE_EXECUTION_MODEL_TOOL),
    active: false,
    filesActive: false,
  } as Gate
}

/**
 * The relational query extra that reads, inside the query that loads the
 * chat, whether an artifact or a document with the derived mark names the
 * chat as its origin. A send that was killed before its reply was stored
 * leaves such a row in a chat with no flag and no `data-artifact` part; the
 * extra costs no query of its own and a chat without such rows reads false.
 */
export function chatMarkedOriginExtras() {
  return {
    holdsMarkedOrigin: (chat: { id: unknown }) => {
      return sql<number>`(exists (
        select 1 from ${schema.artifacts}
        where ${schema.artifacts.originChatId} = ${chat.id}
          and ${schema.artifacts.googleDerivedAt} is not null
      ) or exists (
        select 1 from ${schema.documents}
        where ${schema.documents.originChatId} = ${chat.id}
          and ${schema.documents.googleDerivedAt} is not null
      ))`
    },
  }
}

/**
 * Sets `chats.google_data_at` once for a chat that just recorded a Google
 * result; a chat that already has it keeps the first time. Best effort by
 * default: a failure is logged and the parts scan of `chatHoldsGoogleData`
 * still finds the stored result. With `failClosed` a failure throws, for the
 * callers that must not let Google data enter a send while the chat is
 * unflagged.
 */
export async function markChatGoogleData(
  db: DbClient,
  chatPublicId: string,
  logger: LoggerLike,
  options: { failClosed?: boolean } = {},
): Promise<void> {
  try {
    await db.update(schema.chats)
      .set({ googleDataAt: new Date() })
      .where(and(
        eq(schema.chats.id, chatPublicId),
        isNull(schema.chats.googleDataAt),
      ))
  } catch (exception) {
    logger.set({
      attributes: {
        googleTools: {
          chatFlag: 'failed',
          error: exceptionMessage(exception),
        },
      },
    })

    if (options.failClosed) {
      throw createError({
        message: 'Besidka could not record that this chat holds Google data.',
        status: 500,
        why: 'The chat flag write failed.',
        fix: 'Try again in a moment.',
      })
    }
  }
}

export function isGooglePersistedOutput(
  output: unknown,
): output is GoogleToolPersistedOutput {
  return isRecord(output)
    && output.bodyRemoved === true
    && Array.isArray(output.references)
}

function clampText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }

  const text = value.trim()

  return text ? text.slice(0, maxLength) : undefined
}

function safeLink(value: unknown): string | undefined {
  const link = clampText(value, REFERENCE_LINK_MAX_LENGTH)

  if (!link || !URL.canParse(link)) {
    return undefined
  }

  return new URL(link).protocol === 'https:' ? link : undefined
}

function toReference(value: unknown): GoogleToolReference | null {
  if (!isRecord(value)) {
    return null
  }

  const id = clampText(value.id, REFERENCE_ID_MAX_LENGTH)

  if (!id) {
    return null
  }

  const kind = clampText(value.kind, REFERENCE_KIND_MAX_LENGTH)
  const title = clampText(value.title, REFERENCE_TITLE_MAX_LENGTH)
  const link = safeLink(value.link)
  const date = clampText(value.date, REFERENCE_DATE_MAX_LENGTH)
  const parentId = typeof value.parentId === 'string'
    && REFERENCE_PARENT_ID_PATTERN.test(value.parentId)
    ? value.parentId
    : undefined

  return {
    id,
    ...(kind ? { kind } : {}),
    ...(title ? { title } : {}),
    ...(link ? { link } : {}),
    ...(date ? { date } : {}),
    ...(parentId ? { parentId } : {}),
  }
}

/**
 * The references-only form of a Google tool output: each reference keeps
 * its id and, when well formed, kind, title, an https link and a date;
 * everything else (the body) is dropped and `note` says why. An output with
 * no `references` list keeps none, so an unexpected shape never leaks a
 * body.
 */
export function toGooglePersistedOutput(
  output: unknown,
  note: string = GOOGLE_TOOL_BODY_NOT_KEPT_NOTE,
): GoogleToolPersistedOutput {
  const references = isRecord(output) && Array.isArray(output.references)
    ? output.references
      .slice(0, REFERENCES_MAX)
      .map(toReference)
      .filter((reference): reference is GoogleToolReference => {
        return reference !== null
      })
    : []

  return { references, bodyRemoved: true, note }
}

/**
 * Rewrites every Google tool part for `messages.parts` in place: a result
 * keeps only its references (`toGooglePersistedOutput`) and an error keeps
 * one fixed sentence, so no body or Google-written text reaches D1. The
 * part count, order, type, state and tool call id stay, so a resumed turn
 * never shrinks and `hasGoogleToolResult` still finds the call. Idempotent
 * and pure: the input is never mutated.
 */
export function redactGoogleToolPartsForPersistence(
  parts: UIMessage['parts'],
): UIMessage['parts'] {
  return parts.map((part) => {
    const record: unknown = part

    if (!isGoogleToolPart(record)) {
      return part
    }

    const redacted: Record<string, unknown> = { ...record }

    if ('output' in record) {
      redacted.output = isGooglePersistedOutput(record.output)
        ? toGooglePersistedOutput(record.output, record.output.note)
        : toGooglePersistedOutput(record.output)
    }

    if ('errorText' in record) {
      redacted.errorText = GOOGLE_TOOL_ERROR_PERSISTED_TEXT
    }

    return redacted as UiMessagePart
  })
}

/**
 * The bodies of the Google tool results in `parts` that still hold one: a
 * result whose output is not already the references-only form, or an error
 * whose text is not the fixed sentence.
 */
export function collectGoogleToolResultBodies(
  parts: readonly unknown[],
): GoogleToolResultBody[] {
  return parts.flatMap((part): GoogleToolResultBody[] => {
    if (!isGoogleToolPart(part) || typeof part.toolCallId !== 'string') {
      return []
    }

    if (
      part.state === 'output-available'
      && 'output' in part
      && !isGooglePersistedOutput(part.output)
    ) {
      return [{
        toolCallId: part.toolCallId,
        isError: false,
        output: part.output,
      }]
    }

    if (
      part.state === 'output-error'
      && typeof part.errorText === 'string'
      && part.errorText !== GOOGLE_TOOL_ERROR_PERSISTED_TEXT
    ) {
      return [{
        toolCallId: part.toolCallId,
        isError: true,
        output: part.errorText,
      }]
    }

    return []
  })
}

export function googleToolCallIdsOf(parts: readonly unknown[]): string[] {
  return [...new Set(parts.flatMap((part) => {
    return isGoogleToolPart(part)
      && hasRanState(part)
      && typeof part.toolCallId === 'string'
      ? [part.toolCallId]
      : []
  }))]
}

function stashedBodyOf(body: GoogleToolResultBody): StashedResult {
  if (serializedBytes(body.output) <= GOOGLE_TOOL_OUTPUT_MAX_BYTES) {
    return {
      isError: body.isError,
      output: body.isError
        ? body.output
        : withoutReferenceNames(body.output),
    }
  }

  return body.isError
    ? { isError: true, output: GOOGLE_TOOL_ERROR_PERSISTED_TEXT }
    : {
      isError: false,
      output: withoutReferenceNames(toGooglePersistedOutput(
        body.output,
        GOOGLE_TOOL_BODY_TOO_LARGE_NOTE,
      )),
    }
}

/**
 * The KV records that keep the Google result bodies of a reply paused for
 * approval (`tool-approval:result:<id>`, 24 hours), so the continuation can
 * give them back to the model while D1 keeps only the references. A body
 * over `GOOGLE_TOOL_OUTPUT_MAX_BYTES` is replaced by its references and a
 * note that tells the model it was too large. `recordToolApprovalPause`
 * writes them with the pause records, under one index write.
 */
export async function buildGoogleResultStash(
  owner: GoogleToolResultOwner,
  parts: readonly unknown[],
): Promise<{ entries: GoogleResultStashEntry[], oversized: number }> {
  const entries: GoogleResultStashEntry[] = []
  let oversized = 0

  for (const body of collectGoogleToolResultBodies(parts)) {
    const stashed = stashedBodyOf(body)

    if (serializedBytes(body.output) > GOOGLE_TOOL_OUTPUT_MAX_BYTES) {
      oversized += 1
    }

    entries.push({
      resultId: await toolApprovalResultIdOf(
        owner.messagePublicId,
        body.toolCallId,
      ),
      record: {
        version: TOOL_APPROVAL_RECORD_VERSION,
        userId: owner.userId,
        chatPublicId: owner.chatPublicId,
        messagePublicId: owner.messagePublicId,
        toolCallId: body.toolCallId,
        isError: stashed.isError,
        output: stashed.output,
        recordedAt: Date.now(),
      },
    })
  }

  return { entries, oversized }
}

function unavailableResultOf(
  part: Record<string, unknown>,
): StashedResult | null {
  if (part.state !== 'output-available') {
    return null
  }

  return {
    isError: false,
    output: withoutReferenceNames(toGooglePersistedOutput(
      part.output,
      GOOGLE_TOOL_BODY_UNAVAILABLE_NOTE,
    )),
  }
}

/**
 * The stashed bodies of the Google tool calls in a paused message, keyed by
 * tool call id. A record is used only when its user, chat, message and tool
 * call id all match. A missing, foreign or unreadable record gives that call
 * its references with a note that the content could not be kept, so the
 * model knows why and the continuation never fails over it.
 */
export async function loadGoogleToolResults(input: {
  kv: KVNamespace
  owner: GoogleToolResultOwner
  parts: readonly unknown[]
  logger: LoggerLike
}): Promise<Map<string, StashedResult>> {
  const results = new Map<string, StashedResult>()
  const googleParts = input.parts.filter((part) => {
    return isGoogleToolPart(part)
      && hasRanState(part)
      && typeof part.toolCallId === 'string'
  }) as Array<Record<string, unknown> & { toolCallId: string }>
  let loaded = 0
  let failed = 0
  let lastError: string | null = null

  for (const part of googleParts) {
    try {
      const record = await getToolApprovalResult(
        input.kv,
        await toolApprovalResultIdOf(
          input.owner.messagePublicId,
          part.toolCallId,
        ),
      )

      if (
        record
        && record.userId === input.owner.userId
        && record.chatPublicId === input.owner.chatPublicId
        && record.messagePublicId === input.owner.messagePublicId
        && record.toolCallId === part.toolCallId
      ) {
        results.set(part.toolCallId, {
          isError: record.isError,
          output: record.output,
        })
        loaded += 1

        continue
      }
    } catch (exception) {
      failed += 1
      lastError = exceptionMessage(exception)
    }

    const unavailable = unavailableResultOf(part)

    if (unavailable) {
      results.set(part.toolCallId, unavailable)
    }
  }

  if (googleParts.length > 0) {
    input.logger.set({
      attributes: {
        googleTools: {
          stashCalls: googleParts.length,
          stashLoaded: loaded,
          stashFailed: failed,
          ...(lastError ? { stashError: lastError } : {}),
        },
      },
    })
  }

  return results
}

/**
 * What one read of a chat's `besidka_chat_settings` row says about Google:
 * the "Allow in this chat" grants of Google tools (the exposed `google__`
 * name mapped to the definition hash the continuation stored in
 * `alwaysAllowTools`; pass each tool's hash as `chatGrantHash` to
 * `buildGoogleApprovalEntry`) and the services switched off in this chat
 * (`google_services_off`). A failed read is logged and fails toward the
 * restrictive side for both: no grants, so every Google read asks, and every
 * service off, so no Google tool is offered.
 */
export interface GoogleChatSettings {
  grantHashes: Record<string, string>
  servicesOff: GoogleService[]
}

export async function readGoogleChatSettings(
  db: DbClient,
  userId: number,
  chatPublicId: string,
  logger: LoggerLike,
): Promise<GoogleChatSettings> {
  try {
    const settings = await readBesidkaChatSettings(db, userId, chatPublicId)

    return {
      grantHashes: Object.fromEntries(Object.entries(settings.alwaysAllowTools)
        .filter(([key, hash]) => {
          return isGoogleToolName(key) && typeof hash === 'string' && hash
        })),
      servicesOff: settings.googleServicesOff ?? [],
    }
  } catch (exception) {
    logger.set({
      attributes: {
        googleTools: {
          chatGrantsRead: 'failed',
          error: exceptionMessage(exception),
        },
      },
    })

    return { grantHashes: {}, servicesOff: [...GOOGLE_SERVICES] }
  }
}

export async function readGoogleChatGrantHashes(
  db: DbClient,
  userId: number,
  chatPublicId: string,
  logger: LoggerLike,
): Promise<Record<string, string>> {
  return (await readGoogleChatSettings(db, userId, chatPublicId, logger))
    .grantHashes
}

/**
 * Removes the stashed bodies of the Google tool calls in a message once
 * its continuation finished without a new pause. Sequential deletes; a
 * failure is logged with counts only and the record expires within 24
 * hours.
 */
export async function deleteGoogleToolResults(input: {
  kv: KVNamespace
  messagePublicId: string
  parts: readonly unknown[]
  logger: LoggerLike
}): Promise<void> {
  const toolCallIds = googleToolCallIdsOf(input.parts)
  let failed = 0
  let lastError: string | null = null

  for (const toolCallId of toolCallIds) {
    try {
      await deleteToolApprovalResult(
        input.kv,
        await toolApprovalResultIdOf(input.messagePublicId, toolCallId),
      )
    } catch (exception) {
      failed += 1
      lastError = exceptionMessage(exception)
    }
  }

  if (failed > 0) {
    input.logger.set({
      attributes: {
        googleTools: {
          stashDelete: 'failed',
          failed,
          ...(lastError ? { error: lastError } : {}),
        },
      },
    })
  }
}

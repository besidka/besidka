import type { UIMessage } from 'ai'
import type { KVNamespace } from '@cloudflare/workers-types'
import { isGoogleToolName } from '#shared/utils/google-tool-approvals'
import { TOOL_APPROVAL_RECORD_VERSION } from '#shared/utils/tool-approval-policy'
import { readBesidkaChatSettings } from '~~/server/utils/besidka-tools/chat-settings'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { StashedResult } from '~~/server/utils/tool-approval/continuation'
import {
  deleteToolApprovalResult,
  getToolApprovalResult,
  putToolApprovalResults,
  toolApprovalResultIdOf,
} from '~~/server/utils/tool-approval/kv'
import type { ToolApprovalResultRecord } from '~~/server/utils/tool-approval/kv'

type UiMessagePart = UIMessage['parts'][number]

const TOOL_PART_PREFIX = 'tool-'
const REFERENCES_MAX = 50
const REFERENCE_ID_MAX_LENGTH = 256
const REFERENCE_TITLE_MAX_LENGTH = 300
const REFERENCE_LINK_MAX_LENGTH = 2048
const REFERENCE_DATE_MAX_LENGTH = 64
const REFERENCE_KIND_MAX_LENGTH = 32

export const GOOGLE_TOOL_ERROR_PERSISTED_TEXT = 'The Google tool did not '
  + 'return a result.'

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
 * The stored form of a Google tool result: the sanitized references and a
 * marker that the body was removed.
 */
export interface GoogleToolPersistedOutput {
  references: GoogleToolReference[]
  bodyRemoved: true
}

export interface GoogleToolResultOwner {
  userId: number
  chatPublicId: string
  messagePublicId: string
}

interface GoogleToolResultBody extends StashedResult {
  toolCallId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toolNameOfPart(part: Record<string, unknown>): string | null {
  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' ? part.toolName : null
  }

  return typeof part.type === 'string' && part.type.startsWith(TOOL_PART_PREFIX)
    ? part.type.slice(TOOL_PART_PREFIX.length)
    : null
}

export function isGoogleToolPart(
  part: unknown,
): part is Record<string, unknown> {
  return isRecord(part) && isGoogleToolName(toolNameOfPart(part))
}

function hasRanState(part: Record<string, unknown>): boolean {
  return part.state === 'output-available' || part.state === 'output-error'
}

/**
 * Whether stored parts hold a Google tool call that ran (a result or an
 * error, references or body). Works on parts already redacted for D1.
 */
export function hasGoogleToolResult(parts: unknown): boolean {
  return Array.isArray(parts) && parts.some((part) => {
    return isGoogleToolPart(part) && hasRanState(part)
  })
}

/**
 * Whether a chat already holds content from Google, read from its stored
 * messages. The one place a send asks this, so a chat-level flag can
 * replace the scan later without touching the callers.
 */
export function chatHoldsGoogleData(
  messages: ReadonlyArray<{ parts: unknown }>,
): boolean {
  return messages.some(message => hasGoogleToolResult(message.parts))
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

  if (!link) {
    return undefined
  }

  try {
    return new URL(link).protocol === 'https:' ? link : undefined
  } catch {
    return undefined
  }
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

  return {
    id,
    ...(kind ? { kind } : {}),
    ...(title ? { title } : {}),
    ...(link ? { link } : {}),
    ...(date ? { date } : {}),
  }
}

/**
 * The references-only form of a Google tool output: each reference keeps
 * its id and, when well formed, kind, title, an https link and a date;
 * everything else (the body) is dropped. An output with no `references`
 * list keeps none, so an unexpected shape never leaks a body.
 */
export function toGooglePersistedOutput(
  output: unknown,
): GoogleToolPersistedOutput {
  const references = isRecord(output) && Array.isArray(output.references)
    ? output.references
      .slice(0, REFERENCES_MAX)
      .map(toReference)
      .filter((reference): reference is GoogleToolReference => {
        return reference !== null
      })
    : []

  return { references, bodyRemoved: true }
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
      redacted.output = toGooglePersistedOutput(record.output)
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

/**
 * Keeps the Google tool result bodies of a turn paused for approval in KV
 * (`tool-approval:result:<id>`, 24 hours, listed in the per-chat index), so
 * the continuation can give them back to the model while D1 keeps only the
 * references. A new user message, deleting the chat and deleting the
 * account remove them through the index; a finished continuation removes
 * them (`deleteGoogleToolResults`). Best effort: a failure is logged with
 * counts only and the continuation then sees the references.
 */
export async function stashGoogleToolResults(input: {
  kv: KVNamespace
  owner: GoogleToolResultOwner
  parts: readonly unknown[]
  logger: LoggerLike
}): Promise<void> {
  const bodies = collectGoogleToolResultBodies(input.parts)

  if (bodies.length === 0) {
    return
  }

  try {
    const entries: Array<{
      resultId: string
      record: ToolApprovalResultRecord
    }> = []

    for (const body of bodies) {
      entries.push({
        resultId: await toolApprovalResultIdOf(
          input.owner.messagePublicId,
          body.toolCallId,
        ),
        record: {
          version: TOOL_APPROVAL_RECORD_VERSION,
          userId: input.owner.userId,
          chatPublicId: input.owner.chatPublicId,
          messagePublicId: input.owner.messagePublicId,
          toolCallId: body.toolCallId,
          isError: body.isError,
          output: body.output,
          recordedAt: Date.now(),
        },
      })
    }

    const outcomes = await putToolApprovalResults(input.kv, entries)

    input.logger.set({
      attributes: {
        googleTools: {
          stashed: outcomes.length,
          truncated: outcomes.filter(outcome => outcome.truncated).length,
        },
      },
    })
  } catch (exception) {
    input.logger.set({
      attributes: {
        googleTools: {
          stash: 'failed',
          error: exceptionMessage(exception),
        },
      },
    })
  }
}

/**
 * The stashed bodies of the Google tool calls in a paused message, keyed by
 * tool call id. A record is used only when its user, chat, message and tool
 * call id all match; a missing, foreign or unreadable record is left out,
 * so that call reaches the model as its references.
 */
export async function loadGoogleToolResults(input: {
  kv: KVNamespace
  owner: GoogleToolResultOwner
  parts: readonly unknown[]
  logger: LoggerLike
}): Promise<Map<string, StashedResult>> {
  const results = new Map<string, StashedResult>()
  const toolCallIds = googleToolCallIdsOf(input.parts)
  let failed = 0

  for (const toolCallId of toolCallIds) {
    try {
      const record = await getToolApprovalResult(
        input.kv,
        await toolApprovalResultIdOf(input.owner.messagePublicId, toolCallId),
      )

      if (
        record
        && record.userId === input.owner.userId
        && record.chatPublicId === input.owner.chatPublicId
        && record.messagePublicId === input.owner.messagePublicId
        && record.toolCallId === toolCallId
      ) {
        results.set(toolCallId, {
          isError: record.isError,
          output: record.output,
        })
      }
    } catch {
      failed += 1
    }
  }

  if (toolCallIds.length > 0) {
    input.logger.set({
      attributes: {
        googleTools: {
          stashCalls: toolCallIds.length,
          stashLoaded: results.size,
          stashFailed: failed,
        },
      },
    })
  }

  return results
}

/**
 * The "Allow in this chat" grants of Google tools in this chat: the exposed
 * `google__` name mapped to the definition hash the continuation stored in
 * `besidka_chat_settings.alwaysAllowTools`. Pass each tool's hash as
 * `chatGrantHash` to `buildGoogleApprovalEntry`. A failed read is logged
 * and means no grants, so every Google read asks.
 */
export async function readGoogleChatGrantHashes(
  db: ReturnType<typeof useDb>,
  userId: number,
  chatPublicId: string,
  logger: LoggerLike,
): Promise<Record<string, string>> {
  try {
    const settings = await readBesidkaChatSettings(db, userId, chatPublicId)

    return Object.fromEntries(Object.entries(settings.alwaysAllowTools)
      .filter(([key, hash]) => {
        return isGoogleToolName(key) && typeof hash === 'string' && hash
      }))
  } catch (exception) {
    logger.set({
      attributes: {
        googleTools: {
          chatGrantsRead: 'failed',
          error: exceptionMessage(exception),
        },
      },
    })

    return {}
  }
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

  for (const toolCallId of toolCallIds) {
    try {
      await deleteToolApprovalResult(
        input.kv,
        await toolApprovalResultIdOf(input.messagePublicId, toolCallId),
      )
    } catch {
      failed += 1
    }
  }

  if (failed > 0) {
    input.logger.set({
      attributes: { googleTools: { stashDelete: 'failed', failed } },
    })
  }
}

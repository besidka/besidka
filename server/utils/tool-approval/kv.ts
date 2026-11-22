import type { KVNamespace } from '@cloudflare/workers-types'
import { createError } from 'evlog'
import { z } from 'zod'
import {
  TOOL_ACCESS_LEVELS,
  TOOL_APPROVAL_CHAT_INDEX_MAX_APPROVALS,
  TOOL_APPROVAL_CHAT_INDEX_MAX_MESSAGES,
  TOOL_APPROVAL_ID_PATTERN,
  TOOL_APPROVAL_KV_PREFIX,
  TOOL_APPROVAL_PAYLOAD_MAX_BYTES,
  TOOL_APPROVAL_PENDING_PER_MESSAGE,
  TOOL_APPROVAL_RECORD_VERSION,
  TOOL_APPROVAL_REASONS,
  TOOL_APPROVAL_REMEMBER_OPTIONS,
  TOOL_APPROVAL_SUBJECT_ID_PATTERN,
  TOOL_APPROVAL_SUMMARY_MAX_LENGTH,
  TOOL_APPROVAL_TTL_SECONDS,
  TOOL_FAMILIES,
} from '#shared/utils/tool-approval-policy'
import { serializedApprovalStateSchema } from '~~/server/utils/tool-approval/state'

const TURN_KEY_PREFIX = `${TOOL_APPROVAL_KV_PREFIX}turn:`
const RESULT_KEY_PREFIX = `${TOOL_APPROVAL_KV_PREFIX}result:`
const CHAT_KEY_PREFIX = `${TOOL_APPROVAL_KV_PREFIX}chat:`
const SUBJECT_ID_MAX_LENGTH = 64
const TOOL_NAME_MAX_LENGTH = 256
const TOOL_CALL_ID_MAX_LENGTH = 256
const SIGNATURE_MAX_LENGTH = 512
const HASH_MAX_LENGTH = 128
const TOOL_LIST_MAX = 200

const subjectIdSchema = z.string().min(1).max(SUBJECT_ID_MAX_LENGTH)

/**
 * A family this version does not know (a record written by a newer or
 * older deploy) reads as null: the record still loads, and the replay
 * denies that one call (`invalid-input`) instead of the whole continuation
 * failing as expired. A null family never matches a live tool.
 */
const storedFamilySchema = z.union([
  z.enum(TOOL_FAMILIES),
  z.string().min(1).max(SUBJECT_ID_MAX_LENGTH).transform(() => null),
])

/**
 * A reason this version does not know reads as `default`. The reason only
 * labels the prompt; the remember options are stored on their own.
 */
const storedReasonSchema = z.union([
  z.enum(TOOL_APPROVAL_REASONS),
  z.string().min(1).max(SUBJECT_ID_MAX_LENGTH).transform(() => {
    return 'default' as const
  }),
])

const pendingSnapshotSchema = z.object({
  model: z.string().min(1).max(TOOL_NAME_MAX_LENGTH),
  gateway: z.string().max(SUBJECT_ID_MAX_LENGTH).nullable(),
  reasoning: z.enum(['off', 'low', 'medium', 'high']),
  connectorIds: z.array(subjectIdSchema).max(TOOL_LIST_MAX),
})

const pendingApprovalSchema = z.object({
  version: z.literal(TOOL_APPROVAL_RECORD_VERSION),
  userId: z.number().int().positive(),
  chatPublicId: subjectIdSchema,
  messagePublicId: subjectIdSchema,
  toolCallId: z.string().min(1).max(TOOL_CALL_ID_MAX_LENGTH),
  family: storedFamilySchema,
  access: z.enum(TOOL_ACCESS_LEVELS),
  toolName: z.string().min(1).max(TOOL_NAME_MAX_LENGTH),
  connectorId: subjectIdSchema.nullable(),
  definitionHash: z.string().min(1).max(HASH_MAX_LENGTH).nullable(),
  input: z.unknown(),
  callProviderMetadata: z.record(
    z.string(),
    z.record(z.string(), z.unknown()),
  ).nullable().optional(),
  signature: z.string().min(1).max(SIGNATURE_MAX_LENGTH),
  reason: storedReasonSchema,
  rememberOptions: z.array(z.enum(TOOL_APPROVAL_REMEMBER_OPTIONS))
    .max(TOOL_APPROVAL_REMEMBER_OPTIONS.length),
  summary: z.string().max(TOOL_APPROVAL_SUMMARY_MAX_LENGTH),
  auditCallId: z.number().int().positive().nullable(),
  snapshot: pendingSnapshotSchema,
})

const turnRecordSchema = z.object({
  version: z.literal(TOOL_APPROVAL_RECORD_VERSION),
  userId: z.number().int().positive(),
  chatPublicId: subjectIdSchema,
  messagePublicId: subjectIdSchema,
  pendingApprovalIds: z.array(z.string().regex(TOOL_APPROVAL_ID_PATTERN))
    .max(TOOL_APPROVAL_PENDING_PER_MESSAGE),
  state: serializedApprovalStateSchema,
})

const resultRecordSchema = z.object({
  version: z.literal(TOOL_APPROVAL_RECORD_VERSION),
  userId: z.number().int().positive(),
  chatPublicId: subjectIdSchema,
  messagePublicId: subjectIdSchema,
  toolCallId: z.string().min(1).max(TOOL_CALL_ID_MAX_LENGTH),
  isError: z.boolean(),
  output: z.unknown(),
  recordedAt: z.number().int().nonnegative(),
})

const chatIndexSchema = z.object({
  version: z.literal(TOOL_APPROVAL_RECORD_VERSION),
  approvalIds: z.array(z.string().regex(TOOL_APPROVAL_ID_PATTERN))
    .max(TOOL_APPROVAL_CHAT_INDEX_MAX_APPROVALS),
  messageIds: z.array(z.string().regex(TOOL_APPROVAL_SUBJECT_ID_PATTERN))
    .max(TOOL_APPROVAL_CHAT_INDEX_MAX_MESSAGES),
})

export type ToolApprovalPendingRecord = z.infer<typeof pendingApprovalSchema>
export type ToolApprovalPendingSnapshot = z.infer<typeof pendingSnapshotSchema>
export type ToolApprovalTurnRecord = z.infer<typeof turnRecordSchema>
export type ToolApprovalResultRecord = z.infer<typeof resultRecordSchema>
export type ToolApprovalChatIndex = z.infer<typeof chatIndexSchema>

export interface PutToolApprovalResultOutcome {
  truncated: boolean
}

export interface DeleteToolApprovalChatRecordsResult {
  keysDeleted: number
}

export function isWellFormedToolApprovalId(value: unknown): value is string {
  return typeof value === 'string' && TOOL_APPROVAL_ID_PATTERN.test(value)
}

export function isWellFormedToolApprovalSubjectId(
  value: unknown,
): value is string {
  return typeof value === 'string'
    && TOOL_APPROVAL_SUBJECT_ID_PATTERN.test(value)
}

export function toolApprovalKey(approvalId: string): string {
  return `${TOOL_APPROVAL_KV_PREFIX}${assertApprovalId(approvalId)}`
}

export function toolApprovalTurnKey(messagePublicId: string): string {
  return `${TURN_KEY_PREFIX}${assertSubjectId(messagePublicId)}`
}

export function toolApprovalChatKey(chatPublicId: string): string {
  return `${CHAT_KEY_PREFIX}${assertSubjectId(chatPublicId)}`
}

export function toolApprovalResultKey(approvalId: string): string {
  return `${RESULT_KEY_PREFIX}${assertApprovalId(approvalId)}`
}

function assertApprovalId(approvalId: string): string {
  if (!isWellFormedToolApprovalId(approvalId)) {
    throw createError({
      message: 'Invalid approval id',
      status: 400,
      why: 'The approval id does not match the allowed pattern',
    })
  }

  return approvalId
}

function assertSubjectId(subjectId: string): string {
  if (!isWellFormedToolApprovalSubjectId(subjectId)) {
    throw createError({
      message: 'Invalid message id',
      status: 400,
      why: 'The message id does not match the allowed pattern',
    })
  }

  return subjectId
}

function payloadBytes(value: unknown): number {
  const serialized = JSON.stringify(value)

  return serialized === undefined
    ? 0
    : new TextEncoder().encode(serialized).length
}

function assertReadable(schema: z.ZodType, record: unknown): void {
  const parsed = schema.safeParse(record)

  if (parsed.success) {
    return
  }

  throw createError({
    message: 'Approval record is invalid',
    status: 500,
    why: parsed.error.issues
      .map(issue => `${issue.path.join('.')}: ${issue.message}`)
      .join('; '),
  })
}

async function putRecord(
  kv: KVNamespace,
  key: string,
  value: unknown,
): Promise<void> {
  await kv.put(key, JSON.stringify(value), {
    expirationTtl: TOOL_APPROVAL_TTL_SECONDS,
  })
}

function addBounded(
  items: string[],
  item: string,
  limit: number,
): string[] {
  const withoutItem = items.filter(existing => existing !== item)

  return [...withoutItem, item].slice(-limit)
}

/**
 * Adds approval ids and/or a message id to the per-chat index
 * `tool-approval:chat:<chatPublicId>`, which is how deleting a chat finds
 * the keys it has to remove: the pending keys are named by approval id, the
 * turn keys by message id and the result keys by a result id
 * (`toolApprovalResultIdOf`) listed with the approval ids, and nothing else
 * ties them to a chat. The index
 * lives 24 hours like the records it lists and is refreshed on every write.
 * It is bounded; past the bound the oldest ids fall off, and the record they
 * name expires on its own within 24 hours. The read-modify-write is not
 * atomic: two writers racing on one chat can lose an id, with the same
 * 24 hour residual. Written before the record it names, so a crash between
 * the two leaves only an id with no record behind it.
 */
async function indexChatRecord(
  kv: KVNamespace,
  chatPublicId: string,
  ids: { approvalIds?: readonly string[], messageId?: string },
): Promise<void> {
  const key = toolApprovalChatKey(chatPublicId)
  const current = await readRecord(kv, key, chatIndexSchema)
  const index: ToolApprovalChatIndex = {
    version: TOOL_APPROVAL_RECORD_VERSION,
    approvalIds: current?.approvalIds ?? [],
    messageIds: current?.messageIds ?? [],
  }

  for (const approvalId of ids.approvalIds ?? []) {
    index.approvalIds = addBounded(
      index.approvalIds,
      assertApprovalId(approvalId),
      TOOL_APPROVAL_CHAT_INDEX_MAX_APPROVALS,
    )
  }

  if (ids.messageId) {
    index.messageIds = addBounded(
      index.messageIds,
      ids.messageId,
      TOOL_APPROVAL_CHAT_INDEX_MAX_MESSAGES,
    )
  }

  await putRecord(kv, key, index)
}

async function readRecord<Schema extends z.ZodType>(
  kv: KVNamespace,
  key: string,
  schema: Schema,
): Promise<z.infer<Schema> | null> {
  const stored = await kv.get(key)

  if (!stored) {
    return null
  }

  let parsedJson: unknown

  try {
    parsedJson = JSON.parse(stored)
  } catch {
    return null
  }

  const parsed = schema.safeParse(parsedJson)

  return parsed.success ? parsed.data : null
}

/**
 * Stores the pending record and lists it in the per-chat index. Refuses a
 * record whose serialized input is over `TOOL_APPROVAL_PAYLOAD_MAX_BYTES`
 * (413): the user is shown, and the model signs, exactly this input, so it
 * is never cut down. Refuses a record its own schema would reject on read
 * (500), so a pause that could never be answered fails when it is stored
 * instead of reading as expired at the answer.
 */
export async function putToolApproval(
  kv: KVNamespace,
  approvalId: string,
  record: ToolApprovalPendingRecord,
): Promise<void> {
  const key = toolApprovalKey(approvalId)

  if (payloadBytes(record.input) > TOOL_APPROVAL_PAYLOAD_MAX_BYTES) {
    throw createError({
      message: 'Tool input is too large to approve',
      status: 413,
      why: `The tool input is larger than ${TOOL_APPROVAL_PAYLOAD_MAX_BYTES} bytes`,
      fix: 'Ask for a smaller action',
    })
  }

  assertReadable(pendingApprovalSchema, record)
  await indexChatRecord(kv, record.chatPublicId, { approvalIds: [approvalId] })
  await putRecord(kv, key, record)
}

export async function getToolApproval(
  kv: KVNamespace,
  approvalId: string,
): Promise<ToolApprovalPendingRecord | null> {
  if (!isWellFormedToolApprovalId(approvalId)) {
    return null
  }

  return await readRecord(
    kv,
    toolApprovalKey(approvalId),
    pendingApprovalSchema,
  )
}

export async function deleteToolApproval(
  kv: KVNamespace,
  approvalId: string,
): Promise<void> {
  await kv.delete(toolApprovalKey(approvalId))
}

export async function putToolApprovalTurn(
  kv: KVNamespace,
  messagePublicId: string,
  record: ToolApprovalTurnRecord,
): Promise<void> {
  const key = toolApprovalTurnKey(messagePublicId)

  assertReadable(turnRecordSchema, record)
  await indexChatRecord(kv, record.chatPublicId, {
    messageId: messagePublicId,
  })
  await putRecord(kv, key, record)
}

export async function getToolApprovalTurn(
  kv: KVNamespace,
  messagePublicId: string,
): Promise<ToolApprovalTurnRecord | null> {
  if (!isWellFormedToolApprovalSubjectId(messagePublicId)) {
    return null
  }

  return await readRecord(
    kv,
    toolApprovalTurnKey(messagePublicId),
    turnRecordSchema,
  )
}

export async function deleteToolApprovalTurn(
  kv: KVNamespace,
  messagePublicId: string,
): Promise<void> {
  await kv.delete(toolApprovalTurnKey(messagePublicId))
}

function cappedResultRecord(record: ToolApprovalResultRecord): {
  stored: ToolApprovalResultRecord
  truncated: boolean
} {
  const outputBytes = payloadBytes(record.output)
  const truncated = outputBytes > TOOL_APPROVAL_PAYLOAD_MAX_BYTES

  if (!truncated) {
    return { stored: record, truncated }
  }

  return {
    stored: {
      ...record,
      output: `[Output omitted: ${outputBytes} bytes is over the `
        + `${TOOL_APPROVAL_PAYLOAD_MAX_BYTES} byte limit]`,
    },
    truncated,
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

/**
 * The id a stashed tool result is stored and indexed under: the SHA-256 of
 * the message public id and the tool call id, base64url. Tool call ids are
 * provider strings that need not match `TOOL_APPROVAL_ID_PATTERN` and are
 * not unique across users or messages, so they are never used as a key on
 * their own. The 43 characters always match the pattern.
 */
export async function toolApprovalResultIdOf(
  messagePublicId: string,
  toolCallId: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${messagePublicId}\n${toolCallId}`),
  )

  return toBase64Url(new Uint8Array(digest))
}

/**
 * Stores one result record under `tool-approval:result:<id>` and lists the
 * id in the per-chat index, like `putToolApprovalResults` with one entry.
 */
export async function putToolApprovalResult(
  kv: KVNamespace,
  approvalId: string,
  record: ToolApprovalResultRecord,
): Promise<PutToolApprovalResultOutcome> {
  const [outcome] = await putToolApprovalResults(kv, [
    { resultId: approvalId, record },
  ])

  return outcome ?? { truncated: false }
}

/**
 * Stores the bodies of tool results a paused turn must give back to the
 * model on its continuation (today: Google tool results, which D1 keeps as
 * references only). All ids go into the per-chat index in one index write,
 * then each record is written, one KV connection at a time, for 24 hours.
 * A result whose serialized output is over `TOOL_APPROVAL_PAYLOAD_MAX_BYTES`
 * is stored with the output replaced by a short marker, and its outcome says
 * so. Every entry must name the same chat.
 */
export async function putToolApprovalResults(
  kv: KVNamespace,
  entries: ReadonlyArray<{
    resultId: string
    record: ToolApprovalResultRecord
  }>,
): Promise<PutToolApprovalResultOutcome[]> {
  const first = entries[0]

  if (!first) {
    return []
  }

  const isOneChat = entries.every((entry) => {
    return entry.record.chatPublicId === first.record.chatPublicId
  })

  if (!isOneChat) {
    throw createError({
      message: 'Approval results name different chats',
      status: 500,
      why: 'One batch of stashed results must belong to one chat',
    })
  }

  const keyed = entries.map((entry) => {
    assertReadable(resultRecordSchema, entry.record)

    return {
      key: toolApprovalResultKey(entry.resultId),
      ...cappedResultRecord(entry.record),
    }
  })

  await indexChatRecord(kv, first.record.chatPublicId, {
    approvalIds: entries.map(entry => entry.resultId),
  })

  for (const entry of keyed) {
    await putRecord(kv, entry.key, entry.stored)
  }

  return keyed.map(entry => ({ truncated: entry.truncated }))
}

export async function getToolApprovalResult(
  kv: KVNamespace,
  approvalId: string,
): Promise<ToolApprovalResultRecord | null> {
  if (!isWellFormedToolApprovalId(approvalId)) {
    return null
  }

  return await readRecord(
    kv,
    toolApprovalResultKey(approvalId),
    resultRecordSchema,
  )
}

export async function deleteToolApprovalResult(
  kv: KVNamespace,
  approvalId: string,
): Promise<void> {
  await kv.delete(toolApprovalResultKey(approvalId))
}

/**
 * Deletes every approval key a chat owns: the pending, result and turn keys
 * its index lists, then the index itself (not counted). Sequential
 * deletes, one KV connection at a time. An id the index lost to its bound
 * or to a write race is not found here; that record expires within 24 hours.
 * An unreadable index is treated as empty and still deleted.
 */
export async function deleteToolApprovalChatRecords(
  kv: KVNamespace,
  chatPublicId: string,
): Promise<DeleteToolApprovalChatRecordsResult> {
  if (!isWellFormedToolApprovalSubjectId(chatPublicId)) {
    return { keysDeleted: 0 }
  }

  const indexKey = toolApprovalChatKey(chatPublicId)
  const index = await readRecord(kv, indexKey, chatIndexSchema)
  let keysDeleted = 0

  for (const approvalId of index?.approvalIds ?? []) {
    await kv.delete(toolApprovalKey(approvalId))
    await kv.delete(toolApprovalResultKey(approvalId))
    keysDeleted += 2
  }

  for (const messageId of index?.messageIds ?? []) {
    await kv.delete(toolApprovalTurnKey(messageId))
    keysDeleted += 1
  }

  await kv.delete(indexKey)

  return { keysDeleted }
}

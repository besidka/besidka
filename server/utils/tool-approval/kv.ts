import type { KVNamespace } from '@cloudflare/workers-types'
import { createError } from 'evlog'
import { z } from 'zod'
import {
  TOOL_APPROVAL_ID_PATTERN,
  TOOL_APPROVAL_KV_PREFIX,
  TOOL_APPROVAL_PENDING_PER_MESSAGE,
  TOOL_APPROVAL_RECORD_VERSION,
  TOOL_APPROVAL_REASONS,
  TOOL_APPROVAL_SUBJECT_ID_PATTERN,
  TOOL_APPROVAL_SUMMARY_MAX_LENGTH,
  TOOL_APPROVAL_TTL_SECONDS,
  TOOL_FAMILIES,
} from '#shared/utils/tool-approval-policy'
import { serializedApprovalStateSchema } from '~~/server/utils/tool-approval/state'

const TURN_KEY_PREFIX = `${TOOL_APPROVAL_KV_PREFIX}turn:`
const RESULT_KEY_PREFIX = `${TOOL_APPROVAL_KV_PREFIX}result:`
const SUBJECT_ID_MAX_LENGTH = 64
const TOOL_NAME_MAX_LENGTH = 256
const TOOL_CALL_ID_MAX_LENGTH = 256
const SIGNATURE_MAX_LENGTH = 512
const HASH_MAX_LENGTH = 128
const TOOL_LIST_MAX = 200

const subjectIdSchema = z.string().min(1).max(SUBJECT_ID_MAX_LENGTH)

const pendingSnapshotSchema = z.object({
  model: z.string().min(1).max(TOOL_NAME_MAX_LENGTH),
  gateway: z.string().max(SUBJECT_ID_MAX_LENGTH).nullable(),
  reasoning: z.enum(['off', 'low', 'medium', 'high']),
  toolNames: z.array(z.string().max(TOOL_NAME_MAX_LENGTH))
    .max(TOOL_LIST_MAX),
  connectorIds: z.array(subjectIdSchema).max(TOOL_LIST_MAX),
})

const pendingApprovalSchema = z.object({
  version: z.literal(TOOL_APPROVAL_RECORD_VERSION),
  userId: z.number().int().positive(),
  chatPublicId: subjectIdSchema,
  messagePublicId: subjectIdSchema,
  toolCallId: z.string().min(1).max(TOOL_CALL_ID_MAX_LENGTH),
  family: z.enum(TOOL_FAMILIES),
  toolName: z.string().min(1).max(TOOL_NAME_MAX_LENGTH),
  connectorId: subjectIdSchema.nullable(),
  definitionHash: z.string().min(1).max(HASH_MAX_LENGTH).nullable(),
  input: z.unknown(),
  signature: z.string().min(1).max(SIGNATURE_MAX_LENGTH),
  reason: z.enum(TOOL_APPROVAL_REASONS),
  summary: z.string().max(TOOL_APPROVAL_SUMMARY_MAX_LENGTH),
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

export type ToolApprovalPendingRecord = z.infer<typeof pendingApprovalSchema>
export type ToolApprovalPendingSnapshot = z.infer<typeof pendingSnapshotSchema>
export type ToolApprovalTurnRecord = z.infer<typeof turnRecordSchema>
export type ToolApprovalResultRecord = z.infer<typeof resultRecordSchema>

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

async function putRecord(
  kv: KVNamespace,
  key: string,
  value: unknown,
): Promise<void> {
  await kv.put(key, JSON.stringify(value), {
    expirationTtl: TOOL_APPROVAL_TTL_SECONDS,
  })
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

export async function putToolApproval(
  kv: KVNamespace,
  approvalId: string,
  record: ToolApprovalPendingRecord,
): Promise<void> {
  await putRecord(kv, toolApprovalKey(approvalId), record)
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
  await putRecord(kv, toolApprovalTurnKey(messagePublicId), record)
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

export async function putToolApprovalResult(
  kv: KVNamespace,
  approvalId: string,
  record: ToolApprovalResultRecord,
): Promise<void> {
  await putRecord(kv, toolApprovalResultKey(approvalId), record)
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

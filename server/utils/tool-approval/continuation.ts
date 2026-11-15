import type { KVNamespace } from '@cloudflare/workers-types'
import type { ModelMessage, ToolSet, UIMessage } from 'ai'
import { createError } from 'evlog'
import type { ConnectorAuditApproval } from '#shared/utils/connectors-policy'
import {
  TOOL_APPROVAL_CLAIM_HEARTBEAT_MS,
  TOOL_APPROVAL_EXPIRED_CODE,
  TOOL_APPROVAL_INTERRUPTED_CODE,
  TOOL_APPROVAL_REASON_MAX_LENGTH,
  TOOL_APPROVAL_RESPONSES_PER_MINUTE,
  TOOL_APPROVAL_STALE_CODE,
} from '#shared/utils/tool-approval-policy'
import type {
  ToolApprovalDenialReason,
  ToolApprovalRemember,
  ToolFamily,
  ToolPermissionMode,
} from '#shared/utils/tool-approval-policy'
import type { ToolApprovalResponseInput } from '~~/server/utils/chats/request-schema'
import {
  settleConnectorAuditRow,
  stripControlAndBidiCharacters,
} from '~~/server/utils/connectors/audit'
import {
  listConnectorChatSettings,
  listConnectorToolSettings,
  upsertConnectorChatSettings,
  upsertConnectorToolSettings,
} from '~~/server/utils/connectors/store'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  claimApproval,
  findClaim,
  isClaimLeaseExpired,
  markClaimDone,
  markClaimFailed,
  touchClaim,
} from '~~/server/utils/tool-approval/claims'
import type {
  ToolApprovalClaim,
  ToolApprovalClaimOwner,
} from '~~/server/utils/tool-approval/claims'
import {
  deleteToolApproval,
  getToolApproval,
  getToolApprovalTurn,
} from '~~/server/utils/tool-approval/kv'
import type {
  ToolApprovalPendingRecord,
  ToolApprovalTurnRecord,
} from '~~/server/utils/tool-approval/kv'
import {
  clampRemember,
  isAlwaysAskTier,
  resolveReplayApproval,
} from '~~/server/utils/tool-approval/policy'
import type { SendToolEntry } from '~~/server/utils/tool-approval/send'
import { addBesidkaChatGrant } from '~~/server/utils/besidka-tools/chat-settings'
import {
  createApprovalState,
  deserializeApprovalState,
  incrementCounter,
} from '~~/server/utils/tool-approval/state'
import type { ApprovalState } from '~~/server/utils/tool-approval/state'

type DbClient = ReturnType<typeof useDb>
type MessagePart = UIMessage['parts'][number]

const RATE_KEY_PREFIX = 'tool-approval-rate:'
const INVISIBLE_FORMAT_CHARACTERS = /[\p{Cf}\u{E0000}-\u{E007F}]/gu
const RATE_WINDOW_MILLISECONDS = 60_000
const RATE_KEY_TTL_SECONDS = 120

const MODEL_CONTEXT_TOOL_STATES = new Set<string>([
  'output-available',
  'output-error',
  'output-denied',
])

export const TOOL_APPROVAL_DENIAL_TEXT: Record<
  ToolApprovalDenialReason,
  string
> = {
  'blocked': 'This tool is blocked in the user\'s settings, so the action '
    + 'did not run.',
  'missing-tool': 'This tool is no longer available, so the action did not '
    + 'run.',
  'definition-drifted': 'This tool changed after the user was asked, so the '
    + 'action did not run. Ask again if it is still needed.',
  'over-cap': 'This turn reached its limit of approved actions, so the '
    + 'action did not run.',
  'invalid-input': 'Besidka could not check this action, so it did not run.',
}

export const TOOL_APPROVAL_USER_DENIAL_TEXT = 'The user declined this action.'

export interface ContinuationChatMessage {
  id: string
  publicId: string | null
  role: string
  parts: unknown
  tools: string[] | null
  reasoning: string
  usage: unknown
  createdAt: Date
}

export interface ContinuationTurn<Message extends ContinuationChatMessage> {
  assistant: Message
  user: Message
}

export interface PendingApprovalAnswer {
  response: ToolApprovalResponseInput
  record: ToolApprovalPendingRecord
}

export interface LoadedContinuation {
  turn: ToolApprovalTurnRecord
  state: ApprovalState
  answers: PendingApprovalAnswer[]
}

export interface ContinuationDecision {
  approvalId: string
  toolCallId: string
  toolName: string
  approved: boolean
  reason: string | undefined
  remember: ToolApprovalRemember
  denialReason: ToolApprovalDenialReason | null
  record: ToolApprovalPendingRecord
}

export type DuplicateContinuation = 'interrupted' | 'in-progress' | 'replay'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messagePublicIdOf(message: ContinuationChatMessage): string {
  return message.publicId ?? message.id
}

function isToolPart(part: unknown): part is Record<string, unknown> {
  return isRecord(part)
    && typeof part.type === 'string'
    && (part.type === 'dynamic-tool' || part.type.startsWith('tool-'))
}

function toolNameOf(part: Record<string, unknown>): string | null {
  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' ? part.toolName : null
  }

  return typeof part.type === 'string' ? part.type.slice('tool-'.length) : null
}

function approvalIdOf(part: Record<string, unknown>): string | null {
  return isRecord(part.approval) && typeof part.approval.id === 'string'
    ? part.approval.id
    : null
}

function staleError(why: string) {
  return createError({
    message: 'This approval is no longer current',
    status: 409,
    code: TOOL_APPROVAL_STALE_CODE,
    why,
    fix: 'Ask again',
  })
}

function expiredError(why: string) {
  return createError({
    message: 'This approval expired',
    status: 409,
    code: TOOL_APPROVAL_EXPIRED_CODE,
    why,
    fix: 'Ask again',
  })
}

function notFoundError(why: string) {
  return createError({
    message: 'Approval not found',
    status: 404,
    why,
  })
}

/**
 * Removes control, bidirectional, other format (zero-width, word joiner)
 * and tag characters from the note a user may add to an answer, trims it
 * and caps its length, so only plain text ever reaches the model as part of
 * a denial.
 */
export function sanitizeApprovalReason(
  reason: string | undefined,
): string | undefined {
  const cleaned = stripControlAndBidiCharacters(
    (reason ?? '').replace(/\s+/g, ' '),
  )
    .replace(INVISIBLE_FORMAT_CHARACTERS, '')
    .trim()
    .slice(0, TOOL_APPROVAL_REASON_MAX_LENGTH)

  return cleaned || undefined
}

function userDenialText(reason: string | undefined): string {
  const note = sanitizeApprovalReason(reason)

  return note
    ? `${TOOL_APPROVAL_USER_DENIAL_TEXT} Their note: ${note}`
    : TOOL_APPROVAL_USER_DENIAL_TEXT
}

/**
 * Counts approval responses per user in a one-minute KV window. Returns the
 * seconds to wait when the responses would go over the limit. The window is
 * a read-modify-write, so two racing requests can both pass at the edge;
 * the claims, not this limit, are what keep a call from running twice.
 */
export async function consumeToolApprovalResponses(
  kv: Pick<KVNamespace, 'get' | 'put'>,
  userId: number,
  responses: number,
  now: number = Date.now(),
): Promise<{ allowed: boolean, retryAfter: number }> {
  const key = `${RATE_KEY_PREFIX}${userId}`
  const stored = await kv.get(key)
  let windowStart = now
  let count = 0

  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored)

      if (
        isRecord(parsed)
        && typeof parsed.windowStart === 'number'
        && typeof parsed.count === 'number'
        && now - parsed.windowStart < RATE_WINDOW_MILLISECONDS
      ) {
        windowStart = parsed.windowStart
        count = parsed.count
      }
    } catch {
      count = 0
    }
  }

  if (count + responses > TOOL_APPROVAL_RESPONSES_PER_MINUTE) {
    return {
      allowed: false,
      retryAfter: Math.max(
        1,
        Math.ceil((windowStart + RATE_WINDOW_MILLISECONDS - now) / 1000),
      ),
    }
  }

  await kv.put(key, JSON.stringify({
    windowStart,
    count: count + responses,
  }), { expirationTtl: RATE_KEY_TTL_SECONDS })

  return { allowed: true, retryAfter: 0 }
}

/**
 * The paused assistant message a continuation answers and the user message
 * of its turn. The message must belong to the chat (404 otherwise) and be
 * its last message and an assistant message (409 `TOOL_APPROVAL_STALE`
 * otherwise): a newer message means the chat moved on and the approval no
 * longer applies.
 */
export function findContinuationTurn<Message extends ContinuationChatMessage>(
  messages: readonly Message[],
  messagePublicId: string,
): ContinuationTurn<Message> {
  const index = messages.findIndex((message) => {
    return messagePublicIdOf(message) === messagePublicId
  })

  if (index === -1) {
    throw notFoundError('The message does not belong to this chat')
  }

  const assistant = messages[index]!

  if (index !== messages.length - 1 || assistant.role !== 'assistant') {
    throw staleError('A newer message follows the paused reply')
  }

  for (let userIndex = index - 1; userIndex >= 0; userIndex--) {
    const candidate = messages[userIndex]!

    if (candidate.role === 'user') {
      return { assistant, user: candidate }
    }
  }

  throw staleError('The paused reply has no user message before it')
}

/**
 * The claims already taken for the answered approval ids, read before any
 * KV record: a double submit arrives after the first request deleted the
 * pending records, and must replay instead of reading as expired. A claim
 * row is only ever written after its owner was checked against the KV
 * record, and the lookup is scoped to the user, so a claim for another chat
 * or message is a 404.
 */
export async function findExistingClaims(
  db: DbClient,
  approvalIds: readonly string[],
  owner: ToolApprovalClaimOwner,
): Promise<ToolApprovalClaim[]> {
  const claims: ToolApprovalClaim[] = []

  for (const approvalId of approvalIds) {
    const claim = await findClaim(db, approvalId, owner.userId)

    if (!claim) {
      continue
    }

    if (
      claim.chatPublicId !== owner.chatPublicId
      || claim.messagePublicId !== owner.messagePublicId
    ) {
      throw notFoundError('The approval belongs to another message')
    }

    claims.push(claim)
  }

  return claims
}

/**
 * What a request whose approvals were already claimed gets back: the user
 * is told a call was interrupted when a claim outlived its lease without a
 * result (the call may or may not have run, so it never runs again); a
 * claim inside its lease means the first request is still working; done
 * claims replay the stored reply.
 */
export function classifyDuplicateContinuation(
  claims: readonly ToolApprovalClaim[],
  now: Date = new Date(),
): DuplicateContinuation {
  if (claims.some(claim => isClaimLeaseExpired(claim, now))) {
    return 'interrupted'
  }

  if (claims.some(claim => claim.status === 'claimed')) {
    return 'in-progress'
  }

  return 'replay'
}

export function createInterruptedError() {
  return createError({
    message: 'Interrupted. Ask again',
    status: 409,
    code: TOOL_APPROVAL_INTERRUPTED_CODE,
    why: 'The approved action stopped before Besidka recorded its result',
    fix: 'Ask again',
  })
}

function findAwaitingToolPart(
  parts: unknown,
  approvalId: string,
): Record<string, unknown> | null {
  if (!Array.isArray(parts)) {
    return null
  }

  const part = parts.find((candidate) => {
    return isToolPart(candidate)
      && candidate.state === 'approval-requested'
      && approvalIdOf(candidate) === approvalId
  })

  return part ?? null
}

/**
 * Loads and checks everything an answer refers to, before anything runs:
 * the turn record (missing: 409 expired), its owner (mismatch: 404), its
 * approval state (unreadable: 409, never a fresh state), the answered ids
 * against the turn's pending ids (anything but an exact match: 400, since a
 * partial answer runs one call and then fails the send), and each pending
 * record (missing: 409 expired; another user, chat, message, or a tool call
 * id and tool name the stored message does not hold in
 * `approval-requested`: 404).
 */
export async function loadContinuation(input: {
  kv: KVNamespace
  owner: ToolApprovalClaimOwner
  responses: readonly ToolApprovalResponseInput[]
  assistantParts: unknown
}): Promise<LoadedContinuation> {
  const { owner } = input
  const turn = await getToolApprovalTurn(input.kv, owner.messagePublicId)

  if (!turn) {
    throw expiredError('The paused turn is no longer stored')
  }

  if (
    turn.userId !== owner.userId
    || turn.chatPublicId !== owner.chatPublicId
    || turn.messagePublicId !== owner.messagePublicId
  ) {
    throw notFoundError('The paused turn belongs to another message')
  }

  const deserialized = deserializeApprovalState(turn.state)

  if (!deserialized.ok) {
    throw expiredError('The paused turn could not be read')
  }

  const answeredIds = new Set(input.responses.map((response) => {
    return response.approvalId
  }))
  const pendingIds = new Set(turn.pendingApprovalIds)
  const coversExactly = answeredIds.size === pendingIds.size
    && [...pendingIds].every(approvalId => answeredIds.has(approvalId))

  if (!coversExactly) {
    throw createError({
      message: 'Answer every waiting action',
      status: 400,
      why: 'The answers do not match the actions waiting for approval',
      fix: 'Answer every waiting action of this message at once',
    })
  }

  const answers: PendingApprovalAnswer[] = []

  for (const response of input.responses) {
    const record = await getToolApproval(input.kv, response.approvalId)

    if (!record) {
      throw expiredError('A waiting action is no longer stored')
    }

    const part = findAwaitingToolPart(input.assistantParts, response.approvalId)

    if (
      record.userId !== owner.userId
      || record.chatPublicId !== owner.chatPublicId
      || record.messagePublicId !== owner.messagePublicId
      || !part
      || part.toolCallId !== record.toolCallId
      || toolNameOf(part) !== record.toolName
    ) {
      throw notFoundError('The waiting action belongs to another message')
    }

    answers.push({ response, record })
  }

  return { turn, state: deserialized.state, answers }
}

/**
 * The user's permission mode for a tool whose approved call is replayed.
 * A Besidka tool reads the modes the send resolved from the stored Besidka
 * tool permissions (`resolveBesidkaPermissionModes`, keyed by the tool name
 * of the call), so a tool the user set to Blocked after approving does not
 * run on resume; a Besidka call with no resolved mode fails closed as
 * Blocked. Connector tools keep `ask`: their Blocked state is the C-5 tool
 * settings, which hide the tool from the live tool set, so the replay reads
 * it as missing. The registry is not imported here on purpose: the chat
 * route loads it only when an answer is a Besidka call.
 */
export function resolveReplayPermissionMode(
  family: ToolFamily | null = null,
  toolName = '',
  besidkaModes: ReadonlyMap<string, ToolPermissionMode> = new Map(),
): ToolPermissionMode {
  if (family === 'besidka') {
    return besidkaModes.get(toolName) ?? 'blocked'
  }

  return 'ask'
}

function cloneState(state: ApprovalState): ApprovalState {
  const clone = createApprovalState()

  state.taint.forEach(kind => clone.taint.add(kind))
  state.readSources.forEach(source => clone.readSources.add(source))
  state.toolReadSources.forEach(source => clone.toolReadSources.add(source))
  Object.assign(clone.counters, state.counters)

  return clone
}

/**
 * Decides every answer again against the live tool set before the SDK sees
 * it. A denial by the user carries the user's note. An approved call is
 * re-checked with `resolveReplayApproval`, on a copy of the state that
 * counts each earlier approved connector call of this answer, and becomes a
 * denial with a Besidka-written reason when the tool is missing, Blocked,
 * changed, or over the turn caps: the SDK only honors `denied` on replay,
 * and a missing tool would fail the whole stream instead of being denied.
 * The remember choice is clamped to the options the request offered.
 */
export function decideContinuation(input: {
  answers: readonly PendingApprovalAnswer[]
  entries: ReadonlyMap<string, SendToolEntry>
  state: ApprovalState
  besidkaPermissionModes?: ReadonlyMap<string, ToolPermissionMode>
}): ContinuationDecision[] {
  const replayState = cloneState(input.state)

  return input.answers.map(({ response, record }) => {
    const base = {
      approvalId: response.approvalId,
      toolCallId: record.toolCallId,
      toolName: record.toolName,
      record,
    }

    if (!response.approved) {
      return {
        ...base,
        approved: false,
        reason: userDenialText(response.reason),
        remember: 'once' as const,
        denialReason: null,
      }
    }

    const entry = input.entries.get(record.toolName) ?? null
    const replay = resolveReplayApproval({
      descriptor: entry?.descriptor ?? null,
      pending: record,
      state: replayState,
      permissionMode: resolveReplayPermissionMode(
        entry?.descriptor.family ?? record.family,
        record.toolName,
        input.besidkaPermissionModes,
      ),
    })

    if (replay.denialReason) {
      return {
        ...base,
        approved: false,
        reason: TOOL_APPROVAL_DENIAL_TEXT[replay.denialReason],
        remember: 'once' as const,
        denialReason: replay.denialReason,
      }
    }

    if (entry?.descriptor.family === 'connector') {
      incrementCounter(replayState, 'connectorCalls')
    }

    if (entry?.descriptor.family === 'besidka') {
      incrementCounter(replayState, 'builtInCalls')
    }

    return {
      ...base,
      approved: true,
      reason: undefined,
      remember: clampRemember(
        { rememberOptions: record.rememberOptions },
        response.remember,
      ),
      denialReason: null,
    }
  })
}

function respondedApproval(
  part: Record<string, unknown>,
  decision: ContinuationDecision,
): Record<string, unknown> {
  const approval = isRecord(part.approval) ? part.approval : {}

  return {
    id: decision.approvalId,
    ...(typeof approval.requestReason === 'string'
      ? { requestReason: approval.requestReason }
      : {}),
    approved: decision.approved,
    ...(decision.reason ? { reason: decision.reason } : {}),
  }
}

function isModelContextPart(part: unknown): boolean {
  if (!isRecord(part) || typeof part.type !== 'string') {
    return false
  }

  if (part.type === 'step-start' || part.type === 'reasoning') {
    return true
  }

  if (part.type === 'text') {
    return typeof part.text === 'string' && part.text.length > 0
  }

  return isToolPart(part)
    && typeof part.state === 'string'
    && MODEL_CONTEXT_TOOL_STATES.has(part.state)
}

/**
 * The paused assistant message twice, with every answered call in
 * `approval-responded`:
 *
 * - `modelMessage` is what the model and the SDK see: each answered call
 *   takes its exact input from the pending record (the stored copy is
 *   redacted), the provider metadata of the call (Gemini thought
 *   signatures; the stored artifact and document copies drop it) and, when
 *   approved, the signature the SDK checks; finished tool calls, text and
 *   reasoning keep their stored provider metadata (Anthropic thinking
 *   signatures, Gemini thought signatures) in their original order, step
 *   boundaries stay, and parts the model never needs (data, sources, files,
 *   unfinished calls) are dropped.
 * - `storedMessage` keeps the stored parts as they are, with the answered
 *   calls moved to `approval-responded` and no input or signature added, so
 *   it can seed `readUIMessageStream` and be written back to D1.
 */
export function buildResumedAssistantMessages(input: {
  messageId: string
  parts: readonly unknown[]
  decisions: readonly ContinuationDecision[]
}): { modelMessage: UIMessage, storedMessage: UIMessage } {
  const decisionsByApprovalId = new Map(input.decisions.map((decision) => {
    return [decision.approvalId, decision]
  }))
  const modelParts: unknown[] = []
  const storedParts: unknown[] = []

  for (const part of input.parts) {
    const approvalId = isToolPart(part) ? approvalIdOf(part) : null
    const decision = approvalId ? decisionsByApprovalId.get(approvalId) : null

    if (!isToolPart(part) || !decision) {
      storedParts.push(part)

      if (isModelContextPart(part)) {
        modelParts.push(part)
      }

      continue
    }

    const approval = respondedApproval(part, decision)

    const callProviderMetadata = decision.record.callProviderMetadata
      ?? part.callProviderMetadata

    storedParts.push({ ...part, state: 'approval-responded', approval })
    modelParts.push({
      ...part,
      ...(callProviderMetadata ? { callProviderMetadata } : {}),
      input: decision.record.input,
      state: 'approval-responded',
      approval: decision.approved
        ? { ...approval, signature: decision.record.signature }
        : approval,
    })
  }

  return {
    modelMessage: {
      id: input.messageId,
      role: 'assistant',
      parts: modelParts as MessagePart[],
    },
    storedMessage: {
      id: input.messageId,
      role: 'assistant',
      parts: storedParts as MessagePart[],
    },
  }
}

/**
 * Refuses a model prompt that does not end on the tool message holding the
 * approval answers. The SDK collects answers only from the last message and
 * fails the stream loudly when anything follows them, so this turns that
 * case into a clean 409 before any model call.
 */
export function assertEndsWithApprovalResponse(
  messages: readonly ModelMessage[],
): void {
  const last = messages.at(-1)
  const endsWithAnswers = last?.role === 'tool'
    && Array.isArray(last.content)
    && last.content.some(part => part.type === 'tool-approval-response')

  if (!endsWithAnswers) {
    throw staleError('The prompt does not end on the approval answers')
  }
}

/**
 * Takes the one-time right to run each answered call, in sorted id order,
 * before anything executes. Two requests racing over the same answers try
 * the same id first, so the one that loses that claim stops without holding
 * any other; it returns false and must replay instead of running anything.
 */
export async function claimContinuation(
  db: DbClient,
  approvalIds: readonly string[],
  owner: ToolApprovalClaimOwner,
): Promise<boolean> {
  const sorted = [...approvalIds].sort()

  for (const approvalId of sorted) {
    if (!await claimApproval(db, approvalId, owner)) {
      return false
    }
  }

  return true
}

/**
 * Settles what is known once the answers are claimed: the pending records
 * are deleted (the claims guard any resend from here on), a denied call's
 * claim is done and its connector audit row is settled as denied. Each
 * write is sequential and a failure is logged, never thrown.
 */
export async function settleClaimedContinuation(input: {
  db: DbClient
  kv: KVNamespace
  userId: number
  decisions: readonly ContinuationDecision[]
  logger: LoggerLike
}): Promise<void> {
  for (const decision of input.decisions) {
    try {
      await deleteToolApproval(input.kv, decision.approvalId)

      if (decision.approved) {
        continue
      }

      await markClaimDone(input.db, decision.approvalId, input.userId)

      if (decision.record.auditCallId !== null) {
        await settleConnectorAuditRow(
          input.db,
          input.userId,
          decision.record.auditCallId,
          {
            outcome: 'denied',
            approval: 'denied',
            resultBytes: 0,
            durationMs: 0,
          },
          input.logger,
        )
      }
    } catch (exception) {
      input.logger.set({
        attributes: {
          toolApproval: {
            settle: 'failed',
            error: exceptionMessage(exception),
          },
        },
      })
    }
  }
}

async function applyBesidkaRememberGrant(input: {
  db: DbClient
  userId: number
  chatPublicId: string
  decision: ContinuationDecision
  definitionHash: string
}): Promise<void> {
  if (input.decision.remember === 'chat') {
    await addBesidkaChatGrant(input.db, input.userId, input.chatPublicId, {
      toolName: input.decision.toolName,
      definitionHash: input.definitionHash,
    })

    return
  }

  const { setBesidkaToolPermissions, toBesidkaRegistryName } = await import(
    '~~/server/utils/besidka-tools/permissions'
  )

  await setBesidkaToolPermissions(
    input.userId,
    { tool: toBesidkaRegistryName(input.decision.toolName) },
    'allow',
    input.db,
  )
}

/**
 * Writes the grant a remember choice asks for, when the request offered it:
 * "in this chat" maps the exposed tool name to its definition hash in the
 * connector's chat settings, "always" sets the connector tool setting to
 * `always` with the approved hash (only when that setting row exists). The
 * choice was already clamped to what the request offered: only reason
 * `default` offers more than `once`, and a tool in the always-ask tier is
 * never granted even if a choice slipped through. The send and the replay
 * read back exactly these two values (`getConnectorTools`). For a Besidka
 * tool, "in this chat" stores the registry hash in the chat's
 * `besidka_chat_settings.alwaysAllowTools`, and "always" sets the tool's
 * permission to Always allow.
 */
export async function applyRememberGrants(input: {
  db: DbClient
  userId: number
  chatPublicId: string
  decisions: readonly ContinuationDecision[]
  entries: ReadonlyMap<string, SendToolEntry>
  logger: LoggerLike
}): Promise<void> {
  for (const decision of input.decisions) {
    const entry = input.entries.get(decision.toolName)
    const hash = entry?.descriptor.definitionHash
    const connector = entry?.connector

    if (
      !decision.approved
      || decision.remember === 'once'
      || !hash
      || !entry
      || isAlwaysAskTier(entry.descriptor)
    ) {
      continue
    }

    if (entry.descriptor.family === 'besidka') {
      try {
        await applyBesidkaRememberGrant({
          db: input.db,
          userId: input.userId,
          chatPublicId: input.chatPublicId,
          decision,
          definitionHash: hash,
        })
      } catch (exception) {
        input.logger.set({
          attributes: {
            toolApproval: {
              grant: 'failed',
              error: exceptionMessage(exception),
            },
          },
        })
      }

      continue
    }

    if (!connector) {
      continue
    }

    try {
      if (decision.remember === 'chat') {
        const settings = await listConnectorChatSettings(
          input.db,
          input.userId,
          input.chatPublicId,
        )
        const current = settings.find((setting) => {
          return setting.connectorId === connector.id
        })

        await upsertConnectorChatSettings(input.db, {
          userId: input.userId,
          chatPublicId: input.chatPublicId,
          connectorId: connector.id,
          enabled: current?.enabled ?? true,
          alwaysAllowTools: {
            ...current?.alwaysAllowTools,
            [decision.toolName]: hash,
          },
        })

        continue
      }

      const settings = await listConnectorToolSettings(
        input.db,
        input.userId,
        connector.id,
      )
      const current = settings.find((setting) => {
        return setting.toolName === connector.remoteToolName
      })

      if (!current || current.definitionHash !== hash) {
        continue
      }

      await upsertConnectorToolSettings(input.db, input.userId, connector.id, [{
        toolName: current.toolName,
        definitionHash: current.definitionHash,
        serverReadOnly: current.serverReadOnly,
        enabled: current.enabled,
        approval: 'always',
        approvedDefinitionHash: hash,
      }])
    } catch (exception) {
      input.logger.set({
        attributes: {
          toolApproval: {
            grant: 'failed',
            error: exceptionMessage(exception),
          },
        },
      })
    }
  }
}

export function connectorAuditApprovalOf(
  remember: ToolApprovalRemember,
): ConnectorAuditApproval {
  return remember
}

function hasExecute(tool: unknown): tool is {
  execute: (input: unknown, options?: { toolCallId?: string }) => unknown
} {
  return isRecord(tool) && typeof tool.execute === 'function'
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return typeof value === 'object'
    && value !== null
    && Symbol.asyncIterator in value
}

export interface ClaimHeartbeats {
  stop: (approvalId: string) => void
  stopAll: () => void
}

/**
 * One `touchClaim` heartbeat per claimed approval, started right after the
 * claims are taken, so a slow setup or a long call never lets a live claim
 * lapse into "interrupted". Each is stopped once its call's result is fully
 * produced; whatever is left stops when the request ends. Bindings are
 * captured up front because the heartbeats run from timers.
 */
export function startClaimHeartbeats(input: {
  db: DbClient
  owner: ToolApprovalClaimOwner
  approvalIds: readonly string[]
  logger: LoggerLike
}): ClaimHeartbeats {
  const { db, owner, logger } = input
  const timers = new Map<string, ReturnType<typeof setInterval>>()

  for (const approvalId of input.approvalIds) {
    timers.set(approvalId, setInterval(async () => {
      try {
        await touchClaim(db, approvalId, owner.userId)
      } catch (exception) {
        logger.set({
          attributes: {
            toolApproval: {
              heartbeat: 'failed',
              error: exceptionMessage(exception),
            },
          },
        })
      }
    }, TOOL_APPROVAL_CLAIM_HEARTBEAT_MS))
  }

  function stop(approvalId: string): void {
    const timer = timers.get(approvalId)

    if (timer !== undefined) {
      clearInterval(timer)
      timers.delete(approvalId)
    }
  }

  return {
    stop,
    stopAll: () => {
      for (const approvalId of [...timers.keys()]) {
        stop(approvalId)
      }
    },
  }
}

/**
 * Wraps the `execute` of every tool an approved call uses, for that call
 * only: once its result is fully produced (for a tool that streams its
 * output, once the stream is consumed), the claim is marked done (failed
 * when it threw), its heartbeat stops and the approval is used up
 * (`onSettled`), all before the SDK starts the next model turn. The output
 * itself is never stored. A failed claim write is logged and never changes
 * the call's result.
 */
export function wrapApprovedExecutions(input: {
  tools: ToolSet | undefined
  decisions: readonly ContinuationDecision[]
  db: DbClient
  owner: ToolApprovalClaimOwner
  heartbeats: ClaimHeartbeats
  onSettled: (toolCallId: string) => void
  logger: LoggerLike
}): ToolSet | undefined {
  const approvedByCallId = new Map(input.decisions
    .filter(decision => decision.approved)
    .map(decision => [decision.toolCallId, decision]))

  if (!input.tools || approvedByCallId.size === 0) {
    return input.tools
  }

  const toolNames = new Set([...approvedByCallId.values()].map((decision) => {
    return decision.toolName
  }))
  const { db, owner, heartbeats, logger } = input

  async function settle(
    decision: ContinuationDecision,
    isError: boolean,
  ): Promise<void> {
    heartbeats.stop(decision.approvalId)
    input.onSettled(decision.toolCallId)

    try {
      if (isError) {
        await markClaimFailed(db, decision.approvalId, owner.userId)
      } else {
        await markClaimDone(db, decision.approvalId, owner.userId)
      }
    } catch (exception) {
      logger.set({
        attributes: {
          toolApproval: {
            claimFinish: 'failed',
            error: exceptionMessage(exception),
          },
        },
      })
    }
  }

  async function settleWhenResolved(
    decision: ContinuationDecision,
    result: unknown,
  ): Promise<unknown> {
    let output: unknown

    try {
      output = await result
    } catch (exception) {
      await settle(decision, true)

      throw exception
    }

    await settle(decision, false)

    return output
  }

  async function* settleAfterConsumption(
    decision: ContinuationDecision,
    output: AsyncIterable<unknown>,
  ): AsyncGenerator<unknown> {
    try {
      yield* output
    } catch (exception) {
      await settle(decision, true)

      throw exception
    }

    await settle(decision, false)
  }

  return Object.fromEntries(Object.entries(input.tools).map(([name, tool]) => {
    if (!toolNames.has(name) || !hasExecute(tool)) {
      return [name, tool]
    }

    const execute = tool.execute.bind(tool)

    return [name, {
      ...tool,
      execute: (
        toolInput: unknown,
        options?: { toolCallId?: string },
      ) => {
        const decision = options?.toolCallId
          ? approvedByCallId.get(options.toolCallId)
          : undefined

        if (!decision) {
          return execute(toolInput, options)
        }

        approvedByCallId.delete(decision.toolCallId)

        let result: unknown

        try {
          result = execute(toolInput, options)
        } catch (exception) {
          return settle(decision, true).then(() => {
            throw exception
          })
        }

        if (isAsyncIterable(result)) {
          return settleAfterConsumption(decision, result)
        }

        return settleWhenResolved(decision, result)
      },
    } as ToolSet[string]]
  }))
}

import type { ToolApprovalStatus, ToolSet, UIMessageChunk } from 'ai'
import { isWebSearchTool } from '#shared/utils/message-metadata'
import {
  TOOL_APPROVAL_DATA_PART_TYPE,
  hasAwaitingApprovalToolPart,
} from '#shared/utils/tool-approval-parts'
import type { ToolApprovalPartData } from '#shared/utils/tool-approval-parts'
import {
  TOOL_APPROVAL_MEMORY_WRITE_TOOL_NAMES,
  TOOL_APPROVAL_PAYLOAD_MAX_BYTES,
  TOOL_APPROVAL_PENDING_PER_MESSAGE,
  TOOL_APPROVAL_RECORD_VERSION,
  TOOL_APPROVAL_SUMMARY_MAX_LENGTH,
} from '#shared/utils/tool-approval-policy'
import type {
  ToolAccess,
  ToolApprovalDenialReason,
  ToolApprovalTaintKind,
} from '#shared/utils/tool-approval-policy'
import { isSkillToolName } from '#shared/utils/skills/runtime'
import { isChatSearchToolName } from '~~/server/utils/ai/chat-search-tools'
import { isProjectKnowledgeToolName } from '~~/server/utils/ai/knowledge-tools'
import { isMemoryToolName } from '~~/server/utils/ai/memory-tools'
import { isArtifactToolName } from '~~/server/utils/artifacts/message-parts'
import { isDocumentToolName } from '~~/server/utils/documents/message-parts'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  putToolApproval,
  putToolApprovalTurn,
} from '~~/server/utils/tool-approval/kv'
import type { ToolApprovalPendingSnapshot } from '~~/server/utils/tool-approval/kv'
import {
  connectorDestructiveHint,
  resolveToolApproval,
} from '~~/server/utils/tool-approval/policy'
import type {
  DestructiveHintAnnotations,
  ToolApprovalDecision,
  ToolApprovalDescriptor,
  ToolApprovalGrant,
} from '~~/server/utils/tool-approval/policy'
import {
  connectorReadSource,
  incrementCounter,
  recordRead,
  recordTaint,
  serializeApprovalState,
} from '~~/server/utils/tool-approval/state'
import type { ApprovalState } from '~~/server/utils/tool-approval/state'

type KvNamespace = Parameters<typeof putToolApproval>[0]

const TEXT_ENCODER = new TextEncoder()

const NATIVE_TOOL_SUMMARIES: Record<string, string> = {
  memory_write: 'Besidka wants to save a memory',
  memory_forget: 'Besidka wants to forget a memory',
  create_artifact: 'Besidka wants to create an artifact',
  update_artifact: 'Besidka wants to update an artifact',
  create_document: 'Besidka wants to create a document',
}

const PROVIDER_WEB_SEARCH_TOOL_NAMES = new Set<string>([
  'web_search_preview',
])

/**
 * Everything the send knows about one tool the model can call, keyed by the
 * name the model sees. `taint` and `readSource` are what a call that runs
 * adds to the send's approval state. `alwaysGrant` is a grant the send
 * applies without the user setting one (see `buildConnectorApprovalEntry`).
 */
export interface SendToolEntry {
  descriptor: ToolApprovalDescriptor
  summary: string
  taint: ToolApprovalTaintKind | null
  readSource: string | null
  alwaysGrant: ToolApprovalGrant | null
  connector: {
    id: string
    host: string
    remoteToolName: string
  } | null
}

export interface PendingToolApprovalDecision {
  toolName: string
  entry: SendToolEntry
  decision: ToolApprovalDecision
}

export interface ToolApprovalCall {
  toolCallId: string
  toolName: string
  input: unknown
  providerExecuted?: boolean
}

export interface SendToolApproval {
  state: ApprovalState
  entries: Map<string, SendToolEntry>
  toolApproval: (options: { toolCall: ToolApprovalCall }) => ToolApprovalStatus
  registerTools: (
    tools: ToolSet | undefined,
    extraEntries?: ReadonlyMap<string, SendToolEntry>,
  ) => void
  canAsk: () => boolean
  isCallCleared: (toolCallId: string | undefined) => boolean
  markApprovedByUser: (toolCallId: string) => void
  isApprovedByUser: (toolCallId: string | undefined) => boolean
  getPendingDecision: (
    toolCallId: string,
  ) => PendingToolApprovalDecision | undefined
}

interface NativeToolClass {
  access: ToolAccess
  writesMemory: boolean
  taint: ToolApprovalTaintKind | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProviderTool(tool: unknown): boolean {
  return isRecord(tool) && tool.type === 'provider'
}

function payloadBytes(value: unknown): number {
  const serialized = JSON.stringify(value)

  return serialized === undefined
    ? 0
    : TEXT_ENCODER.encode(serialized).byteLength
}

function clampSummary(summary: string): string {
  return summary.slice(0, TOOL_APPROVAL_SUMMARY_MAX_LENGTH)
}

/**
 * How a native tool counts for the approval policy. Memory writes, artifact
 * and document writes are writes; the lookups are reads, and each records
 * the taint its result brings (web pages, other chats or project knowledge,
 * skill text). A tool this list does not know is a write, so a new native
 * tool asks after connector or skill output until it is classified here.
 */
export function classifyNativeTool(
  toolName: string,
  tool?: unknown,
): NativeToolClass {
  if (
    (TOOL_APPROVAL_MEMORY_WRITE_TOOL_NAMES as readonly string[])
      .includes(toolName)
  ) {
    return { access: 'write', writesMemory: true, taint: null }
  }

  if (isArtifactToolName(toolName) || isDocumentToolName(toolName)) {
    return { access: 'write', writesMemory: false, taint: null }
  }

  if (
    isWebSearchTool(toolName)
    || PROVIDER_WEB_SEARCH_TOOL_NAMES.has(toolName)
  ) {
    return { access: 'read', writesMemory: false, taint: 'web' }
  }

  if (isMemoryToolName(toolName)) {
    return { access: 'read', writesMemory: false, taint: null }
  }

  if (isChatSearchToolName(toolName) || isProjectKnowledgeToolName(toolName)) {
    return { access: 'read', writesMemory: false, taint: 'knowledge' }
  }

  if (isSkillToolName(toolName)) {
    return { access: 'read', writesMemory: false, taint: 'skill' }
  }

  if (toolName === 'generate_image' || isProviderTool(tool)) {
    return { access: 'read', writesMemory: false, taint: null }
  }

  return { access: 'write', writesMemory: false, taint: null }
}

export function buildNativeApprovalEntry(
  toolName: string,
  tool?: unknown,
): SendToolEntry {
  const nativeClass = classifyNativeTool(toolName, tool)

  return {
    descriptor: {
      family: 'native',
      access: nativeClass.access,
      toolName,
      destructiveHint: false,
      ...(nativeClass.writesMemory ? { writesMemory: true } : {}),
    },
    summary: clampSummary(
      NATIVE_TOOL_SUMMARIES[toolName] ?? `Besidka wants to run ${toolName}`,
    ),
    taint: nativeClass.taint,
    readSource: null,
    alwaysGrant: null,
    connector: null,
  }
}

/**
 * The entry of one exposed connector tool. The policy name is the exposed
 * name (`mcp__<slug>__<tool>`), because that is the name the SDK signs; the
 * remote name stays on the entry for the audit row. A tool the server marks
 * read-only and not destructive gets a grant bound to its connector, name
 * and definition hash, so it keeps running without a request as it did in
 * C-5 (rule 6), while F2 (rule 3) still asks for it after another source was
 * read. This stands in for the per-tool review of C-7. A tool marked both
 * read-only and destructive counts as destructive.
 */
export function buildConnectorApprovalEntry(input: {
  exposedName: string
  connectorId: string
  connectorTitle: string
  connectorHost: string
  remoteToolName: string
  definitionHash: string
  annotations: DestructiveHintAnnotations
}): SendToolEntry {
  const { annotations } = input
  const isAutoRunnable = annotations.readOnlyHint === true
    && annotations.destructiveHint !== true

  return {
    descriptor: {
      family: 'connector',
      access: isAutoRunnable ? 'read' : 'write',
      toolName: input.exposedName,
      connectorId: input.connectorId,
      definitionHash: input.definitionHash,
      destructiveHint: connectorDestructiveHint(annotations)
        || annotations.destructiveHint === true,
    },
    summary: clampSummary(
      `${input.connectorTitle} wants to run ${input.remoteToolName}`,
    ),
    taint: 'connector',
    readSource: connectorReadSource(input.connectorId),
    alwaysGrant: isAutoRunnable
      ? {
        definitionHash: input.definitionHash,
        connectorId: input.connectorId,
        toolName: input.exposedName,
      }
      : null,
    connector: {
      id: input.connectorId,
      host: input.connectorHost,
      remoteToolName: input.remoteToolName,
    },
  }
}

function denied(reason: ToolApprovalDenialReason): ToolApprovalStatus {
  return { type: 'denied', reason }
}

/**
 * The approval wiring of one chat send: the per-send `ApprovalState`, the
 * entry of every tool the model can call, and the generic `toolApproval`
 * function `streamText` calls once per tool call, in stream order, before
 * any call of the step runs.
 *
 * A call the policy lets run is cleared for `execute` (connector tools
 * refuse any call that is not cleared), and the taint and read source its
 * result brings are recorded right away, so a later call in the same step
 * is decided with them (a connector read next to an artifact write asks).
 * A call that needs approval is kept by its tool call id until the stream
 * pairs it with the SDK's approval id. A call the user approved is marked
 * with `markApprovedByUser` (the continuation, L5, does this before the SDK
 * replays it); it is cleared for `execute` and lifts the memory write lock
 * for that call only (`isApprovedByUser`). Calls the provider runs itself are
 * never gated; a web search among them taints the send. A tool with no
 * entry is denied, and so is a call that would need approval but has an
 * input over the KV payload cap or comes past the per-message cap, so a
 * pause never holds a call Besidka cannot store. A call that may run is
 * never held to the payload cap.
 */
export function createSendToolApproval(input: {
  state: ApprovalState
}): SendToolApproval {
  const { state } = input
  const entries = new Map<string, SendToolEntry>()
  const clearedCallIds = new Set<string>()
  const approvedCallIds = new Set<string>()
  const pendingDecisions = new Map<string, PendingToolApprovalDecision>()

  function recordRun(entry: SendToolEntry): void {
    if (entry.taint) {
      recordTaint(state, entry.taint)
    }

    if (entry.readSource) {
      recordRead(state, entry.readSource)
    }

    if (entry.descriptor.family === 'connector') {
      incrementCounter(state, 'connectorCalls')
    }
  }

  function toolApproval(
    options: { toolCall: ToolApprovalCall },
  ): ToolApprovalStatus {
    const { toolCall } = options
    const entry = entries.get(toolCall.toolName)

    if (toolCall.providerExecuted === true) {
      const taint = entry ? entry.taint : 'web'

      if (taint) {
        recordTaint(state, taint)
      }

      return 'not-applicable'
    }

    if (!entry) {
      return denied('missing-tool')
    }

    const decision = resolveToolApproval({
      descriptor: entry.descriptor,
      state,
      permissionMode: 'ask',
      alwaysGrant: entry.alwaysGrant,
    })

    if (decision.status.type === 'denied') {
      return denied(decision.status.reason)
    }

    if (decision.status.type === 'not-applicable') {
      clearedCallIds.add(toolCall.toolCallId)
      recordRun(entry)

      return 'not-applicable'
    }

    if (
      pendingDecisions.size >= TOOL_APPROVAL_PENDING_PER_MESSAGE
      || payloadBytes(toolCall.input) > TOOL_APPROVAL_PAYLOAD_MAX_BYTES
    ) {
      return denied('over-cap')
    }

    pendingDecisions.set(toolCall.toolCallId, {
      toolName: toolCall.toolName,
      entry,
      decision,
    })

    return { type: 'user-approval', reason: decision.status.reason }
  }

  function registerTools(
    tools: ToolSet | undefined,
    extraEntries?: ReadonlyMap<string, SendToolEntry>,
  ): void {
    for (const [toolName, entry] of extraEntries ?? []) {
      entries.set(toolName, entry)
    }

    for (const [toolName, tool] of Object.entries(tools ?? {})) {
      if (!entries.has(toolName)) {
        entries.set(toolName, buildNativeApprovalEntry(toolName, tool))
      }
    }
  }

  function canAsk(): boolean {
    return [...entries.values()].some((entry) => {
      return entry.descriptor.family !== 'native'
        || entry.descriptor.access !== 'read'
    })
  }

  return {
    state,
    entries,
    toolApproval,
    registerTools,
    canAsk,
    isCallCleared: (toolCallId) => {
      return typeof toolCallId === 'string'
        && (clearedCallIds.has(toolCallId) || approvedCallIds.has(toolCallId))
    },
    markApprovedByUser: (toolCallId) => {
      approvedCallIds.add(toolCallId)
    },
    isApprovedByUser: (toolCallId) => {
      return typeof toolCallId === 'string' && approvedCallIds.has(toolCallId)
    },
    getPendingDecision: toolCallId => pendingDecisions.get(toolCallId),
  }
}

/**
 * Records, before the first model step, the untrusted content the send
 * already puts in front of the model, with the same triggers as the memory
 * write lock (`presetMemoryWriteLock`) plus a chat branched from a public
 * share.
 */
export function presetApprovalTaint(
  state: ApprovalState,
  send: {
    requestedTools: readonly unknown[]
    holdsUntrustedKnowledge: boolean
    holdsArtifactContext: boolean
    holdsSkillText: boolean
    holdsPastChatExcerpts: boolean
    isBranchedFromShare: boolean
  },
): void {
  if (send.requestedTools.some(isWebSearchTool)) {
    recordTaint(state, 'web')
  }

  if (send.holdsUntrustedKnowledge || send.holdsPastChatExcerpts) {
    recordTaint(state, 'knowledge')
  }

  if (send.holdsArtifactContext) {
    recordTaint(state, 'file')
  }

  if (send.holdsSkillText) {
    recordTaint(state, 'skill')
  }

  if (send.isBranchedFromShare) {
    recordTaint(state, 'shared-branch')
  }
}

export interface CollectedToolApproval {
  approvalId: string
  toolCallId: string
  toolName: string
  input: unknown
  signature: string
  pending: PendingToolApprovalDecision
}

export interface ToolApprovalStreamCollector {
  apply: (
    stream: ReadableStream<UIMessageChunk>,
  ) => ReadableStream<UIMessageChunk>
  getCollected: () => CollectedToolApproval[]
  getStepCount: () => number
  isPaused: () => boolean
}

/**
 * Watches the UI message stream of a send for approval requests. Each
 * request the user has to answer loses its signature (the signed input is
 * kept only in KV, never in the client or in D1) and gets a
 * `data-tool-approval` part right after it, with the reason, the
 * server-written summary and the remember options the policy allows. The
 * requests are collected for the KV records written once the reply is
 * stored. Automatic requests (a policy denial) lose their signature too
 * and are neither collected nor counted as a pause.
 */
export function createToolApprovalStreamCollector(
  approval: SendToolApproval,
): ToolApprovalStreamCollector {
  const inputs = new Map<string, { toolName: string, input: unknown }>()
  const collected: CollectedToolApproval[] = []
  let stepCount = 0
  let isPaused = false

  function apply(
    stream: ReadableStream<UIMessageChunk>,
  ): ReadableStream<UIMessageChunk> {
    return stream.pipeThrough(new TransformStream<
      UIMessageChunk,
      UIMessageChunk
    >({
      transform(chunk, controller) {
        if (chunk.type === 'tool-input-available') {
          inputs.set(chunk.toolCallId, {
            toolName: chunk.toolName,
            input: chunk.input,
          })
        }

        if (chunk.type === 'finish-step') {
          stepCount += 1
        }

        if (chunk.type !== 'tool-approval-request') {
          controller.enqueue(chunk)

          return
        }

        const { signature, ...unsignedChunk } = chunk

        controller.enqueue(unsignedChunk)

        if (chunk.isAutomatic) {
          return
        }

        isPaused = true

        const call = inputs.get(chunk.toolCallId)
        const pending = approval.getPendingDecision(chunk.toolCallId)

        if (!call || !pending || typeof signature !== 'string') {
          return
        }

        collected.push({
          approvalId: chunk.approvalId,
          toolCallId: chunk.toolCallId,
          toolName: call.toolName,
          input: call.input,
          signature,
          pending,
        })

        const data: ToolApprovalPartData = {
          approvalId: chunk.approvalId,
          toolCallId: chunk.toolCallId,
          toolName: call.toolName,
          reason: pending.decision.reason ?? 'default',
          summary: pending.entry.summary,
          rememberOptions: [...pending.decision.rememberOptions],
        }

        controller.enqueue({
          type: TOOL_APPROVAL_DATA_PART_TYPE,
          id: chunk.toolCallId,
          data,
        })
      },
    }))
  }

  return {
    apply,
    getCollected: () => [...collected],
    getStepCount: () => stepCount,
    isPaused: () => isPaused,
  }
}

export interface RecordToolApprovalPauseInput {
  kv: KvNamespace
  userId: number
  chatPublicId: string
  messagePublicId: string
  approval: SendToolApproval
  collected: readonly CollectedToolApproval[]
  stepCount: number
  snapshot: ToolApprovalPendingSnapshot
  auditPending: (
    approval: CollectedToolApproval,
  ) => Promise<number | null>
  logger: LoggerLike
}

/**
 * Stores what the continuation needs once the paused reply is persisted:
 * one pending record per approval (exact input and signature, the policy
 * reason and remember options, the summary, a snapshot of the send) and
 * one turn record with the pending ids and the serialized approval state,
 * both listed in the per-chat index. A connector call also gets a `pending`
 * audit row first, and its id goes into the record so the answer can settle
 * that row. Writes are sequential (one KV connection at a time). A record
 * that fails is logged and skipped; the continuation then answers that the
 * approval expired.
 */
export async function recordToolApprovalPause(
  input: RecordToolApprovalPauseInput,
): Promise<{ written: number }> {
  const pendingApprovalIds: string[] = []

  for (const collected of input.collected) {
    const { entry, decision } = collected.pending

    try {
      const auditCallId = entry.connector
        ? await input.auditPending(collected)
        : null

      await putToolApproval(input.kv, collected.approvalId, {
        version: TOOL_APPROVAL_RECORD_VERSION,
        userId: input.userId,
        chatPublicId: input.chatPublicId,
        messagePublicId: input.messagePublicId,
        toolCallId: collected.toolCallId,
        family: entry.descriptor.family,
        access: entry.descriptor.access,
        toolName: collected.toolName,
        connectorId: entry.descriptor.connectorId ?? null,
        definitionHash: entry.descriptor.definitionHash ?? null,
        input: collected.input,
        signature: collected.signature,
        reason: decision.reason ?? 'default',
        rememberOptions: [...decision.rememberOptions],
        summary: entry.summary,
        auditCallId,
        snapshot: input.snapshot,
      })
      pendingApprovalIds.push(collected.approvalId)
    } catch (exception) {
      input.logger.set({
        attributes: {
          toolApproval: {
            pendingWrite: 'failed',
            error: exceptionMessage(exception),
          },
        },
      })
    }
  }

  if (pendingApprovalIds.length === 0) {
    return { written: 0 }
  }

  incrementCounter(input.approval.state, 'rounds')
  incrementCounter(input.approval.state, 'steps', input.stepCount)

  await putToolApprovalTurn(input.kv, input.messagePublicId, {
    version: TOOL_APPROVAL_RECORD_VERSION,
    userId: input.userId,
    chatPublicId: input.chatPublicId,
    messagePublicId: input.messagePublicId,
    pendingApprovalIds,
    state: serializeApprovalState(input.approval.state),
  })

  return { written: pendingApprovalIds.length }
}

/**
 * Whether any stored message of the chat still holds a call that waits for
 * approval, so a new user message has pending records to expire.
 */
export function chatHasAwaitingApproval(
  messages: ReadonlyArray<{ parts: unknown }>,
): boolean {
  return messages.some(message => hasAwaitingApprovalToolPart(message.parts))
}

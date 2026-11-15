import type { ToolApprovalStatus, ToolSet, UIMessageChunk } from 'ai'
import { createError } from 'evlog'
import { CONNECTOR_UNAPPROVED_CALL_TEXT } from '#shared/utils/connectors-parts'
import { isWebSearchTool } from '#shared/utils/message-metadata'
import {
  TOOL_APPROVAL_DATA_PART_TYPE,
  hasAwaitingApprovalToolPart,
} from '#shared/utils/tool-approval-parts'
import type { ToolApprovalPartData } from '#shared/utils/tool-approval-parts'
import {
  TOOL_APPROVAL_BESIDKA_READ_SOURCE,
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
import { canonicalJson } from '~~/server/utils/connectors/tool-definitions'
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

const PROVIDER_READ_TOOL_NAMES = new Set<string>([
  'web_search_preview',
  'web_search',
  'google_search',
  'url_context',
])

/**
 * Everything the send knows about one tool the model can call, keyed by the
 * name the model sees. `taint` and `readSource` are what a call that runs
 * adds to the send's approval state. `alwaysGrant` is a grant the send
 * applies without the user setting one (see `buildConnectorApprovalEntry`);
 * it holds after untrusted content only when `alwaysGrantWhenTainted` is set.
 */
export interface SendToolEntry {
  descriptor: ToolApprovalDescriptor
  summary: string
  taint: ToolApprovalTaintKind | null
  readSource: string | null
  alwaysGrant: ToolApprovalGrant | null
  alwaysGrantWhenTainted: boolean
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

export interface ClearedCallCheck {
  toolCallId: string | undefined
  toolName: string
  input: unknown
}

export interface SendToolApproval {
  state: ApprovalState
  entries: Map<string, SendToolEntry>
  toolApproval: (options: { toolCall: ToolApprovalCall }) => ToolApprovalStatus
  registerTools: (
    tools: ToolSet | undefined,
    extraEntries?: ReadonlyMap<string, SendToolEntry>,
  ) => void
  guardNativeWrites: (tools: ToolSet | undefined) => ToolSet | undefined
  canAsk: () => boolean
  consumeClearedCall: (call: ClearedCallCheck) => boolean
  markApprovedByUser: (call: Omit<ClearedCallCheck, 'toolCallId'> & {
    toolCallId: string
  }) => void
  isApprovedByUser: (toolCallId: string | undefined) => boolean
  getPendingDecision: (
    toolCallId: string,
  ) => PendingToolApprovalDecision | undefined
}

interface NativeToolClass {
  access: ToolAccess
  writesMemory: boolean
  onlyConnectorOrSkillTaint: boolean
  readsPrivateData: boolean
  taint: ToolApprovalTaintKind | null
}

const NATIVE_WRITE: NativeToolClass = {
  access: 'write',
  writesMemory: false,
  onlyConnectorOrSkillTaint: false,
  readsPrivateData: false,
  taint: null,
}

const NATIVE_READ: NativeToolClass = {
  ...NATIVE_WRITE,
  access: 'read',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProviderTool(tool: unknown): boolean {
  return isRecord(tool) && tool.type === 'provider'
}

function hasExecute(tool: unknown): tool is {
  execute: (input: unknown, options?: { toolCallId?: string }) => unknown
} {
  return isRecord(tool) && typeof tool.execute === 'function'
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
 * How a native tool counts for the approval policy. Memory writes are writes
 * that count every taint; artifact and document writes are writes that count
 * only connector and skill taint. The lookups are reads, and each records the
 * taint its result brings (web pages, other chats or project knowledge,
 * skill text); the ones that read the user's own data (chats, memory,
 * project knowledge) also record the Besidka read source, so a later
 * connector call asks `cross-source`. Provider tools other than the web
 * search, grounding and URL context family, and any tool this list does not
 * know, are writes that count every taint: they fail closed until they are
 * classified here.
 */
export function classifyNativeTool(toolName: string): NativeToolClass {
  if (
    (TOOL_APPROVAL_MEMORY_WRITE_TOOL_NAMES as readonly string[])
      .includes(toolName)
  ) {
    return { ...NATIVE_WRITE, writesMemory: true }
  }

  if (isArtifactToolName(toolName) || isDocumentToolName(toolName)) {
    return { ...NATIVE_WRITE, onlyConnectorOrSkillTaint: true }
  }

  if (isWebSearchTool(toolName) || PROVIDER_READ_TOOL_NAMES.has(toolName)) {
    return { ...NATIVE_READ, taint: 'web' }
  }

  if (isMemoryToolName(toolName)) {
    return { ...NATIVE_READ, readsPrivateData: true }
  }

  if (isChatSearchToolName(toolName) || isProjectKnowledgeToolName(toolName)) {
    return { ...NATIVE_READ, readsPrivateData: true, taint: 'knowledge' }
  }

  if (isSkillToolName(toolName)) {
    return { ...NATIVE_READ, taint: 'skill' }
  }

  if (toolName === 'generate_image') {
    return NATIVE_READ
  }

  return NATIVE_WRITE
}

export function buildNativeApprovalEntry(toolName: string): SendToolEntry {
  const nativeClass = classifyNativeTool(toolName)

  return {
    descriptor: {
      family: 'native',
      access: nativeClass.access,
      toolName,
      destructiveHint: false,
      ...(nativeClass.writesMemory ? { writesMemory: true } : {}),
      ...(nativeClass.onlyConnectorOrSkillTaint
        ? { onlyConnectorOrSkillTaint: true }
        : {}),
    },
    summary: clampSummary(
      NATIVE_TOOL_SUMMARIES[toolName] ?? `Besidka wants to run ${toolName}`,
    ),
    taint: nativeClass.taint,
    readSource: nativeClass.readsPrivateData
      ? TOOL_APPROVAL_BESIDKA_READ_SOURCE
      : null,
    alwaysGrant: null,
    alwaysGrantWhenTainted: false,
    connector: null,
  }
}

/**
 * The entry of one exposed connector tool. The policy name is the exposed
 * name (`mcp__<slug>__<tool>`), because that is the name the SDK signs; the
 * remote name stays on the entry for the audit row, and the summary names
 * the exposed name, never text the remote server chose. A tool the server
 * marks read-only and not destructive gets a grant bound to its connector,
 * name and definition hash, so it keeps running without a request as it did
 * in C-5 (rule 6), while F2 (rule 3) still asks for it after another source
 * was read. The grant holds after untrusted content only when the server
 * also marks the tool `openWorldHint: false`; otherwise the call asks
 * `untrusted-output`, because an open-world read can carry data out. This
 * stands in for the per-tool review of C-7. A tool marked both read-only and
 * destructive counts as destructive.
 */
export function buildConnectorApprovalEntry(input: {
  exposedName: string
  connectorId: string
  connectorTitle: string
  connectorHost: string
  remoteToolName: string
  definitionHash: string
  annotations: DestructiveHintAnnotations & { openWorldHint?: boolean | null }
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
      `${input.connectorTitle} wants to run ${input.exposedName}`,
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
    alwaysGrantWhenTainted: annotations.openWorldHint === false,
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

const UNTRUSTED_OUTPUT_DECISION: ToolApprovalDecision = {
  status: { type: 'user-approval', reason: 'untrusted-output' },
  reason: 'untrusted-output',
  rememberOptions: ['once'],
  rule: 2,
}

interface ClearedCall {
  toolName: string
  inputJson: string
}

function toInputJson(input: unknown): string {
  return canonicalJson(input ?? {})
}

/**
 * The approval wiring of one chat send: the per-send `ApprovalState`, the
 * entry of every tool the model can call, and the generic `toolApproval`
 * function `streamText` calls once per tool call, in stream order, before
 * any call of the step runs.
 *
 * A call the policy lets run is cleared for `execute`, bound to its tool
 * name and canonical input and used up by the first `execute` that checks
 * it (connector tools and the native writes `guardNativeWrites` wraps refuse
 * any call that is not cleared), and the taint and read source its
 * result brings are recorded right away, so a later call in the same step
 * is decided with them (a connector read next to an artifact write asks).
 * A call that needs approval is kept by its tool call id until the stream
 * pairs it with the SDK's approval id. A call the user approved is marked
 * with `markApprovedByUser` (the continuation, L5, does this before the SDK
 * replays it); it is cleared for `execute` and lifts the memory write lock
 * for that call only (`isApprovedByUser`). A call the provider runs itself is
 * not gated when it belongs to the web search family, which taints the
 * send; any other provider-executed call goes through the policy as a write.
 * A tool with no
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
  const clearedCalls = new Map<string, ClearedCall>()
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

    if (!entry) {
      return denied('missing-tool')
    }

    if (
      toolCall.providerExecuted === true
      && entry.descriptor.access === 'read'
    ) {
      if (entry.taint) {
        recordTaint(state, entry.taint)
      }

      return 'not-applicable'
    }

    const isGrantUsable = state.taint.size === 0
      || entry.alwaysGrantWhenTainted
    const resolved = resolveToolApproval({
      descriptor: entry.descriptor,
      state,
      permissionMode: 'ask',
      alwaysGrant: isGrantUsable ? entry.alwaysGrant : null,
    })
    const decision = entry.alwaysGrant
      && !isGrantUsable
      && resolved.reason === 'default'
      ? UNTRUSTED_OUTPUT_DECISION
      : resolved

    if (decision.status.type === 'denied') {
      return denied(decision.status.reason)
    }

    if (decision.status.type === 'not-applicable') {
      if (toolCall.providerExecuted !== true) {
        clearedCalls.set(toolCall.toolCallId, {
          toolName: toolCall.toolName,
          inputJson: toInputJson(toolCall.input),
        })
      }

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

    for (const toolName of Object.keys(tools ?? {})) {
      if (!entries.has(toolName)) {
        entries.set(toolName, buildNativeApprovalEntry(toolName))
      }
    }
  }

  function consumeClearedCall(call: ClearedCallCheck): boolean {
    if (typeof call.toolCallId !== 'string') {
      return false
    }

    const cleared = clearedCalls.get(call.toolCallId)

    if (
      !cleared
      || cleared.toolName !== call.toolName
      || cleared.inputJson !== toInputJson(call.input)
    ) {
      return false
    }

    clearedCalls.delete(call.toolCallId)

    return true
  }

  /**
   * Wraps the `execute` of every native write except the memory tools
   * (which keep their own lock) so it only runs a call the policy cleared,
   * with the same name and input, once. A second line behind the SDK, which
   * never calls `execute` for a call that waits for approval.
   */
  function guardNativeWrites(
    tools: ToolSet | undefined,
  ): ToolSet | undefined {
    if (!tools) {
      return tools
    }

    return Object.fromEntries(Object.entries(tools).map(([toolName, tool]) => {
      const entry = entries.get(toolName)

      if (
        !entry
        || entry.descriptor.family !== 'native'
        || entry.descriptor.access === 'read'
        || entry.descriptor.writesMemory === true
        || isProviderTool(tool)
        || !hasExecute(tool)
      ) {
        return [toolName, tool]
      }

      const execute = tool.execute.bind(tool)

      return [toolName, {
        ...tool,
        execute: (input: unknown, options?: { toolCallId?: string }) => {
          if (!consumeClearedCall({
            toolCallId: options?.toolCallId,
            toolName,
            input,
          })) {
            throw createError({
              message: CONNECTOR_UNAPPROVED_CALL_TEXT,
              status: 403,
              why: 'The approval policy did not clear this call.',
              fix: 'Tell the user the action did not run.',
            })
          }

          return execute(input, options)
        },
      } as ToolSet[string]]
    }))
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
    guardNativeWrites,
    canAsk,
    consumeClearedCall,
    markApprovedByUser: (call) => {
      clearedCalls.set(call.toolCallId, {
        toolName: call.toolName,
        inputJson: toInputJson(call.input),
      })
      approvedCallIds.add(call.toolCallId)
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
    recordRead(state, TOOL_APPROVAL_BESIDKA_READ_SOURCE)
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
  settleFailedAudit: (auditCallId: number) => Promise<void>
  logger: LoggerLike
}

/**
 * Stores what the continuation needs once the paused reply is persisted:
 * one pending record per approval (exact input and signature, the policy
 * reason and remember options, the summary, a snapshot of the send) and
 * one turn record with the pending ids and the serialized approval state,
 * both listed in the per-chat index. A connector call also gets a `pending`
 * audit row first, and its id goes into the record so the answer can settle
 * that row; when the record cannot be stored, that row is settled as an
 * error right away. Writes are sequential (one KV connection at a time).
 * A record that fails is logged and skipped; the continuation then answers
 * that the approval expired.
 */
export async function recordToolApprovalPause(
  input: RecordToolApprovalPauseInput,
): Promise<{ written: number }> {
  const pendingApprovalIds: string[] = []

  for (const collected of input.collected) {
    const { entry, decision } = collected.pending
    let auditCallId: number | null = null

    try {
      auditCallId = entry.connector
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
      if (auditCallId !== null) {
        await input.settleFailedAudit(auditCallId)
      }

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

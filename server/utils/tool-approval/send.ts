import type {
  PrepareStepFunction,
  ToolApprovalStatus,
  ToolSet,
  UIMessageChunk,
} from 'ai'
import { createError } from 'evlog'
import { CONNECTOR_UNAPPROVED_CALL_TEXT } from '#shared/utils/connectors-parts'
import { isWebSearchTool } from '#shared/utils/message-metadata'
import { CODE_EXECUTION_TOOL_NAME } from '#shared/utils/code-execution'
import { isBesidkaChatToolName } from '#shared/utils/besidka-tool-permissions'
import {
  GOOGLE_TOOL_NAME_PREFIX,
  canOfferGoogleTools,
  googleToolReturnsContent,
  isGoogleToolName,
} from '#shared/utils/google-tool-approvals'
import type { GoogleToolKind } from '#shared/utils/google-tool-approvals'
import {
  TOOL_APPROVAL_DATA_PART_TYPE,
  TOOL_GRANT_DATA_PART_TYPE,
  hasAwaitingApprovalToolPart,
} from '#shared/utils/tool-approval-parts'
import type {
  ToolApprovalPartData,
  ToolGrantPartData,
  ToolGrantScope,
} from '#shared/utils/tool-approval-parts'
import {
  TOOL_APPROVAL_BESIDKA_READ_SOURCE,
  TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN,
  TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN,
  TOOL_APPROVAL_GOOGLE_READ_SOURCE,
  TOOL_APPROVAL_MEMORY_WRITE_TOOL_NAMES,
  TOOL_APPROVAL_PAYLOAD_MAX_BYTES,
  TOOL_APPROVAL_PENDING_PER_MESSAGE,
  TOOL_APPROVAL_PREVIEW_MAX_LENGTH,
  TOOL_APPROVAL_RECORD_VERSION,
  TOOL_APPROVAL_ROUNDS_PER_TURN,
  TOOL_APPROVAL_SUMMARY_MAX_LENGTH,
} from '#shared/utils/tool-approval-policy'
import type {
  ToolAccess,
  ToolApprovalDenialReason,
  ToolApprovalTaintKind,
  ToolPermissionMode,
} from '#shared/utils/tool-approval-policy'
import { isSkillToolName } from '#shared/utils/skills/runtime'
import { isToolIndexLoadToolName } from '#shared/utils/tool-index'
import { isChatSearchToolName } from '~~/server/utils/ai/chat-search-tools'
import { isProjectKnowledgeToolName } from '~~/server/utils/ai/knowledge-tools'
import { isMemoryToolName } from '~~/server/utils/ai/memory-tools'
import { isArtifactToolName } from '~~/server/utils/artifacts/message-parts'
import { isDocumentToolName } from '~~/server/utils/documents/message-parts'
import { canonicalJson } from '~~/server/utils/connectors/tool-definitions'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  indexToolApprovalChatRecords,
  isWellFormedToolApprovalId,
  putToolApproval,
  putToolApprovalResults,
  putToolApprovalTurn,
} from '~~/server/utils/tool-approval/kv'
import type {
  ToolApprovalPendingSnapshot,
  ToolApprovalResultRecord,
} from '~~/server/utils/tool-approval/kv'
import {
  connectorDestructiveHint,
  hasAlwaysAskToolName,
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
  recordToolRead,
  serializeApprovalState,
} from '~~/server/utils/tool-approval/state'
import type { ApprovalState } from '~~/server/utils/tool-approval/state'
import { SEND_TOOL_DENIAL_TEXT } from '~~/server/utils/tool-approval/denial-texts'
import type { SendToolDenialKind } from '~~/server/utils/tool-approval/denial-texts'

type KvNamespace = Parameters<typeof putToolApproval>[0]

const TEXT_ENCODER = new TextEncoder()

export const WEB_SEARCH_AFTER_PRIVATE_READ_TEXT = 'Web search is off for the '
  + 'rest of this message because it read the user\'s private data. Answer '
  + 'without searching.'

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
 * adds to the send's approval state. `userGrants` are the grants the user
 * gave ("Always allow", "Allow in this chat"), each carrying the definition
 * hash it was given for, so a changed tool no longer matches; since the
 * owner decision of 2026-11-20 they run the call before any rule about
 * outside content, a source switch or the always-ask tier.
 * `permissionMode` is the user's mode for a Besidka tool (Blocked, Needs
 * approval, Always allow); every other tool is decided as `ask`.
 * `summarize` writes the summary of one call from its input (a Besidka
 * tool's registry summarizer); without it every call shows `summary`.
 * `describe` writes a fuller summary with one lookup (the titles of the
 * chats a delete names), called once per pause before the summary is shown
 * or stored; null or a failure keeps `summarize`'s. `preview` is the text a
 * content write would store, shown with the approval.
 * `failsWithoutRunning` marks a call `execute` always refuses with a plain
 * error (a Besidka delete or move of the current chat): it is cleared
 * without a prompt, so the user is never asked for a call that cannot run.
 * `taintsRun` is for a Google tool that returns no Google content
 * (`taint` and `readSource` null): one lookup before `execute` says the
 * call names Google-derived data after all (a marked file), and the call
 * then taints the send like any Google call.
 */
export interface SendToolEntry {
  descriptor: ToolApprovalDescriptor
  summary: string
  summarize?: (input: unknown) => string
  describe?: (input: unknown) => Promise<string | null>
  taintsRun?: (input: unknown) => Promise<boolean>
  preview?: (input: unknown) => string | null
  failsWithoutRunning?: (input: unknown) => boolean
  permissionMode?: ToolPermissionMode
  taint: ToolApprovalTaintKind | null
  readSource: string | null
  userGrants?: SendToolUserGrants
  connector: {
    id: string
    host: string
    remoteToolName: string
  } | null
}

/**
 * `isAlwaysDefault` marks an `always` grant that is only the tool's default
 * (a plain connector read the user never set a mode for): it runs the call
 * like Always allow but writes no "Ran without asking" marker, as the C-5
 * read-only grant did.
 */
export interface SendToolUserGrants {
  always: ToolApprovalGrant | null
  chat: ToolApprovalGrant | null
  isAlwaysDefault?: boolean
  googleEgress?: ToolApprovalGrant | null
}

/**
 * The stored definition hashes of the user's grants for one connector tool:
 * `always` from `connector_tool_settings.approvedDefinitionHash` when that
 * row is set to `always`, `chat` from this chat's
 * `connector_chat_settings.alwaysAllowTools[exposedName]`, `googleEgress`
 * from the same map under `googleEgressGrantKey(exposedName)`.
 */
export interface ConnectorGrantHashes {
  always: string | null
  chat: string | null
  googleEgress?: string | null
}

export interface PendingToolApprovalDecision {
  toolName: string
  entry: SendToolEntry
  decision: ToolApprovalDecision
  summary: string
  preview: string | null
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

export type ApprovedCall = Omit<ClearedCallCheck, 'toolCallId'> & {
  toolCallId: string
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
  markApprovedByUser: (call: ApprovedCall) => void
  isApprovedByUser: (call: ClearedCallCheck) => boolean
  consumeApprovedCall: (toolCallId: string) => void
  getPendingDecision: (
    toolCallId: string,
  ) => PendingToolApprovalDecision | undefined
  getGrantScope: (toolCallId: string) => ToolGrantScope | null
  listWithheldProviderTools: (tools: ToolSet | undefined) => string[]
  recordConnectorOpened: (connectorId: string) => void
  getDenials: () => Partial<Record<SendToolDenialKind, number>>
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

/**
 * A web search Besidka runs itself (a function tool, not the provider's):
 * Brave, Exa, or any other tool the send classifies as a web read.
 */
function isOwnWebSearch(entry: SendToolEntry, tool: unknown): boolean {
  return entry.descriptor.family === 'native'
    && entry.taint === 'web'
    && !isProviderTool(tool)
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

function summarizeCall(entry: SendToolEntry, input: unknown): string {
  if (!entry.summarize) {
    return entry.summary
  }

  try {
    return clampSummary(entry.summarize(input)) || entry.summary
  } catch {
    return entry.summary
  }
}

function previewCall(entry: SendToolEntry, input: unknown): string | null {
  try {
    const preview = entry.preview?.(input)

    return preview ? preview.slice(0, TOOL_APPROVAL_PREVIEW_MAX_LENGTH) : null
  } catch {
    return null
  }
}

async function describeCall(
  pending: PendingToolApprovalDecision,
  input: unknown,
): Promise<void> {
  if (!pending.entry.describe) {
    return
  }

  try {
    const described = await pending.entry.describe(input)

    if (described) {
      pending.summary = clampSummary(described)
    }
  } catch {
    return
  }
}

/**
 * The entry of a `besidka__` tool the send did not describe: Blocked, so a
 * Besidka tool can never fall back to the native-write entry, which runs
 * without asking.
 */
function buildUndescribedBesidkaEntry(toolName: string): SendToolEntry {
  return {
    descriptor: {
      family: 'besidka',
      access: 'write',
      toolName,
      destructiveHint: true,
    },
    summary: clampSummary(`Besidka wants to run ${toolName}`),
    permissionMode: 'blocked',
    taint: 'besidka',
    readSource: TOOL_APPROVAL_BESIDKA_READ_SOURCE,
    connector: null,
  }
}

/**
 * The entry of a `google__` tool the send did not describe: a Google write
 * that asks with Allow once only, so a Google tool can never fall back to
 * the native-write entry, which runs without asking.
 */
function buildUndescribedGoogleEntry(toolName: string): SendToolEntry {
  return {
    descriptor: {
      family: 'google',
      access: 'write',
      toolName,
      destructiveHint: true,
    },
    summary: clampSummary(`Besidka wants to run ${toolName} on Google`),
    taint: 'google',
    readSource: TOOL_APPROVAL_GOOGLE_READ_SOURCE,
    connector: null,
  }
}

/**
 * The entry of one built-in Google tool (Drive, Calendar, Gmail), the only
 * way a Google tool joins a send. The exposed name must start with
 * `google__` (`GOOGLE_TOOL_NAME_PREFIX`), or registration is refused; a kind
 * other than `read` is a write. A read asks until the user allows it in
 * this chat (`chatGrantHash` from `readGoogleChatGrantHashes`), a write asks
 * every time with Allow once only (rule 11). Every call that runs records
 * `google` taint and the Google read source, which withholds web search for
 * the rest of the turn, makes native writes and connector calls ask and
 * locks memory writes. No `preview`: the approval part is stored in D1.
 */
export function buildGoogleApprovalEntry(input: {
  toolName: string
  kind: GoogleToolKind
  definitionHash: string
  summary: string
  toolApprovalsActive: boolean
  summarize?: (input: unknown) => string
  chatGrantHash?: string | null
  returnsGoogleContent?: boolean
  taintsRun?: (input: unknown) => Promise<boolean>
}): SendToolEntry {
  if (!canOfferGoogleTools(input)) {
    throw createError({
      message: 'Google tools need tool approvals',
      status: 500,
      why: 'A Google tool was registered in a send without tool approvals',
      fix: 'Offer Google tools only when canOfferGoogleTools is true',
    })
  }

  if (!isGoogleToolName(input.toolName)) {
    throw createError({
      message: 'Invalid Google tool name',
      status: 500,
      why: `A Google tool name must start with ${GOOGLE_TOOL_NAME_PREFIX}`,
    })
  }

  const isRead = input.kind === 'read'
  const returnsContent = input.returnsGoogleContent
    ?? googleToolReturnsContent(input.toolName)

  return {
    descriptor: {
      family: 'google',
      access: isRead ? 'read' : 'write',
      toolName: input.toolName,
      definitionHash: input.definitionHash,
      destructiveHint: !isRead,
    },
    summary: clampSummary(input.summary),
    ...(input.summarize ? { summarize: input.summarize } : {}),
    ...(!returnsContent && input.taintsRun
      ? { taintsRun: input.taintsRun }
      : {}),
    taint: returnsContent ? 'google' : null,
    readSource: returnsContent ? TOOL_APPROVAL_GOOGLE_READ_SOURCE : null,
    userGrants: {
      always: null,
      chat: isRead && input.chatGrantHash
        ? {
          definitionHash: input.chatGrantHash,
          connectorId: null,
          toolName: input.toolName,
        }
        : null,
    },
    connector: null,
  }
}

function exceededCallCap(
  entry: SendToolEntry,
  state: ApprovalState,
): SendToolDenialKind | null {
  if (
    entry.descriptor.family === 'connector'
    && state.counters.connectorCalls >= TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN
  ) {
    return 'connector-calls'
  }

  if (
    countsAsBuiltInCall(entry)
    && state.counters.builtInCalls >= TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN
  ) {
    return 'built-in-calls'
  }

  return null
}

function countsAsBuiltInCall(entry: SendToolEntry): boolean {
  return entry.descriptor.family === 'besidka'
    || entry.descriptor.family === 'google'
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

  if (toolName === 'generate_image' || isToolIndexLoadToolName(toolName)) {
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
    connector: null,
  }
}

/**
 * The entry of one exposed connector tool. The policy name is the exposed
 * name (`mcp__<slug>__<tool>`), because that is the name the SDK signs; the
 * remote name stays on the entry for the audit row, and the summary names
 * the exposed name, never text the remote server chose. A tool is a read
 * only when the server marks it read-only and not destructive and its remote
 * name or title names no delete or share action (`hasAlwaysAskToolName`);
 * the name check and a destructive mark win over `readOnlyHint`, because the
 * annotations are the server's own claim. A read asks before each use until
 * the user sets it to Always allow. `grantHashes` are the hashes the user's
 * own grants were given for; each becomes a grant bound to this connector
 * and exposed name, so it matches only while the tool is unchanged.
 */
export function buildConnectorApprovalEntry(input: {
  exposedName: string
  connectorId: string
  connectorTitle: string
  connectorHost: string
  remoteToolName: string
  remoteToolTitle?: string
  definitionHash: string
  annotations: DestructiveHintAnnotations
  grantHashes?: ConnectorGrantHashes
  isAlwaysDefault?: boolean
}): SendToolEntry {
  const { annotations } = input
  const hasAlwaysAskName = hasAlwaysAskToolName(
    input.remoteToolName,
    input.remoteToolTitle,
  )
  const toGrant = (definitionHash: string | null | undefined) => {
    return definitionHash
      ? {
        definitionHash,
        connectorId: input.connectorId,
        toolName: input.exposedName,
      }
      : null
  }
  const isRead = annotations.readOnlyHint === true
    && annotations.destructiveHint !== true
    && !hasAlwaysAskName

  return {
    descriptor: {
      family: 'connector',
      access: isRead ? 'read' : 'write',
      toolName: input.exposedName,
      connectorId: input.connectorId,
      definitionHash: input.definitionHash,
      destructiveHint: connectorDestructiveHint(annotations)
        || hasAlwaysAskName,
    },
    summary: clampSummary(
      `${input.connectorTitle} wants to run ${input.exposedName}`,
    ),
    taint: 'connector',
    readSource: connectorReadSource(input.connectorId),
    userGrants: {
      always: toGrant(input.grantHashes?.always),
      chat: toGrant(input.grantHashes?.chat),
      ...(input.isAlwaysDefault ? { isAlwaysDefault: true } : {}),
      ...(input.grantHashes?.googleEgress
        ? { googleEgress: toGrant(input.grantHashes.googleEgress) }
        : {}),
    },
    connector: {
      id: input.connectorId,
      host: input.connectorHost,
      remoteToolName: input.remoteToolName,
    },
  }
}

/**
 * Which of the user's own grants let a call run without asking: `chat` for
 * rule 7 and for a Google read that rule 11 let run, `always` for rule 6 (a
 * connector "always" grant or a Besidka tool set to Always allow). Null
 * when no grant decided it.
 */
function userGrantScopeOf(
  decision: ToolApprovalDecision,
): ToolGrantScope | null {
  if (decision.rule === 7 || decision.rule === 11) {
    return 'chat'
  }

  return decision.rule === 6 ? 'always' : null
}

function policyDenialKind(
  reason: ToolApprovalDenialReason,
): SendToolDenialKind {
  return reason === 'over-cap' ? 'invalid-input' : reason
}

function exceededPauseCap(
  pendingCount: number,
  input: unknown,
  state: ApprovalState,
): SendToolDenialKind | null {
  if (state.counters.rounds >= TOOL_APPROVAL_ROUNDS_PER_TURN) {
    return 'rounds'
  }

  if (pendingCount >= TOOL_APPROVAL_PENDING_PER_MESSAGE) {
    return 'pending'
  }

  return payloadBytes(input) > TOOL_APPROVAL_PAYLOAD_MAX_BYTES
    ? 'payload'
    : null
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
 * result brings are recorded in the live state right away, for the turn
 * record and the next step. Every call of one step is judged against the
 * state at the start of that step (`decisionStateFor`), because none of
 * them can see a sibling's result; only a provider-run call counts within
 * its step.
 * A call that needs approval is kept by its tool call id until the stream
 * pairs it with the SDK's approval id. A call the user approved is marked
 * with `markApprovedByUser` (the continuation, L5, does this before the SDK
 * replays it), bound to its tool name and canonical input: it is cleared
 * for `execute` and lifts the memory write lock for that call only
 * (`isApprovedByUser` with the same name and input); when the SDK replays
 * it with the same name and input, the call runs without a new decision and
 * records its taint, read source and connector count, and any other call
 * reusing its id is decided like a new call. The approval is single use:
 * `consumeApprovedCall` drops it once the call settled. A call the provider
 * runs itself is never gated: the provider has already run it when the SDK
 * sees it, so it only records what it brings
 * (`withProviderToolEgressGuard` keeps such a tool out of a step in which
 * it would need approval). A connector call past the per-turn
 * connector cap is denied. A tool with no entry is denied, and so is a
 * call that would need approval but has an input over the KV payload cap,
 * comes past the per-message cap or would open a sixth round, so a
 * pause never holds a call Besidka cannot store. A call that may run is
 * never held to the payload cap. Every denial reaches the model as a
 * sentence that names the limit and the next step
 * (`SEND_TOOL_DENIAL_TEXT`), never as a bare code.
 */
export function createSendToolApproval(input: {
  state: ApprovalState
}): SendToolApproval {
  const { state } = input
  const entries = new Map<string, SendToolEntry>()
  const clearedCalls = new Map<string, ClearedCall>()
  const approvedCalls = new Map<string, ClearedCall>()

  function matchesApprovedCall(call: ClearedCallCheck): boolean {
    if (typeof call.toolCallId !== 'string') {
      return false
    }

    const approved = approvedCalls.get(call.toolCallId)

    return Boolean(approved)
      && approved?.toolName === call.toolName
      && approved.inputJson === toInputJson(call.input)
  }
  const pendingDecisions = new Map<string, PendingToolApprovalDecision>()
  const grantedCalls = new Map<string, ToolGrantScope>()
  const denials = new Map<SendToolDenialKind, number>()

  function denied(kind: SendToolDenialKind): ToolApprovalStatus {
    denials.set(kind, (denials.get(kind) ?? 0) + 1)

    return { type: 'denied', reason: SEND_TOOL_DENIAL_TEXT[kind] }
  }

  let stepMessages: unknown
  let stepState: ApprovalState | null = null

  /**
   * The state the calls of the current model step are judged against: the
   * send's taint and read sources as they stood when the step began. The
   * SDK hands every call of one step the same `messages` array and runs the
   * step's own calls only after it decided all of them, so no call can see
   * a sibling's result. A call that arrives without `messages` is judged
   * against the live state.
   */
  function decisionStateFor(messages: unknown): ApprovalState {
    if (messages === undefined || messages !== stepMessages || !stepState) {
      stepMessages = messages
      stepState = {
        taint: new Set(state.taint),
        readSources: new Set(state.readSources),
        toolReadSources: state.toolReadSources,
        counters: state.counters,
      }
    }

    return stepState
  }

  function recordInto(target: ApprovalState, entry: SendToolEntry): void {
    if (entry.taint) {
      recordTaint(target, entry.taint)
    }

    if (entry.readSource) {
      recordRead(target, entry.readSource)
    }
  }

  /**
   * Records what a call that runs brings into the live state, which the
   * turn record, the egress guard and the next step read. A provider-run
   * call is also recorded into the current step's state: the provider ran
   * it while the model was still writing, so later calls of the same step
   * may already hold its result.
   */
  function recordRun(
    entry: SendToolEntry,
    options: { isSeenInStep?: boolean } = {},
  ): void {
    if (entry.taint) {
      recordTaint(state, entry.taint)
    }

    if (entry.readSource) {
      recordToolRead(state, entry.readSource)
    }

    if (options.isSeenInStep && stepState) {
      recordInto(stepState, entry)
    }

    if (entry.descriptor.family === 'connector') {
      incrementCounter(state, 'connectorCalls')
    }

    if (countsAsBuiltInCall(entry)) {
      incrementCounter(state, 'builtInCalls')
    }
  }

  function toolApproval(
    options: { toolCall: ToolApprovalCall, messages?: unknown },
  ): ToolApprovalStatus {
    const { toolCall } = options
    const entry = entries.get(toolCall.toolName)
    const decisionState = decisionStateFor(options.messages)

    if (!entry) {
      return denied('missing-tool')
    }

    if (matchesApprovedCall(toolCall)) {
      recordRun(entry)

      return 'not-applicable'
    }

    if (toolCall.providerExecuted === true) {
      recordRun(entry, { isSeenInStep: true })

      return 'not-applicable'
    }

    const callCap = exceededCallCap(entry, state)

    if (callCap) {
      return denied(callCap)
    }

    if (entry.failsWithoutRunning?.(toolCall.input) === true) {
      clearedCalls.set(toolCall.toolCallId, {
        toolName: toolCall.toolName,
        inputJson: toInputJson(toolCall.input),
      })

      return 'not-applicable'
    }

    const decision = resolveToolApproval({
      descriptor: entry.descriptor,
      state: decisionState,
      permissionMode: entry.permissionMode ?? 'ask',
      alwaysGrant: entry.userGrants?.always ?? null,
      chatGrant: entry.userGrants?.chat ?? null,
      isAlwaysGrantDefault: entry.userGrants?.isAlwaysDefault === true,
      googleEgressGrant: entry.userGrants?.googleEgress ?? null,
    })
    const grantScope = decision.rule === 6
      && entry.userGrants?.isAlwaysDefault
      ? null
      : userGrantScopeOf(decision)

    if (decision.status.type === 'denied') {
      return denied(policyDenialKind(decision.status.reason))
    }

    if (decision.status.type === 'not-applicable') {
      clearedCalls.set(toolCall.toolCallId, {
        toolName: toolCall.toolName,
        inputJson: toInputJson(toolCall.input),
      })

      if (grantScope) {
        grantedCalls.set(toolCall.toolCallId, grantScope)
      }

      recordRun(entry)

      return 'not-applicable'
    }

    const pauseCap = exceededPauseCap(
      pendingDecisions.size,
      toolCall.input,
      state,
    )

    if (pauseCap) {
      return denied(pauseCap)
    }

    pendingDecisions.set(toolCall.toolCallId, {
      toolName: toolCall.toolName,
      entry,
      decision,
      summary: summarizeCall(entry, toolCall.input),
      preview: previewCall(entry, toolCall.input),
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
      if (entries.has(toolName)) {
        continue
      }

      entries.set(toolName, buildFallbackEntry(toolName))
    }
  }

  function buildFallbackEntry(toolName: string): SendToolEntry {
    if (isBesidkaChatToolName(toolName)) {
      return buildUndescribedBesidkaEntry(toolName)
    }

    return isGoogleToolName(toolName)
      ? buildUndescribedGoogleEntry(toolName)
      : buildNativeApprovalEntry(toolName)
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

  function needsClearedCall(entry: SendToolEntry | undefined): boolean {
    if (!entry) {
      return false
    }

    if (entry.descriptor.family === 'google') {
      return true
    }

    return entry.descriptor.family === 'native'
      && entry.descriptor.access !== 'read'
      && entry.descriptor.writesMemory !== true
  }

  /**
   * Wraps the `execute` of every native write except the memory tools
   * (which keep their own lock), and of every Google tool, reads included,
   * so it only runs a call the policy cleared, with the same name and
   * input, once. A second line behind the SDK, which never calls `execute`
   * for a call that waits for approval.
   */
  function guardNativeWrites(
    tools: ToolSet | undefined,
  ): ToolSet | undefined {
    if (!tools) {
      return tools
    }

    return Object.fromEntries(Object.entries(tools).map(([toolName, tool]) => {
      const entry = entries.get(toolName)

      if (entry && isOwnWebSearch(entry, tool) && hasExecute(tool)) {
        return [toolName, guardWebSearch(tool)]
      }

      if (
        !needsClearedCall(entry)
        || isProviderTool(tool)
        || !hasExecute(tool)
      ) {
        return [toolName, tool]
      }

      const execute = tool.execute.bind(tool)

      return [toolName, {
        ...tool,
        execute: async (
          input: unknown,
          options?: { toolCallId?: string },
        ) => {
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

          if (entry?.taintsRun && await entry.taintsRun(input)) {
            recordTaint(state, 'google')
            recordToolRead(state, TOOL_APPROVAL_GOOGLE_READ_SOURCE)
          }

          return await execute(input, options)
        },
      } as ToolSet[string]]
    }))
  }

  /**
   * Refuses a web search Besidka runs itself (Brave, Exa or any other
   * function tool that searches the web) once a tool call of the turn read
   * a connector or the user's Besidka data, so the query cannot carry that
   * data out. The send also leaves such a tool out of later steps; this is
   * the line that holds where it cannot (Anthropic routes).
   */
  function guardWebSearch(tool: {
    execute: (input: unknown, options?: { toolCallId?: string }) => unknown
  }): ToolSet[string] {
    const execute = tool.execute.bind(tool)

    return {
      ...tool,
      execute: (input: unknown, options?: { toolCallId?: string }) => {
        if (state.toolReadSources.size > 0) {
          throw createError({
            message: WEB_SEARCH_AFTER_PRIVATE_READ_TEXT,
            status: 403,
            why: 'A tool call of this message read private data.',
            fix: 'Answer without a web search.',
          })
        }

        return execute(input, options)
      },
    } as unknown as ToolSet[string]
  }

  function wouldAsk(entry: SendToolEntry): boolean {
    return resolveToolApproval({
      descriptor: entry.descriptor,
      state,
      permissionMode: entry.permissionMode ?? 'ask',
    }).status.type !== 'not-applicable'
  }

  function shouldWithhold(entry: SendToolEntry): boolean {
    if (entry.descriptor.toolName === CODE_EXECUTION_TOOL_NAME) {
      return state.taint.has('google')
    }

    if (entry.descriptor.access !== 'read') {
      return wouldAsk(entry)
    }

    return entry.taint === 'web' && state.toolReadSources.size > 0
  }

  function listWithheldProviderTools(tools: ToolSet | undefined): string[] {
    return Object.entries(tools ?? {}).flatMap(([toolName, tool]) => {
      const entry = entries.get(toolName)

      if (!entry) {
        return []
      }

      if (isOwnWebSearch(entry, tool)) {
        return state.toolReadSources.size > 0 ? [toolName] : []
      }

      if (!isProviderTool(tool) || !shouldWithhold(entry)) {
        return []
      }

      return [toolName]
    })
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
      const approved = {
        toolName: call.toolName,
        inputJson: toInputJson(call.input),
      }

      clearedCalls.set(call.toolCallId, approved)
      approvedCalls.set(call.toolCallId, approved)
    },
    isApprovedByUser: matchesApprovedCall,
    consumeApprovedCall: (toolCallId) => {
      approvedCalls.delete(toolCallId)
      clearedCalls.delete(toolCallId)
    },
    getPendingDecision: toolCallId => pendingDecisions.get(toolCallId),
    getDenials: () => Object.fromEntries(denials),
    getGrantScope: toolCallId => grantedCalls.get(toolCallId) ?? null,
    listWithheldProviderTools,
    recordConnectorOpened: (connectorId) => {
      recordTaint(state, 'connector')
      recordToolRead(state, connectorReadSource(connectorId))
    },
  }
}

type StepPreparation = Awaited<ReturnType<PrepareStepFunction<ToolSet>>>

/**
 * Keeps a provider-executed tool that is not a read (web fetch or any
 * unclassified provider tool; code execution is exempt because its sandbox
 * has no network access, so it cannot carry data out, until the send holds
 * `google` taint, because its code, output and files are stored without a
 * Google marking) out of
 * every step in which the policy would ask for it, and the provider's own
 * web search, grounding and URL context, and the web searches Besidka runs
 * itself (Brave, Exa), out of every step once a tool call of the turn read
 * a connector or the user's Besidka data (rule 4: a query could carry that
 * data out). Web taint alone, and knowledge or past-chat
 * excerpts preset into the prompt, do not withhold them. The provider runs
 * such a call inside its own response, before Besidka sees it, so it can
 * never wait for approval; leaving the tool out is the only way to stop it.
 * The tools the base `prepareStep` already narrowed stay narrowed. With
 * `keepDeclarations` (Anthropic, whose API rejects tool history without the
 * declaration) the base result is returned unchanged.
 */
export function withProviderToolEgressGuard(input: {
  approval: SendToolApproval
  tools: ToolSet | undefined
  base?: PrepareStepFunction<ToolSet>
  keepDeclarations: boolean
}): PrepareStepFunction<ToolSet> {
  return async (options) => {
    const prepared: StepPreparation = input.base
      ? await input.base(options)
      : undefined

    if (input.keepDeclarations) {
      return prepared
    }

    const withheld = input.approval.listWithheldProviderTools(input.tools)

    if (withheld.length === 0) {
      return prepared
    }

    const declared = prepared?.activeTools ?? Object.keys(input.tools ?? {})
    const activeTools = declared.filter((toolName) => {
      return !withheld.includes(toolName)
    })

    return { ...prepared, activeTools }
  }
}

/**
 * Whether the send declares a tool the guard may have to withhold: a
 * provider-executed tool that is not a read, a provider web search,
 * grounding or URL context tool, or a web search Besidka runs itself (Brave,
 * Exa), so `withProviderToolEgressGuard` has something to do.
 */
export function hasGuardedProviderTool(
  approval: SendToolApproval,
  tools: ToolSet | undefined,
): boolean {
  return Object.entries(tools ?? {}).some(([toolName, tool]) => {
    const entry = approval.entries.get(toolName)

    if (!entry) {
      return false
    }

    return isOwnWebSearch(entry, tool)
      || (
        isProviderTool(tool)
        && (entry.descriptor.access !== 'read' || entry.taint === 'web')
      )
  })
}

/**
 * Records, before the first model step, the untrusted content the send
 * already puts in front of the model, with the same triggers as the memory
 * write lock (`presetMemoryWriteLock`) plus a chat branched from a public
 * share, files the user attached to this message (`file`, so no
 * remembered approval runs a tool in a send that holds a document), an
 * earlier Besidka tool result in the chat (`besidka`) and content from
 * Google already in the chat (`google`, `chatHoldsGoogleData`), which makes
 * every connector call ask for the Google egress grant and also counts as
 * a tool read, so the provider's web search and URL tools and Brave and
 * Exa stay withheld for the whole send.
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
    holdsUserAttachments?: boolean
    holdsBesidkaToolHistory?: boolean
    holdsGoogleData?: boolean
  },
): void {
  if (send.requestedTools.some(isWebSearchTool)) {
    recordTaint(state, 'web')
  }

  if (send.holdsUntrustedKnowledge || send.holdsPastChatExcerpts) {
    recordTaint(state, 'knowledge')
    recordRead(state, TOOL_APPROVAL_BESIDKA_READ_SOURCE)
  }

  if (send.holdsArtifactContext || send.holdsUserAttachments) {
    recordTaint(state, 'file')
  }

  if (send.holdsSkillText) {
    recordTaint(state, 'skill')
  }

  if (send.isBranchedFromShare) {
    recordTaint(state, 'shared-branch')
  }

  if (send.holdsBesidkaToolHistory) {
    recordTaint(state, 'besidka')
  }

  if (send.holdsGoogleData) {
    recordTaint(state, 'google')
    recordToolRead(state, TOOL_APPROVAL_GOOGLE_READ_SOURCE)
  }
}

/**
 * Whether stored parts hold a Besidka tool call that ran (a result or an
 * error). An earlier answer built on Besidka results may quote that data, so
 * a later send starts with `besidka` taint: Besidka writes and the
 * ask-every-time tier ask, Besidka reads keep their relaxed rule.
 */
export function hasBesidkaToolResult(parts: unknown): boolean {
  return Array.isArray(parts) && parts.some((part) => {
    if (!isRecord(part) || typeof part.type !== 'string') {
      return false
    }

    return isBesidkaChatToolName(part.type.replace(/^tool-/, ''))
      && (part.state === 'output-available' || part.state === 'output-error')
  })
}

type ToolCallProviderMetadata = Record<string, Record<string, unknown>>

export interface CollectedToolApproval {
  approvalId: string
  toolCallId: string
  toolName: string
  input: unknown
  callProviderMetadata: ToolCallProviderMetadata | null
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
  const inputs = new Map<string, {
    toolName: string
    input: unknown
    providerMetadata?: ToolCallProviderMetadata
  }>()
  const collected: CollectedToolApproval[] = []
  let stepCount = 0
  let isPaused = false
  const markedGrants = new Set<string>()

  function enqueueGrantPart(
    toolCallId: string,
    controller: TransformStreamDefaultController<UIMessageChunk>,
  ): void {
    const scope = approval.getGrantScope(toolCallId)
    const call = inputs.get(toolCallId)

    if (!scope || !call || markedGrants.has(toolCallId)) {
      return
    }

    markedGrants.add(toolCallId)

    const data: ToolGrantPartData = {
      toolCallId,
      toolName: call.toolName,
      scope,
    }

    controller.enqueue({
      type: TOOL_GRANT_DATA_PART_TYPE,
      id: `grant-${toolCallId}`,
      data,
    })
  }

  function apply(
    stream: ReadableStream<UIMessageChunk>,
  ): ReadableStream<UIMessageChunk> {
    return stream.pipeThrough(new TransformStream<
      UIMessageChunk,
      UIMessageChunk
    >({
      async transform(chunk, controller) {
        if (chunk.type === 'tool-input-available') {
          inputs.set(chunk.toolCallId, {
            toolName: chunk.toolName,
            input: chunk.input,
            providerMetadata: chunk.providerMetadata,
          })
        }

        if (chunk.type === 'finish-step') {
          stepCount += 1
        }

        if (
          chunk.type === 'tool-output-available'
          || chunk.type === 'tool-output-error'
        ) {
          controller.enqueue(chunk)
          enqueueGrantPart(chunk.toolCallId, controller)

          return
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

        await describeCall(pending, call.input)

        collected.push({
          approvalId: chunk.approvalId,
          toolCallId: chunk.toolCallId,
          toolName: call.toolName,
          input: call.input,
          callProviderMetadata: call.providerMetadata ?? null,
          signature,
          pending,
        })

        const data: ToolApprovalPartData = {
          approvalId: chunk.approvalId,
          toolCallId: chunk.toolCallId,
          toolName: call.toolName,
          reason: pending.decision.reason ?? 'default',
          summary: pending.summary,
          rememberOptions: [...pending.decision.rememberOptions],
          ...(pending.preview ? { preview: pending.preview } : {}),
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
  resultStash?: ReadonlyArray<{
    resultId: string
    record: ToolApprovalResultRecord
  }>
}

/**
 * Stores what the continuation needs once the paused reply is persisted:
 * one pending record per approval (exact input and signature, the policy
 * reason and remember options, the summary, a snapshot of the send), one
 * turn record with the pending ids and the serialized approval state, and
 * the stashed tool result bodies (`resultStash`, the Google results D1
 * keeps as references). Every id goes into the per-chat index in ONE write
 * before any record: KV takes about one write a second per key, so a
 * second index write in the same request could be refused and lose a
 * pending record. A connector call also gets a `pending` audit row first,
 * and its id goes into the record so the answer can settle that row; when
 * the record cannot be stored, that row is settled as an error right away.
 * Writes are sequential (one KV connection at a time). A record that fails
 * is logged and skipped; the continuation then answers that the approval
 * expired. The stash is written only once a pending record exists, so a
 * pause nobody can answer leaves no body behind, and a stash failure only
 * costs the body, never the pause.
 */
export async function recordToolApprovalPause(
  input: RecordToolApprovalPauseInput,
): Promise<{ written: number }> {
  const pendingApprovalIds: string[] = []
  const resultStash = input.resultStash ?? []

  if (input.collected.length === 0) {
    return { written: 0 }
  }

  await indexToolApprovalChatRecords(input.kv, input.chatPublicId, {
    approvalIds: input.collected
      .map(collected => collected.approvalId)
      .filter(isWellFormedToolApprovalId),
    messageIds: [input.messagePublicId],
    resultIds: resultStash.map(entry => entry.resultId),
  })

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
        callProviderMetadata: collected.callProviderMetadata,
        signature: collected.signature,
        reason: decision.reason ?? 'default',
        rememberOptions: [...decision.rememberOptions],
        summary: collected.pending.summary,
        auditCallId,
        snapshot: input.snapshot,
      }, { alreadyIndexed: true })
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
  }, { alreadyIndexed: true })

  await writeResultStash(input, resultStash)

  return { written: pendingApprovalIds.length }
}

async function writeResultStash(
  input: RecordToolApprovalPauseInput,
  resultStash: NonNullable<RecordToolApprovalPauseInput['resultStash']>,
): Promise<void> {
  if (resultStash.length === 0) {
    return
  }

  try {
    const outcomes = await putToolApprovalResults(input.kv, resultStash, {
      alreadyIndexed: true,
    })

    input.logger.set({
      attributes: {
        toolApproval: {
          resultsStashed: outcomes.length,
          resultsTruncated: outcomes.filter((outcome) => {
            return outcome.truncated
          }).length,
        },
      },
    })
  } catch (exception) {
    input.logger.set({
      attributes: {
        toolApproval: {
          resultStash: 'failed',
          error: exceptionMessage(exception),
        },
      },
    })
  }
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

function partCallsTool(part: unknown, toolName: string): boolean {
  if (!isRecord(part) || typeof part.type !== 'string') {
    return false
  }

  return part.type === `tool-${toolName}`
    || (part.type === 'dynamic-tool' && part.toolName === toolName)
}

/**
 * Leaves out, before the first step, every provider-executed tool the
 * policy would ask for given what the send already holds. On a route that
 * needs the declaration for tool history (Anthropic), a tool the given
 * history already called stays.
 */
export function withholdProviderTools(input: {
  approval: SendToolApproval
  tools: ToolSet | undefined
  keepWhenHistoryHolds: readonly unknown[] | null
}): ToolSet | undefined {
  if (!input.tools) {
    return input.tools
  }

  const withheld = input.approval.listWithheldProviderTools(input.tools)
    .filter((toolName) => {
      return !input.keepWhenHistoryHolds?.some((part) => {
        return partCallsTool(part, toolName)
      })
    })

  if (withheld.length === 0) {
    return input.tools
  }

  return Object.fromEntries(Object.entries(input.tools).filter(([name]) => {
    return !withheld.includes(name)
  }))
}

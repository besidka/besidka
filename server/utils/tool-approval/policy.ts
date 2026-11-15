import {
  TOOL_ACCESS_LEVELS,
  TOOL_APPROVAL_BESIDKA_READ_SOURCE,
  TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN,
  TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN,
  TOOL_APPROVAL_MEMORY_WRITE_TOOL_NAMES,
  TOOL_APPROVAL_ROUNDS_PER_TURN,
  TOOL_FAMILIES,
  TOOL_PERMISSION_MODES,
} from '#shared/utils/tool-approval-policy'
import type {
  ToolAccess,
  ToolApprovalDenialReason,
  ToolApprovalReason,
  ToolApprovalRemember,
  ToolApprovalTaintKind,
  ToolFamily,
  ToolPermissionMode,
} from '#shared/utils/tool-approval-policy'
import { connectorReadSource } from '~~/server/utils/tool-approval/state'
import type { ApprovalState } from '~~/server/utils/tool-approval/state'

/**
 * What the policy needs to know about one tool call. `toolName` is the name
 * the model sees and the SDK signs: `mcp__<slug>__<tool>` for a connector,
 * the exposed name for a Besidka tool, the SDK tool name for a native tool.
 * The same name goes into the pending record and the grants; the remote
 * connector tool name stays in the audit row.
 * `destructiveHint` is required so the code that builds a descriptor has to
 * decide it; a connector tool takes it from `connectorDestructiveHint`.
 * `writesMemory` marks a native tool that writes persistent memory; the
 * native memory tool names count even without the marker.
 * `onlyConnectorOrSkillTaint` marks a native write (the artifact and
 * document tools) that asks only after connector or skill output; every
 * other native write counts every taint kind, so an unclassified tool fails
 * closed.
 */
export interface ToolApprovalDescriptor {
  family: ToolFamily
  access: ToolAccess
  toolName: string
  connectorId?: string
  definitionHash?: string
  destructiveHint: boolean
  writesMemory?: boolean
  onlyConnectorOrSkillTaint?: boolean
}

export interface DestructiveHintAnnotations {
  readOnlyHint?: boolean | null
  destructiveHint?: boolean | null
}

/**
 * The `destructiveHint` for a connector tool descriptor: true only when the
 * server declares `destructiveHint: true`, which puts the tool in the
 * always-ask tier (Allow once, Deny). A tool that is not marked read-only
 * and not marked destructive is a plain write: it still asks (reason
 * `default`) and may be remembered in the chat or always. A server's
 * `destructiveHint: false` never skips the prompt; it is treated exactly
 * like a missing hint (docs/connectors.md section 7.1).
 */
export function connectorDestructiveHint(
  annotations: DestructiveHintAnnotations | null | undefined,
): boolean {
  return annotations?.destructiveHint === true
}

const ALWAYS_ASK_TOOL_NAME_WORDS: ReadonlySet<string> = new Set([
  'delete',
  'remove',
  'revoke',
  'destroy',
  'drop',
  'purge',
  'invite',
  'share',
  'unshare',
  'transfer',
  'publish',
  'unpublish',
  'send',
  'post',
  'forward',
  'reply',
])

function toolNameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

/**
 * Whether a connector tool's remote name or title names an action that
 * removes data or hands it to someone else (delete, remove, revoke, destroy,
 * drop, purge, invite, share, unshare, transfer, publish, unpublish, send,
 * post, forward, reply). Such a tool is always-ask whatever its annotations
 * say, because the annotations are the server's own claim. Words are split
 * on non-letters and camelCase and must match whole, so `delete_issue`,
 * `deleteIssue`, `send_email`, `unshare_page` and "Share file" match, while
 * `dropdown_list` and the plural nouns of `search_posts` or
 * `list_shared_drives` do not. Pass the remote name and title, never the
 * exposed `mcp__<slug>__` name, so a connector slug cannot change the
 * result.
 */
export function hasAlwaysAskToolName(
  ...names: ReadonlyArray<string | null | undefined>
): boolean {
  return names.some((name) => {
    return typeof name === 'string'
      && toolNameWords(name).some(word => ALWAYS_ASK_TOOL_NAME_WORDS.has(word))
  })
}

/**
 * A "always" or "in this chat" grant. A connector grant needs the same
 * connector id, tool name and definition hash as the call; a Besidka grant
 * needs the same tool name and registry hash.
 */
export interface ToolApprovalGrant {
  definitionHash: string | null
  connectorId: string | null
  toolName: string
}

export type ToolApprovalRule = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export type ToolApprovalOutcome
  = | { type: 'not-applicable' }
    | { type: 'user-approval', reason: ToolApprovalReason }
    | { type: 'denied', reason: ToolApprovalDenialReason }

export interface ResolveToolApprovalInput {
  descriptor: ToolApprovalDescriptor
  state: ApprovalState
  permissionMode: ToolPermissionMode
  chatGrant?: ToolApprovalGrant | null
  alwaysGrant?: ToolApprovalGrant | null
}

export interface ToolApprovalDecision {
  status: ToolApprovalOutcome
  reason: ToolApprovalReason | null
  rememberOptions: ToolApprovalRemember[]
  rule: ToolApprovalRule
}

export interface ReplayPendingTool {
  family: ToolFamily
  access: ToolAccess
  toolName: string
  connectorId?: string | null
  definitionHash?: string | null
}

export interface ResolveReplayApprovalInput {
  descriptor: ToolApprovalDescriptor | null
  pending: ReplayPendingTool
  state: ApprovalState
  permissionMode: ToolPermissionMode
}

export interface ToolReplayDecision {
  status: { type: 'not-applicable' } | {
    type: 'denied'
    reason: ToolApprovalDenialReason
  }
  denialReason: ToolApprovalDenialReason | null
}

const UNTRUSTED_NATIVE_WRITE_TAINT: readonly ToolApprovalTaintKind[] = [
  'connector',
  'skill',
]

const REMEMBER_OPTIONS_BY_REASON: Record<
  ToolApprovalReason,
  ToolApprovalRemember[]
> = {
  'untrusted-output': ['once'],
  'cross-source': ['once'],
  'always-ask': ['once'],
  'default': ['once', 'chat', 'always'],
}

function allowed(rule: ToolApprovalRule): ToolApprovalDecision {
  return {
    status: { type: 'not-applicable' },
    reason: null,
    rememberOptions: [],
    rule,
  }
}

function denied(
  rule: ToolApprovalRule,
  reason: ToolApprovalDenialReason,
): ToolApprovalDecision {
  return {
    status: { type: 'denied', reason },
    reason: null,
    rememberOptions: [],
    rule,
  }
}

function ask(
  rule: ToolApprovalRule,
  reason: ToolApprovalReason,
  rememberOptions: readonly ToolApprovalRemember[]
    = REMEMBER_OPTIONS_BY_REASON[reason],
): ToolApprovalDecision {
  return {
    status: { type: 'user-approval', reason },
    reason,
    rememberOptions: [...rememberOptions],
    rule,
  }
}

function isOneOf<Value extends string>(
  values: readonly Value[],
  candidate: unknown,
): candidate is Value {
  return typeof candidate === 'string'
    && (values as readonly string[]).includes(candidate)
}

function hasToolName(toolName: unknown): boolean {
  return typeof toolName === 'string' && toolName.trim().length > 0
}

function isValidDescriptor(descriptor: ToolApprovalDescriptor): boolean {
  return Boolean(descriptor)
    && isOneOf(TOOL_FAMILIES, descriptor.family)
    && isOneOf(TOOL_ACCESS_LEVELS, descriptor.access)
    && hasToolName(descriptor.toolName)
    && typeof descriptor.destructiveHint === 'boolean'
}

function isValidPendingTool(pending: ReplayPendingTool): boolean {
  return Boolean(pending)
    && isOneOf(TOOL_FAMILIES, pending.family)
    && isOneOf(TOOL_ACCESS_LEVELS, pending.access)
    && hasToolName(pending.toolName)
}

function isMemoryWrite(descriptor: ToolApprovalDescriptor): boolean {
  return descriptor.writesMemory === true
    || isOneOf(TOOL_APPROVAL_MEMORY_WRITE_TOOL_NAMES, descriptor.toolName)
}

function isTaintedFor(
  descriptor: ToolApprovalDescriptor,
  state: ApprovalState,
): boolean {
  if (
    descriptor.onlyConnectorOrSkillTaint === true
    && !isMemoryWrite(descriptor)
  ) {
    return UNTRUSTED_NATIVE_WRITE_TAINT.some((kind) => {
      return state.taint.has(kind)
    })
  }

  return state.taint.size > 0
}

function ownReadSourceOf(descriptor: ToolApprovalDescriptor): string | null {
  if (descriptor.family === 'besidka') {
    return TOOL_APPROVAL_BESIDKA_READ_SOURCE
  }

  return descriptor.family === 'connector' && descriptor.connectorId
    ? connectorReadSource(descriptor.connectorId)
    : null
}

function ownTaintKindOf(
  descriptor: ToolApprovalDescriptor,
): ToolApprovalTaintKind | null {
  if (descriptor.family === 'besidka') {
    return 'besidka'
  }

  return descriptor.family === 'connector' ? 'connector' : null
}

/**
 * Whether the send holds content from outside the tool's own source, for a
 * connector or Besidka write (rule 2). Taint from the tool's own source
 * (its own connector, or the user's Besidka data for a Besidka tool) does
 * not count: owner decision, 2026-11-15. Because `connector` taint carries
 * no connector id, it counts as the tool's own only while the send read the
 * tool's own connector and nothing else; a read of another connector,
 * Besidka data for a connector tool, the `overflow` marker or a missing
 * connector id makes it foreign. Every other taint kind is foreign.
 */
export function hasForeignTaint(
  descriptor: ToolApprovalDescriptor,
  state: ApprovalState,
): boolean {
  const ownKind = ownTaintKindOf(descriptor)
  const ownSource = ownReadSourceOf(descriptor)
  const hasOtherSource = [...state.readSources].some((source) => {
    return source !== ownSource
  })
  const isOwnTaintTraced = ownSource !== null && (
    descriptor.family === 'besidka' || state.readSources.has(ownSource)
  )

  return [...state.taint].some((kind) => {
    return kind !== ownKind || hasOtherSource || !isOwnTaintTraced
  })
}

function hasCrossSourceRead(
  descriptor: ToolApprovalDescriptor,
  state: ApprovalState,
): boolean {
  if (descriptor.family !== 'connector') {
    return false
  }

  const ownSource = ownReadSourceOf(descriptor)

  return [...state.readSources].some(source => source !== ownSource)
}

function grantMatches(
  grant: ToolApprovalGrant | null | undefined,
  descriptor: ToolApprovalDescriptor,
): boolean {
  if (!grant || !grant.definitionHash || !descriptor.definitionHash) {
    return false
  }

  if (
    grant.definitionHash !== descriptor.definitionHash
    || !grant.toolName
    || grant.toolName !== descriptor.toolName
  ) {
    return false
  }

  if (descriptor.family === 'connector') {
    return Boolean(grant.connectorId)
      && grant.connectorId === descriptor.connectorId
  }

  return true
}

/**
 * Whether a tool is in the always-ask tier: a delete, an instructions write
 * or a destructive tool (a server `destructiveHint: true`, a connector tool
 * whose name names a delete or share action, the Besidka ask-every-time
 * tier). Such a tool asks Allow once or Deny every time, and no mode, grant
 * or answer can set it to Always allow.
 */
export function isAlwaysAskTier(descriptor: ToolApprovalDescriptor): boolean {
  return descriptor.access === 'delete'
    || descriptor.access === 'instructions'
    || descriptor.destructiveHint
}

function resolveNativeApproval(
  descriptor: ToolApprovalDescriptor,
  state: ApprovalState,
): ToolApprovalDecision {
  if (descriptor.access === 'read') {
    return allowed(1)
  }

  if (isTaintedFor(descriptor, state)) {
    return ask(2, 'untrusted-output')
  }

  if (isAlwaysAskTier(descriptor)) {
    return ask(5, 'always-ask')
  }

  return allowed(8)
}

/**
 * The approval decision for one tool call, as a pure function of the tool,
 * what this send has already read, the user's mode for the tool and the
 * grants they gave. The rules apply in order and the first match wins:
 *
 * 0. Invalid input, or Blocked by the user: denied. Input is invalid when
 *    the permission mode, family or access is not one of the known values,
 *    the tool name is empty or `destructiveHint` is not a boolean; it is
 *    denied with `invalid-input`, never guessed at.
 *
 * Native tools (Besidka's own lookups and writes):
 *
 * 1. Native read: no approval.
 * 2. Native write after untrusted content: ask `untrusted-output`. Artifact
 *    and document writes (`onlyConnectorOrSkillTaint`) count only connector
 *    and skill taint; every other native write, memory writes and
 *    unclassified tools included, counts every taint kind.
 * 8. Otherwise a native write runs.
 *
 * Connector and Besidka reads (not in the always-ask tier), owner decisions
 * of 2026-11-15:
 *
 * 2, 3. A connector read after content from outside its own connector asks
 *    `untrusted-output` (foreign taint) or `cross-source` (another source
 *    read), whatever its mode, because its arguments go to the connector's
 *    server; it offers every answer, so the user can still set a mode.
 *    A Besidka read skips both: its arguments stay inside Besidka.
 * 6. Always allow (a Besidka tool set to Allow, or a connector "always"
 *    grant whose connector id, tool name and definition hash match, the
 *    default of a plain connector read included): no approval.
 * 7. Chat grant that matches the same way: no approval.
 * 9. Otherwise ask `default`, with every answer offered.
 *
 * Connector and Besidka writes, and the always-ask tier:
 *
 * 2. Content from outside the tool's own source (`hasForeignTaint`): ask
 *    `untrusted-output`.
 * 3. A connector call after reading another source (F2): ask
 *    `cross-source`.
 * 5. Always-ask tier: ask `always-ask`.
 * 6. Always allow, 7. chat grant, matched as for reads: no approval.
 * 9. Otherwise ask `default`.
 *
 * Grants and Always allow never lift rules 2, 3 and 5 for a write, and a
 * missing hash on either side never matches a grant.
 */
export function resolveToolApproval(
  input: ResolveToolApprovalInput,
): ToolApprovalDecision {
  const { descriptor, state } = input

  if (
    !isOneOf(TOOL_PERMISSION_MODES, input.permissionMode)
    || !isValidDescriptor(descriptor)
  ) {
    return denied(0, 'invalid-input')
  }

  if (input.permissionMode === 'blocked') {
    return denied(0, 'blocked')
  }

  if (descriptor.family === 'native') {
    return resolveNativeApproval(descriptor, state)
  }

  const isAlwaysAsk = isAlwaysAskTier(descriptor)
  const isAlwaysAllowed = !isAlwaysAsk && (
    (descriptor.family === 'besidka' && input.permissionMode === 'allow')
    || grantMatches(input.alwaysGrant, descriptor)
  )
  const isChatAllowed = !isAlwaysAsk
    && grantMatches(input.chatGrant, descriptor)

  if (descriptor.access === 'read' && !isAlwaysAsk) {
    if (descriptor.family === 'connector') {
      if (hasForeignTaint(descriptor, state)) {
        return ask(2, 'untrusted-output', REMEMBER_OPTIONS_BY_REASON.default)
      }

      if (hasCrossSourceRead(descriptor, state)) {
        return ask(3, 'cross-source', REMEMBER_OPTIONS_BY_REASON.default)
      }
    }

    if (isAlwaysAllowed) {
      return allowed(6)
    }

    if (isChatAllowed) {
      return allowed(7)
    }

    return ask(9, 'default')
  }

  if (hasForeignTaint(descriptor, state)) {
    return ask(2, 'untrusted-output')
  }

  if (hasCrossSourceRead(descriptor, state)) {
    return ask(3, 'cross-source')
  }

  if (isAlwaysAsk) {
    return ask(5, 'always-ask')
  }

  if (isAlwaysAllowed) {
    return allowed(6)
  }

  if (isChatAllowed) {
    return allowed(7)
  }

  return ask(9, 'default')
}

export function isRememberAllowed(
  decision: Pick<ToolApprovalDecision, 'rememberOptions'>,
  remember: ToolApprovalRemember,
): boolean {
  return remember === 'once' || decision.rememberOptions.includes(remember)
}

/**
 * Applies the button matrix on the server: a remember choice the matrix does
 * not offer for this decision is downgraded to `once`, never honored.
 */
export function clampRemember(
  decision: Pick<ToolApprovalDecision, 'rememberOptions'>,
  remember: ToolApprovalRemember,
): ToolApprovalRemember {
  return isRememberAllowed(decision, remember) ? remember : 'once'
}

function pendingMatchesDescriptor(
  pending: ReplayPendingTool,
  descriptor: ToolApprovalDescriptor,
): boolean {
  if (
    pending.family !== descriptor.family
    || pending.toolName !== descriptor.toolName
    || pending.access !== descriptor.access
  ) {
    return false
  }

  if (descriptor.family === 'native') {
    return true
  }

  if (descriptor.family === 'besidka') {
    return (pending.definitionHash ?? null)
      === (descriptor.definitionHash ?? null)
  }

  return Boolean(pending.connectorId)
    && pending.connectorId === descriptor.connectorId
    && Boolean(pending.definitionHash)
    && pending.definitionHash === descriptor.definitionHash
}

function exceedsTurnCaps(
  descriptor: ToolApprovalDescriptor,
  state: ApprovalState,
): boolean {
  const { counters } = state

  if (counters.rounds > TOOL_APPROVAL_ROUNDS_PER_TURN) {
    return true
  }

  if (descriptor.family === 'connector') {
    return counters.connectorCalls >= TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN
  }

  if (descriptor.family === 'besidka') {
    return counters.builtInCalls >= TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN
  }

  return false
}

/**
 * The decision for a call the user already approved, taken again when the
 * continuation replays it. The SDK only honors `denied` on replay: any other
 * value, `user-approval` included, still runs the approved call, and a tool
 * missing from the toolset errors the whole stream instead of being denied.
 * So this returns only `not-applicable` or `denied`, and a continuation
 * writes its own denial from a `denied` result before calling `streamText`.
 * Denied: the tool is missing, the input is invalid (an unknown permission
 * mode, family or access, or an empty tool name, on either side), the tool
 * is Blocked now, its family, tool name, access, connector or definition
 * hash differs from the pending request, or the turn caps are spent. The
 * rounds counter holds the pauses recorded so far, so the answer to pause
 * number `TOOL_APPROVAL_ROUNDS_PER_TURN` still runs and only a later one is
 * denied (the send refuses to open such a pause in the first place). A
 * changed access matters because a tool that was a read when approved and is
 * a write now was approved for something else.
 */
export function resolveReplayApproval(
  input: ResolveReplayApprovalInput,
): ToolReplayDecision {
  const { descriptor } = input
  const denialReason = findReplayDenial(input, descriptor)

  if (denialReason) {
    return {
      status: { type: 'denied', reason: denialReason },
      denialReason,
    }
  }

  return { status: { type: 'not-applicable' }, denialReason: null }
}

function findReplayDenial(
  input: ResolveReplayApprovalInput,
  descriptor: ToolApprovalDescriptor | null,
): ToolApprovalDenialReason | null {
  if (!descriptor) {
    return 'missing-tool'
  }

  if (
    !isOneOf(TOOL_PERMISSION_MODES, input.permissionMode)
    || !isValidDescriptor(descriptor)
    || !isValidPendingTool(input.pending)
  ) {
    return 'invalid-input'
  }

  if (input.permissionMode === 'blocked') {
    return 'blocked'
  }

  if (!pendingMatchesDescriptor(input.pending, descriptor)) {
    return 'definition-drifted'
  }

  if (exceedsTurnCaps(descriptor, input.state)) {
    return 'over-cap'
  }

  return null
}

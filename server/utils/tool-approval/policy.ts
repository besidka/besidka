import {
  TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN,
  TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN,
  TOOL_APPROVAL_ROUNDS_PER_TURN,
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

export interface ToolApprovalDescriptor {
  family: ToolFamily
  access: ToolAccess
  connectorId?: string
  definitionHash?: string
  destructiveHint?: boolean
}

export interface ToolApprovalGrant {
  definitionHash: string | null
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
  'always-ask': ['once', 'chat'],
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
): ToolApprovalDecision {
  return {
    status: { type: 'user-approval', reason },
    reason,
    rememberOptions: [...REMEMBER_OPTIONS_BY_REASON[reason]],
    rule,
  }
}

function isTaintedFor(
  descriptor: ToolApprovalDescriptor,
  state: ApprovalState,
): boolean {
  if (descriptor.family === 'native') {
    return UNTRUSTED_NATIVE_WRITE_TAINT.some((kind) => {
      return state.taint.has(kind)
    })
  }

  return state.taint.size > 0
}

function hasCrossSourceRead(
  descriptor: ToolApprovalDescriptor,
  state: ApprovalState,
): boolean {
  if (descriptor.family !== 'connector') {
    return false
  }

  const ownSource = descriptor.connectorId
    ? connectorReadSource(descriptor.connectorId)
    : null

  return [...state.readSources].some(source => source !== ownSource)
}

function grantMatches(
  grant: ToolApprovalGrant | null | undefined,
  descriptor: ToolApprovalDescriptor,
): boolean {
  if (!grant || !grant.definitionHash || !descriptor.definitionHash) {
    return false
  }

  return grant.definitionHash === descriptor.definitionHash
}

/**
 * The approval decision for one tool call, as a pure function of the tool,
 * what this send has already read, the user's setting for the tool and the
 * grants they gave. The rules apply in order and the first match wins:
 *
 * 0. Blocked by the user: denied.
 * 1. Native read: no approval.
 * 2. Any non-read call after untrusted content: ask `untrusted-output`.
 *    Native writes count only connector and skill taint.
 * 3. Connector call after reading another source: ask `cross-source`.
 * 4. Besidka tool of any access after untrusted content: ask
 *    `untrusted-output`.
 * 5. Delete, instructions or `destructiveHint`: ask `always-ask`.
 * 6. User "always" grant whose definition hash still matches (or a Besidka
 *    tool set to Allow): no approval.
 * 7. Chat grant whose definition hash still matches: no approval.
 * 8. Native write: no approval.
 * 9. Otherwise ask `default`.
 *
 * Rules 6 and 7 come after rule 5, so an "always" or chat grant never lifts
 * a delete, an instructions write or a destructive tool. A missing hash on
 * either side never matches a grant.
 */
export function resolveToolApproval(
  input: ResolveToolApprovalInput,
): ToolApprovalDecision {
  const { descriptor, state } = input

  if (input.permissionMode === 'blocked') {
    return denied(0, 'blocked')
  }

  if (descriptor.family === 'native' && descriptor.access === 'read') {
    return allowed(1)
  }

  if (descriptor.access !== 'read' && isTaintedFor(descriptor, state)) {
    return ask(2, 'untrusted-output')
  }

  if (hasCrossSourceRead(descriptor, state)) {
    return ask(3, 'cross-source')
  }

  if (descriptor.family === 'besidka' && state.taint.size > 0) {
    return ask(4, 'untrusted-output')
  }

  if (
    descriptor.access === 'delete'
    || descriptor.access === 'instructions'
    || descriptor.destructiveHint === true
  ) {
    return ask(5, 'always-ask')
  }

  const besidkaAllowed = descriptor.family === 'besidka'
    && input.permissionMode === 'allow'

  if (besidkaAllowed || grantMatches(input.alwaysGrant, descriptor)) {
    return allowed(6)
  }

  if (grantMatches(input.chatGrant, descriptor)) {
    return allowed(7)
  }

  if (descriptor.family === 'native' && descriptor.access === 'write') {
    return allowed(8)
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
  if (pending.family !== descriptor.family) {
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

  if (counters.rounds >= TOOL_APPROVAL_ROUNDS_PER_TURN) {
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
 * Denied: the tool is Blocked now, missing, its family, connector or
 * definition hash differs from the pending request, or the turn caps are
 * spent.
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

import { createError } from 'evlog'
import { z } from 'zod'
import {
  TOOL_APPROVAL_CONNECTOR_READ_SOURCE_PREFIX,
  TOOL_APPROVAL_READ_SOURCES_MAX,
  TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH,
  TOOL_APPROVAL_READ_SOURCE_OVERFLOW,
  TOOL_APPROVAL_TAINT_KINDS,
} from '#shared/utils/tool-approval-policy'
import type {
  ToolApprovalTaintKind,
} from '#shared/utils/tool-approval-policy'

const COUNTER_MAX = 10_000

export interface ApprovalCounters {
  rounds: number
  steps: number
  connectorCalls: number
  builtInCalls: number
}

export type ApprovalCounterName = keyof ApprovalCounters

export interface ApprovalState {
  taint: Set<ToolApprovalTaintKind>
  readSources: Set<string>
  counters: ApprovalCounters
}

export interface SerializedApprovalState {
  taint: ToolApprovalTaintKind[]
  readSources: string[]
  counters: ApprovalCounters
}

export type DeserializedApprovalState
  = | { ok: true, state: ApprovalState }
    | { ok: false }

const counterSchema = z.number().int().min(0).max(COUNTER_MAX)

export const serializedApprovalStateSchema = z.object({
  taint: z.array(z.enum(TOOL_APPROVAL_TAINT_KINDS))
    .max(TOOL_APPROVAL_TAINT_KINDS.length),
  readSources: z.array(
    z.string().min(1).max(TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH),
  ).max(TOOL_APPROVAL_READ_SOURCES_MAX),
  counters: z.object({
    rounds: counterSchema,
    steps: counterSchema,
    connectorCalls: counterSchema,
    builtInCalls: counterSchema,
  }),
})

export function createApprovalState(): ApprovalState {
  return {
    taint: new Set(),
    readSources: new Set(),
    counters: {
      rounds: 0,
      steps: 0,
      connectorCalls: 0,
      builtInCalls: 0,
    },
  }
}

export function connectorReadSource(connectorId: string): string {
  return `${TOOL_APPROVAL_CONNECTOR_READ_SOURCE_PREFIX}${connectorId}`
}

function invalidState(message: string, why: string): never {
  throw createError({ message, status: 500, why })
}

function isKnownTaintKind(value: unknown): value is ToolApprovalTaintKind {
  return typeof value === 'string'
    && (TOOL_APPROVAL_TAINT_KINDS as readonly string[]).includes(value)
}

function isValidReadSource(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH
}

/**
 * Throws on a kind that is not in `TOOL_APPROVAL_TAINT_KINDS`: a taint that
 * is silently dropped would let a later write skip its approval.
 */
export function recordTaint(
  state: ApprovalState,
  kind: ToolApprovalTaintKind,
): ApprovalState {
  if (!isKnownTaintKind(kind)) {
    invalidState(
      'Invalid approval taint',
      'The taint kind is not one of the known kinds',
    )
  }

  state.taint.add(kind)

  return state
}

/**
 * Records a source this send has read. Throws on an empty or over-long
 * source. Once the set is full, a new source collapses it to the single
 * `TOOL_APPROVAL_READ_SOURCE_OVERFLOW` value: it equals no connector's own
 * source, so every later connector call asks `cross-source`, and the value is
 * sticky. Dropping the new source instead would hide a read from rule 3.
 */
export function recordRead(
  state: ApprovalState,
  source: string,
): ApprovalState {
  if (!isValidReadSource(source)) {
    invalidState(
      'Invalid approval read source',
      'The read source is empty or longer than the allowed length',
    )
  }

  if (
    state.readSources.has(source)
    || state.readSources.has(TOOL_APPROVAL_READ_SOURCE_OVERFLOW)
  ) {
    return state
  }

  if (state.readSources.size >= TOOL_APPROVAL_READ_SOURCES_MAX) {
    state.readSources.clear()
    state.readSources.add(TOOL_APPROVAL_READ_SOURCE_OVERFLOW)

    return state
  }

  state.readSources.add(source)

  return state
}

/**
 * Throws on an amount that is not a non-negative integer: a `NaN` counter
 * would make every `>=` cap check false. Counters stop at the cap, so a
 * serialized state always passes the schema again.
 */
export function incrementCounter(
  state: ApprovalState,
  counter: ApprovalCounterName,
  amount: number = 1,
): ApprovalState {
  if (!Number.isInteger(amount) || amount < 0) {
    invalidState(
      'Invalid approval counter amount',
      'The amount must be a non-negative integer',
    )
  }

  state.counters[counter] = Math.min(
    COUNTER_MAX,
    state.counters[counter] + amount,
  )

  return state
}

/**
 * Serializes from the set itself, in a stable order, and throws on a kind
 * outside `TOOL_APPROVAL_TAINT_KINDS` instead of leaving it out: a state
 * that loses a taint on its way to KV would let the continuation skip an
 * approval.
 */
export function serializeApprovalState(
  state: ApprovalState,
): SerializedApprovalState {
  const taint = [...state.taint]

  for (const kind of taint) {
    if (!isKnownTaintKind(kind)) {
      invalidState(
        'Invalid approval taint',
        'The state holds a taint kind that is not one of the known kinds',
      )
    }
  }

  return {
    taint: taint.sort((first, second) => {
      return TOOL_APPROVAL_TAINT_KINDS.indexOf(first)
        - TOOL_APPROVAL_TAINT_KINDS.indexOf(second)
    }),
    readSources: [...state.readSources].sort(),
    counters: { ...state.counters },
  }
}

/**
 * Restores a state written by `serializeApprovalState`. A value that does
 * not match the schema returns `{ ok: false }`. For a continuation that is
 * a hard refusal: it must never start from a fresh, empty state, because
 * that would drop the taint and the reads of the paused turn and let the
 * resumed turn skip its approvals.
 */
export function deserializeApprovalState(
  value: unknown,
): DeserializedApprovalState {
  const parsed = serializedApprovalStateSchema.safeParse(value)

  if (!parsed.success) {
    return { ok: false }
  }

  return {
    ok: true,
    state: {
      taint: new Set(parsed.data.taint),
      readSources: new Set(parsed.data.readSources),
      counters: { ...parsed.data.counters },
    },
  }
}

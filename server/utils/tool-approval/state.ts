import { createError } from 'evlog'
import { z } from 'zod'
import {
  TOOL_APPROVAL_CONNECTOR_READ_SOURCE_PREFIX,
  TOOL_APPROVAL_READ_SOURCES_MAX,
  TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH,
  TOOL_APPROVAL_READ_SOURCE_OVERFLOW,
  TOOL_APPROVAL_SERIALIZED_TAINT_MAX,
  TOOL_APPROVAL_STRICTEST_TAINT_KIND,
  TOOL_APPROVAL_TAINT_KINDS,
  TOOL_APPROVAL_TAINT_KIND_MAX_LENGTH,
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

/**
 * `readSources` holds every source the turn has read, including knowledge
 * and past-chat excerpts preset into the prompt (rule 3, cross-source);
 * `toolReadSources` holds only the sources a tool call read during the
 * turn, which is what withholds the provider's own web search.
 */
export interface ApprovalState {
  taint: Set<ToolApprovalTaintKind>
  readSources: Set<string>
  toolReadSources: Set<string>
  counters: ApprovalCounters
}

export interface SerializedApprovalState {
  taint: ToolApprovalTaintKind[]
  readSources: string[]
  toolReadSources: string[]
  counters: ApprovalCounters
}

export type DeserializedApprovalState
  = | { ok: true, state: ApprovalState }
    | { ok: false }

const counterSchema = z.number().int().min(0).max(COUNTER_MAX)

/**
 * A taint kind read back from a stored turn. A kind this version does not
 * know (a record written by a newer or older deploy) becomes the strictest
 * known kind instead of failing the record or being dropped: dropping it
 * would let a later write skip its approval, failing it would turn a paused
 * turn into "expired" for the length of a deploy.
 */
export function toKnownTaintKind(value: string): ToolApprovalTaintKind {
  return isKnownTaintKind(value) ? value : TOOL_APPROVAL_STRICTEST_TAINT_KIND
}

const storedTaintSchema = z.array(
  z.string().min(1).max(TOOL_APPROVAL_TAINT_KIND_MAX_LENGTH),
)
  .max(TOOL_APPROVAL_SERIALIZED_TAINT_MAX)
  .transform((kinds) => {
    return [...new Set(kinds.map(toKnownTaintKind))]
  })

export const serializedApprovalStateSchema = z.object({
  taint: storedTaintSchema,
  readSources: z.array(
    z.string().min(1).max(TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH),
  ).max(TOOL_APPROVAL_READ_SOURCES_MAX),
  toolReadSources: z.array(
    z.string().min(1).max(TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH),
  ).max(TOOL_APPROVAL_READ_SOURCES_MAX).default([]),
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
    toolReadSources: new Set(),
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
 * Records a source a tool call read during the turn: it counts for rule 3
 * like any read (`recordRead`) and also marks the turn as having read
 * private data through a tool. Past the bound the tool set keeps what it
 * has; one entry is enough to withhold the provider's web search.
 */
export function recordToolRead(
  state: ApprovalState,
  source: string,
): ApprovalState {
  recordRead(state, source)

  if (state.toolReadSources.size < TOOL_APPROVAL_READ_SOURCES_MAX) {
    state.toolReadSources.add(source)
  }

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
    toolReadSources: [...state.toolReadSources].sort(),
    counters: { ...state.counters },
  }
}

/**
 * Restores a state written by `serializeApprovalState`. An unknown taint
 * kind is read as the strictest known kind (`toKnownTaintKind`). A value
 * that does not match the schema returns `{ ok: false }`. For a
 * continuation that is a hard refusal: it must never start from a fresh,
 * empty state, because that would drop the taint and the reads of the
 * paused turn and let the resumed turn skip its approvals.
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
      toolReadSources: new Set(parsed.data.toolReadSources),
      counters: { ...parsed.data.counters },
    },
  }
}

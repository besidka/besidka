import { z } from 'zod'
import {
  TOOL_APPROVAL_CONNECTOR_READ_SOURCE_PREFIX,
  TOOL_APPROVAL_READ_SOURCES_MAX,
  TOOL_APPROVAL_READ_SOURCE_MAX_LENGTH,
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

export function recordTaint(
  state: ApprovalState,
  kind: ToolApprovalTaintKind,
): ApprovalState {
  state.taint.add(kind)

  return state
}

export function recordRead(
  state: ApprovalState,
  source: string,
): ApprovalState {
  state.readSources.add(source)

  return state
}

export function incrementCounter(
  state: ApprovalState,
  counter: ApprovalCounterName,
  amount: number = 1,
): ApprovalState {
  state.counters[counter] += amount

  return state
}

export function serializeApprovalState(
  state: ApprovalState,
): SerializedApprovalState {
  return {
    taint: TOOL_APPROVAL_TAINT_KINDS.filter(kind => state.taint.has(kind)),
    readSources: [...state.readSources].sort(),
    counters: { ...state.counters },
  }
}

/**
 * Restores a state written by `serializeApprovalState`. A value that does
 * not match the schema returns `null`; the caller decides whether that means
 * a refused continuation or a fresh, empty state. It never guesses at the
 * missing taint.
 */
export function deserializeApprovalState(
  value: unknown,
): ApprovalState | null {
  const parsed = serializedApprovalStateSchema.safeParse(value)

  if (!parsed.success) {
    return null
  }

  return {
    taint: new Set(parsed.data.taint),
    readSources: new Set(parsed.data.readSources),
    counters: { ...parsed.data.counters },
  }
}

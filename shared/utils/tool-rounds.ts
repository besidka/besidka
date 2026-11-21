import type { ReasoningLevel } from '#shared/types/reasoning.d'

export const TOOL_BUDGET_PART_TYPE = 'data-tool-budget'

/**
 * How many rounds one user message may run in a long connector or Besidka
 * task: the first send plus the automatic continuations of the same reply.
 * Each round is a full send on the user's own key, with its own step, call
 * and time budget.
 */
export const TOOL_ROUNDS_PER_MESSAGE = 10

export const TOOL_BUDGET_REASONS = ['steps', 'calls'] as const

export type ToolBudgetReason = typeof TOOL_BUDGET_REASONS[number]

/**
 * Written by the server as the last part of a reply whose tool loop ran out
 * of steps or calls while the model was still working, so the client can
 * continue the same reply (`round` of `maxRounds`). It carries what the next
 * round sends with, the way an approval's pending record does; the server
 * reads it back from D1, never from the request.
 */
export interface ToolBudgetPartData {
  round: number
  maxRounds: number
  reason: ToolBudgetReason
  model: string
  gateway: string | null
  reasoning: ReasoningLevel
  connectorIds: string[]
}

export interface ToolBudgetDataPart {
  type: typeof TOOL_BUDGET_PART_TYPE
  id?: string
  data: ToolBudgetPartData
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

export function isToolBudgetDataPart(
  part: unknown,
): part is ToolBudgetDataPart {
  if (!isRecord(part) || part.type !== TOOL_BUDGET_PART_TYPE) {
    return false
  }

  const { data } = part

  return isRecord(data)
    && isPositiveInteger(data.round)
    && isPositiveInteger(data.maxRounds)
    && (TOOL_BUDGET_REASONS as readonly unknown[]).includes(data.reason)
    && typeof data.model === 'string'
    && (data.gateway === null || typeof data.gateway === 'string')
    && typeof data.reasoning === 'string'
    && Array.isArray(data.connectorIds)
    && data.connectorIds.every(id => typeof id === 'string')
}

/**
 * The budget part a reply ends with, or null when its last part is
 * anything else: a reply continues only from where its last round stopped.
 */
export function readEndingToolBudget(
  parts: unknown,
): ToolBudgetPartData | null {
  if (!Array.isArray(parts)) {
    return null
  }

  const last = parts.at(-1)

  return isToolBudgetDataPart(last) ? last.data : null
}

/**
 * The highest round any budget part of the reply recorded, 0 when none:
 * the round a later send of the same reply counts from.
 */
export function readLastToolRound(parts: unknown): number {
  if (!Array.isArray(parts)) {
    return 0
  }

  return parts.reduce<number>((round, part) => {
    return isToolBudgetDataPart(part) ? Math.max(round, part.data.round) : round
  }, 0)
}

/**
 * Whether the reply may run another round automatically: it ends with a
 * budget part below the limit.
 */
export function canContinueToolRound(parts: unknown): boolean {
  const budget = readEndingToolBudget(parts)

  return budget !== null && budget.round < budget.maxRounds
}

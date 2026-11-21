import type { ReasoningStep } from '~/types/reasoning-step.d'
import type { ParsedReasoningSection } from '~/utils/reasoning'
import { parseReasoningSections } from '~/utils/reasoning'

const RENDER_MODEL_COMPARE_DEPTH = 6

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * True when two render models hold the same values. Nested objects the AI
 * SDK keeps between stream updates (a tool call's input, a data part's
 * data) are equal by identity, so the walk stops there.
 */
export function isSameRenderModel(
  first: unknown,
  second: unknown,
  depth: number = RENDER_MODEL_COMPARE_DEPTH,
): boolean {
  if (Object.is(first, second)) {
    return true
  }

  if (depth <= 0 || !isObjectLike(first) || !isObjectLike(second)) {
    return false
  }

  if (Array.isArray(first) || Array.isArray(second)) {
    if (!Array.isArray(first) || !Array.isArray(second)) {
      return false
    }

    if (first.length !== second.length) {
      return false
    }

    return first.every((item, index) => {
      return isSameRenderModel(item, second[index], depth - 1)
    })
  }

  const firstKeys = Object.keys(first)

  if (firstKeys.length !== Object.keys(second).length) {
    return false
  }

  return firstKeys.every((key) => {
    return Object.hasOwn(second, key)
      && isSameRenderModel(first[key], second[key], depth - 1)
  })
}

/**
 * Keeps the previous object of every step whose values did not change, so
 * a streamed chunk re-renders only the steps it touched: the AI SDK hands
 * over fresh part objects on every update, which would otherwise give each
 * step component new props. Returns the previous array itself when no step
 * changed, so nothing that reads the steps recomputes.
 */
export function reuseStableReasoningSteps(
  previousSteps: readonly ReasoningStep[],
  nextSteps: ReasoningStep[],
): ReasoningStep[] {
  if (previousSteps.length === 0) {
    return nextSteps
  }

  const previousById = new Map(previousSteps.map((step) => {
    return [step.id, step]
  }))

  let hasChanged = previousSteps.length !== nextSteps.length

  const steps = nextSteps.map((step, index) => {
    const previousStep = previousById.get(step.id)

    if (previousStep && isSameRenderModel(previousStep, step)) {
      hasChanged = hasChanged || previousSteps[index] !== previousStep

      return previousStep
    }

    hasChanged = true

    return step
  })

  return hasChanged ? steps : previousSteps as ReasoningStep[]
}

export interface ReasoningSectionsCache {
  parse: (text: string) => ParsedReasoningSection[]
  commit: () => void
}

/**
 * Parses each reasoning text once: only the part that is still streaming
 * changes between updates. Entries not read since the last `commit` are
 * dropped, so the cache holds one message's texts at most.
 */
export function createReasoningSectionsCache(): ReasoningSectionsCache {
  let entries = new Map<string, ParsedReasoningSection[]>()
  let usedEntries = new Map<string, ParsedReasoningSection[]>()

  return {
    parse: (text) => {
      const sections = usedEntries.get(text)
        ?? entries.get(text)
        ?? parseReasoningSections(text)

      usedEntries.set(text, sections)

      return sections
    },
    commit: () => {
      entries = usedEntries
      usedEntries = new Map()
    },
  }
}

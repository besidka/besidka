import type { FormattedTools } from '~~/server/types/tools.d'
import { stepCountIs } from 'ai'

export const TOOL_LOOP_MAX_STEPS = 3
export const TOOL_LOOP_TOTAL_TIMEOUT_MS = 540_000
export const TOOL_LOOP_TOOL_TIMEOUT_MS = 60_000

interface FollowUpTurnMarker {
  requiresFollowUpTurn: true
}

export interface ToolLoopOptions {
  stopWhen: ReturnType<typeof stepCountIs>
  timeout: {
    totalMs: number
    toolMs: number
  }
}

/**
 * Opts one tool into the multi-step loop: after this tool produces a result,
 * the model gets another turn so it can answer in natural language using that
 * result. Only mark a tool whose result is *input to an answer*, never a tool
 * whose result IS the answer — `generate_image`'s tool result is the rendered
 * deliverable and a follow-up turn there would make the model narrate an
 * image the user can already see, at the price of a second billed generation.
 *
 * Never combine this marker with a forced `toolChoice: { type: 'tool' }`: a
 * forced choice re-selects the same tool on every step, so the loop would run
 * the tool `TOOL_LOOP_MAX_STEPS` times and never produce text.
 */
export function withFollowUpTurn<Tool extends object>(
  tool: Tool,
): Tool & FollowUpTurnMarker {
  return {
    ...tool,
    requiresFollowUpTurn: true,
  }
}

export function toolRequiresFollowUpTurn(tool: unknown): boolean {
  if (typeof tool !== 'object' || tool === null) {
    return false
  }

  return (tool as Record<string, unknown>).requiresFollowUpTurn === true
}

/**
 * The multi-step trigger, deliberately structural and opt-in: a send only
 * gets `stopWhen`/`timeout` when one of its own tools carries the
 * `withFollowUpTurn()` marker. Returning `undefined` is what keeps every
 * other send on `streamText()`'s implicit `stopWhen: isStepCount(1)` default,
 * so the call arguments for those sends stay exactly as they were before the
 * loop existed — see the single-step characterization suite.
 *
 * Having an `execute()` is explicitly NOT the trigger. Image generation is a
 * client-executed tool with a real `execute()` that must stay single-step,
 * and the AI SDK would happily continue past it (its continuation condition
 * only counts client tool calls that produced results) if a blanket
 * `stopWhen` were set.
 *
 * `TOOL_LOOP_MAX_STEPS` is 3: one turn for the model to request the tool, one
 * for it to answer from the result, and one spare for a single refinement
 * round. Each step is a full provider round-trip, and the KV
 * generation-in-progress guard this route sets expires after 600s — so the
 * total budget stays below that, otherwise a client retry arriving after the
 * guard expired would start a second concurrent generation for the same turn.
 */
export function resolveToolLoopOptions(
  tools: FormattedTools['tools'],
): ToolLoopOptions | undefined {
  if (!tools) {
    return undefined
  }

  const hasFollowUpTurnTool = Object.values(tools).some((candidate) => {
    return toolRequiresFollowUpTurn(candidate)
  })

  if (!hasFollowUpTurnTool) {
    return undefined
  }

  return {
    stopWhen: stepCountIs(TOOL_LOOP_MAX_STEPS),
    timeout: {
      totalMs: TOOL_LOOP_TOTAL_TIMEOUT_MS,
      toolMs: TOOL_LOOP_TOOL_TIMEOUT_MS,
    },
  }
}

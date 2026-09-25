import type { Instructions, PrepareStepFunction, ToolSet } from 'ai'
import type { FormattedTools } from '~~/server/types/tools.d'
import { stepCountIs } from 'ai'

export const TOOL_LOOP_MAX_TOOL_STEPS = 3
export const TOOL_LOOP_MAX_STEPS = TOOL_LOOP_MAX_TOOL_STEPS + 1
export const TOOL_LOOP_TOTAL_TIMEOUT_MS = 540_000
export const TOOL_LOOP_TOOL_TIMEOUT_MS = 60_000

const TOOL_LOOP_FINAL_STEP_INSTRUCTIONS = [
  'Your search budget is used up. Answer the user\'s question now using',
  'the search results already gathered above; do not call any more tools.',
].join(' ')

interface FollowUpTurnMarker {
  requiresFollowUpTurn: true
}

export interface ToolLoopOptions {
  stopWhen: ReturnType<typeof stepCountIs>
  timeout: {
    totalMs: number
    toolMs: number
  }
  prepareStep: PrepareStepFunction<ToolSet>
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
 * forced choice re-selects the same tool on every step, defeating the
 * follow-up turn's purpose of letting the model choose to answer instead.
 * `resolveToolLoopOptions()`'s final-step `toolChoice: 'none'` overrides a
 * forced choice for most providers on that last step, but Anthropic gets an
 * instructions-only nudge instead (see that function's doc), so a forced
 * choice there would still win and the loop would exhaust its budget without
 * ever answering.
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

function buildToolLoopFinalStepInstructions(
  instructions: Instructions | undefined,
): string {
  if (typeof instructions !== 'string' || !instructions) {
    return TOOL_LOOP_FINAL_STEP_INSTRUCTIONS
  }

  return `${instructions}\n\n${TOOL_LOOP_FINAL_STEP_INSTRUCTIONS}`
}

/**
 * Forces the loop's last allowed step to answer instead of calling another
 * tool. `stepCountIs(TOOL_LOOP_MAX_STEPS)` stops the loop the instant a step
 * completes, with no regard for whether that step was itself a tool call —
 * without this, the model can spend its entire step budget on tool calls and
 * the send persists zero text.
 *
 * `toolChoice: 'none'` is how every provider except Anthropic is told to
 * stop calling tools. Anthropic is the exception: `@ai-sdk/anthropic@4.0.34`
 * maps `toolChoice: 'none'` to `tools: undefined` on the wire while still
 * sending the prior turns' `tool_use`/`tool_result` message history, and
 * whether Anthropic's API accepts that combination is unverified (no live
 * key to test against). Anthropic instead keeps its tools declared and only
 * gets the instructions addendum, which is a best-effort nudge, not a
 * guarantee — the model can still choose to call a tool on this step.
 */
const toolLoopPrepareStep: PrepareStepFunction<ToolSet> = ({
  stepNumber,
  model,
  instructions,
}) => {
  if (stepNumber !== TOOL_LOOP_MAX_STEPS - 1) {
    return undefined
  }

  const finalInstructions = buildToolLoopFinalStepInstructions(instructions)

  if (typeof model !== 'string' && model.provider.startsWith('anthropic')) {
    return { instructions: finalInstructions }
  }

  return { toolChoice: 'none' as const, instructions: finalInstructions }
}

/**
 * The multi-step trigger, deliberately structural and opt-in: a send only
 * gets `stopWhen`/`timeout`/`prepareStep` when one of its own tools carries
 * the `withFollowUpTurn()` marker. Returning `undefined` is what keeps every
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
 * `TOOL_LOOP_MAX_TOOL_STEPS` search rounds are allowed, then one guaranteed
 * final step (`TOOL_LOOP_MAX_STEPS`) forces an answer — see
 * `toolLoopPrepareStep()` above for how. Each step is a full provider
 * round-trip, and the KV generation-in-progress guard this route sets
 * expires after 600s, so `timeout.totalMs` must stay below that, otherwise a
 * client retry arriving after the guard expired would start a second
 * concurrent generation for the same turn.
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
    prepareStep: toolLoopPrepareStep,
  }
}

import type { Instructions, PrepareStepFunction, ToolSet } from 'ai'
import type { FormattedTools } from '~~/server/types/tools.d'
import { stepCountIs } from 'ai'
import { getGatewayModelProviderPrefix } from '#shared/utils/gateway-model-id'
import { isChatSearchToolName } from '~~/server/utils/ai/chat-search-tools'
import { isMemoryToolName } from '~~/server/utils/ai/memory-tools'

export const TOOL_LOOP_MAX_TOOL_STEPS = 3
export const TOOL_LOOP_MAX_STEPS = TOOL_LOOP_MAX_TOOL_STEPS + 1
export const TOOL_LOOP_TOTAL_TIMEOUT_MS = 540_000
export const TOOL_LOOP_TOOL_TIMEOUT_MS = 60_000
export const TOOL_LOOP_CONTINUATION_TIMEOUT_MS = 90_000

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

export interface UntrustedContentGuard {
  untrustedResultSeen: boolean
}

export interface ToolLoopBudget {
  chatSearchSteps?: number
  guard?: UntrustedContentGuard
}

export interface ResolvedToolLoop {
  options: ToolLoopOptions
  maxSteps: number
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
 * `resolveToolLoopOptions()`'s final step removes the tools for most
 * providers, but Anthropic gets an instructions-only nudge instead (see
 * `createToolLoopPrepareStep()`), so a forced choice there would still win
 * and the loop would exhaust its budget without ever answering.
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

function isBudgetedLookupToolName(toolName: string): boolean {
  return isChatSearchToolName(toolName) || isMemoryToolName(toolName)
}

function isUntrustedToolResultPart(part: unknown): boolean {
  if (typeof part !== 'object' || part === null) {
    return false
  }

  const { type, toolName } = part as { type?: unknown, toolName?: unknown }

  return (type === 'tool-result' || type === 'tool-error')
    && typeof toolName === 'string'
    && !isMemoryToolName(toolName)
}

function stepHasUntrustedToolResult(step: unknown): boolean {
  if (typeof step !== 'object' || step === null) {
    return false
  }

  const { content, toolResults } = step as {
    content?: unknown
    toolResults?: unknown
  }

  return [content, toolResults].some((parts) => {
    return Array.isArray(parts) && parts.some(isUntrustedToolResultPart)
  })
}

function buildToolLoopFinalStepInstructions(
  instructions: Instructions | undefined,
): string {
  if (typeof instructions !== 'string' || !instructions) {
    return TOOL_LOOP_FINAL_STEP_INSTRUCTIONS
  }

  return `${instructions}\n\n${TOOL_LOOP_FINAL_STEP_INSTRUCTIONS}`
}

function isAnthropicGatewayModelId(modelId: string): boolean {
  return getGatewayModelProviderPrefix(modelId).replace(/^~/, '')
    === 'anthropic'
}

/**
 * Forces the loop's last allowed step (`maxSteps - 1`) to answer instead of
 * calling another tool. `stepCountIs(maxSteps)` stops the loop the instant a
 * step completes, with no regard for whether that step was itself a tool
 * call — without this, the model can spend its entire step budget on tool
 * calls and the send persists zero text.
 *
 * `toolChoice: 'none'` alone is not enough: `@ai-sdk/google` still sends the
 * function declarations with `functionCallingConfig.mode: 'NONE'`, and Gemini
 * has been observed ignoring it and calling a tool anyway. `activeTools: []`
 * removes the declarations from the request entirely (the core's
 * `prepareTools()` returns `undefined` for an empty tool set), so the model
 * has nothing left to call.
 *
 * Anthropic is the exception: its API rejects `tool_use`/`tool_result`
 * history sent without tool declarations, so a direct Anthropic model keeps
 * its tools and only gets the instructions addendum, and an Anthropic model
 * routed through a gateway keeps the declarations with `toolChoice: 'none'`.
 * Either can still call a tool on this step; the search-answer continuation
 * in the chat route is what guarantees the turn still ends with an answer.
 *
 * On every step it also inspects the previous steps' tool results, including
 * provider-executed ones such as native web search, and raises
 * `guard.untrustedResultSeen` once any result belongs to a tool that is not a
 * memory tool. The flag is never reset and the declared tools are left
 * untouched, so the memory write tools can refuse the rest of the request
 * without churning the provider's prompt cache.
 */
function createToolLoopPrepareStep(
  maxSteps: number,
  guard: UntrustedContentGuard | undefined,
): PrepareStepFunction<ToolSet> {
  return ({ steps, stepNumber, model, instructions }) => {
    if (guard && !guard.untrustedResultSeen && Array.isArray(steps)) {
      guard.untrustedResultSeen = steps.some(stepHasUntrustedToolResult)
    }

    if (stepNumber !== maxSteps - 1) {
      return undefined
    }

    const finalInstructions = buildToolLoopFinalStepInstructions(instructions)

    if (typeof model === 'string') {
      return { toolChoice: 'none' as const, instructions: finalInstructions }
    }

    if (model.provider.startsWith('anthropic')) {
      return { instructions: finalInstructions }
    }

    if (isAnthropicGatewayModelId(model.modelId)) {
      return { toolChoice: 'none' as const, instructions: finalInstructions }
    }

    return {
      toolChoice: 'none' as const,
      activeTools: [],
      instructions: finalInstructions,
    }
  }
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
 * The step cap is the tool steps plus one guaranteed final step that forces
 * an answer — see `createToolLoopPrepareStep()` above for how.
 * `TOOL_LOOP_MAX_TOOL_STEPS` search rounds are granted when at least one
 * registered follow-up tool is neither a chat-search nor a memory tool (web
 * search), and `chatSearchSteps` more when a chat-search or memory tool is
 * registered, so looking up past chats or memory never eats the web-search
 * rounds. When those lookup tools are the only follow-up tools and
 * `chatSearchSteps` is not positive, the cap
 * falls back to `TOOL_LOOP_MAX_TOOL_STEPS` so the loop never degenerates to a
 * single step. Each step is a full provider round-trip, and the KV
 * generation-in-progress guard this route sets is a short heartbeat-renewed
 * lease (see `generation-guard.ts`), so it stays alive for as long as the
 * loop runs without being sized from these timeouts.
 *
 * Returns the cap next to the options because `ToolLoopOptions` is spread
 * straight into `streamText()` and must not carry extra keys; the chat route
 * reads `maxSteps` to derive the forced-answer step index.
 */
export function resolveToolLoop(
  tools: FormattedTools['tools'],
  budget?: ToolLoopBudget,
): ResolvedToolLoop | undefined {
  if (!tools) {
    return undefined
  }

  const followUpToolNames = Object.entries(tools)
    .filter(([, candidate]) => toolRequiresFollowUpTurn(candidate))
    .map(([toolName]) => toolName)

  if (!followUpToolNames.length) {
    return undefined
  }

  const hasOtherFollowUpTool = followUpToolNames.some((toolName) => {
    return !isBudgetedLookupToolName(toolName)
  })
  const hasChatSearchTool = followUpToolNames.some(isBudgetedLookupToolName)
  const chatSearchSteps = Math.max(0, budget?.chatSearchSteps ?? 0)
  const toolSteps = (hasOtherFollowUpTool ? TOOL_LOOP_MAX_TOOL_STEPS : 0)
    + (hasChatSearchTool ? chatSearchSteps : 0)
  const maxSteps = (toolSteps || TOOL_LOOP_MAX_TOOL_STEPS) + 1

  return {
    options: {
      stopWhen: stepCountIs(maxSteps),
      timeout: {
        totalMs: TOOL_LOOP_TOTAL_TIMEOUT_MS,
        toolMs: TOOL_LOOP_TOOL_TIMEOUT_MS,
      },
      prepareStep: createToolLoopPrepareStep(maxSteps, budget?.guard),
    },
    maxSteps,
  }
}

export function resolveToolLoopOptions(
  tools: FormattedTools['tools'],
  budget?: ToolLoopBudget,
): ToolLoopOptions | undefined {
  return resolveToolLoop(tools, budget)?.options
}

export function getToolLoopMaxSteps(
  tools: FormattedTools['tools'],
  budget?: ToolLoopBudget,
): number | undefined {
  return resolveToolLoop(tools, budget)?.maxSteps
}

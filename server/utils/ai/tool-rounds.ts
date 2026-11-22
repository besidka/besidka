import type { UIMessageChunk } from 'ai'
import {
  TOOL_BUDGET_PART_TYPE,
  TOOL_ROUNDS_PER_MESSAGE,
} from '#shared/utils/tool-rounds'
import type {
  ToolBudgetPartData,
  ToolBudgetReason,
} from '#shared/utils/tool-rounds'

export const TOOL_ROUND_STALE_CODE = 'TOOL_ROUND_STALE'

/**
 * The claim id of one round of a reply in `tool_approval_claims`: a round
 * runs at most once, like an approved call, so two identical requests
 * never run it twice and a round whose Worker died is never re-run.
 */
export function toolRoundClaimId(messageId: string, round: number): string {
  return `round-${messageId}-${round}`
}

/**
 * The user turn a new round of a long tool task adds to the model prompt
 * only: it is never stored or shown, the reply continues in the same
 * message.
 */
export const TOOL_ROUND_CONTINUE_PROMPT = 'Continue the task from where '
  + 'you stopped. Do not repeat what you already did or said.'

/**
 * The instruction of the loop's last, tool-free step in a send that may
 * continue in another round: a short neutral progress note, never a final
 * answer and never a word about budgets.
 */
export const TOOL_ROUND_PROGRESS_INSTRUCTIONS = 'Do not call any more tools '
  + 'in this step. In one or two short sentences, say what you have done so '
  + 'far and what you will do next. The work continues right after this.'

/**
 * The same step in the last round a message may run: a short summary, and
 * the user can send "continue" to go on.
 */
export const TOOL_ROUND_LAST_INSTRUCTIONS = 'Do not call any more tools. '
  + 'Briefly summarize what is done and what is left, and tell the user '
  + 'they can send "continue" to go on.'

export interface ToolRoundOutcome {
  isPaused: boolean
  hadError: boolean
  reachedStepLimit: boolean
  reachedCallLimit: boolean
  ranTaskTools: boolean
}

/**
 * Why a send that ended without an error or a pause stopped while the
 * model was still working: it used every step of its tool loop (`steps`)
 * or hit the per-message connector or Besidka call cap (`calls`). Null when
 * it simply finished, paused for approval, failed, or never ran a connector
 * or Besidka tool.
 */
export function resolveToolBudgetReason(
  outcome: ToolRoundOutcome,
): ToolBudgetReason | null {
  if (outcome.isPaused || outcome.hadError || !outcome.ranTaskTools) {
    return null
  }

  if (outcome.reachedCallLimit) {
    return 'calls'
  }

  return outcome.reachedStepLimit ? 'steps' : null
}

/**
 * The final-step instruction of a send whose round is `round`: progress
 * while rounds remain, a summary in the last one.
 */
export function toolRoundFinalInstructions(round: number): string {
  return round < TOOL_ROUNDS_PER_MESSAGE
    ? TOOL_ROUND_PROGRESS_INSTRUCTIONS
    : TOOL_ROUND_LAST_INSTRUCTIONS
}

/**
 * Writes the `data-tool-budget` part right before the stream's `finish`
 * chunk when `decide` says the send stopped on its budget. Any `error`
 * chunk on the way means no part: a failed send never continues by
 * itself.
 */
export function withToolBudgetPart(
  stream: ReadableStream<UIMessageChunk>,
  decide: (hadError: boolean) => ToolBudgetPartData | null,
): ReadableStream<UIMessageChunk> {
  let hadError = false

  return stream.pipeThrough(new TransformStream<
    UIMessageChunk,
    UIMessageChunk
  >({
    transform(chunk, controller) {
      if (chunk.type === 'error') {
        hadError = true
      }

      if (chunk.type === 'finish') {
        const data = decide(hadError)

        if (data) {
          controller.enqueue({
            type: TOOL_BUDGET_PART_TYPE,
            id: `tool-budget-${data.round}`,
            data,
          })
        }
      }

      controller.enqueue(chunk)
    },
  }))
}

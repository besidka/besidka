import type { UIMessage } from 'ai'
import type { InjectionKey, Ref } from 'vue'
import { readEndingToolBudget } from '#shared/utils/tool-rounds'

export interface ToolRoundRequest {
  messageId: string
  round: number
}

export interface ToolRoundRequestBody {
  continue: ToolRoundRequest
}

/**
 * The next round of a long tool task the last message may run, or null:
 * the last message is an assistant reply that ends with a budget part below
 * the round limit.
 */
export function findNextToolRound(
  messages: readonly UIMessage[],
): ToolRoundRequest | null {
  const last = messages.at(-1)

  if (!last || last.role !== 'assistant') {
    return null
  }

  const budget = readEndingToolBudget(last.parts)

  if (!budget || budget.round >= budget.maxRounds) {
    return null
  }

  return { messageId: last.id, round: budget.round + 1 }
}

export function toolRoundKey(request: ToolRoundRequest): string {
  return `${request.messageId}:${request.round}`
}

/**
 * The round the client may run by itself: a next round exists, it was not
 * requested before, and the user did not stop the task. The caller still
 * holds it while the tab is hidden, so a phone in a pocket never spends
 * rounds unseen.
 */
export function resolveAutoToolRound(
  messages: readonly UIMessage[],
  input: {
    isHalted: boolean
    requestedKeys: ReadonlySet<string>
  },
): ToolRoundRequest | null {
  if (input.isHalted) {
    return null
  }

  const next = findNextToolRound(messages)

  return next && !input.requestedKeys.has(toolRoundKey(next)) ? next : null
}

/**
 * What the chat page offers a long tool task: the round being sent (0 when
 * the request is anything else), whether a request runs, whether the task
 * waits for the user (Stop, an error, or a hidden tab), whether a round was
 * already requested in this page, and the two ways to go on.
 */
export interface ToolRoundController {
  activeRound: Readonly<Ref<number>>
  isRequestActive: Readonly<Ref<boolean>>
  isWaitingForUser: Readonly<Ref<boolean>>
  isRequested: (request: ToolRoundRequest) => boolean
  continueRound: () => Promise<void>
  continueAsNewMessage: () => Promise<void>
}

export const TOOL_ROUND_CONTROLLER_KEY: InjectionKey<
  ToolRoundController
> = Symbol('tool-round-controller')

/**
 * The long-task controller the chat page provides, or null where no chat
 * can continue (shared pages), which renders nothing.
 */
export function useToolRoundController(): ToolRoundController | null {
  return inject(TOOL_ROUND_CONTROLLER_KEY, null)
}

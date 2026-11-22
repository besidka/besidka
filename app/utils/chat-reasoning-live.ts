import type { ChatStatus } from 'ai'

export interface ReasoningLiveProps {
  status: ChatStatus
  isTurnThinkingHeld: boolean
}

/**
 * The chat status and thinking state one message's reasoning panel gets.
 * Only the message that is streaming (the last assistant message) is live;
 * every earlier one gets `ready`, so it neither runs the live timer and
 * shimmer nor auto-expands its steps during a new turn.
 */
export function getReasoningLiveProps(
  isLiveMessage: boolean,
  status: ChatStatus,
  isTurnThinkingHeld: boolean,
): ReasoningLiveProps {
  if (!isLiveMessage) {
    return { status: 'ready', isTurnThinkingHeld: false }
  }

  return { status, isTurnThinkingHeld }
}

import {
  TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN,
  TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN,
  TOOL_APPROVAL_PENDING_PER_MESSAGE,
  TOOL_APPROVAL_ROUNDS_PER_TURN,
} from '#shared/utils/tool-approval-policy'
import type { ToolApprovalDenialReason } from '#shared/utils/tool-approval-policy'

/**
 * Which limit a send refused a call for. `over-cap` alone told the model
 * nothing it could act on (owner report, 2026-11-20: DeepSeek read the bare
 * code as "too many requests at once" and slowed down instead of stopping),
 * so every refusal names its limit and the next step.
 */
export type SendToolDenialKind
  = | Exclude<ToolApprovalDenialReason, 'over-cap'>
    | 'connector-calls'
    | 'built-in-calls'
    | 'pending'
    | 'payload'
    | 'rounds'

export const TOOL_APPROVAL_DENIAL_TEXT: Record<
  ToolApprovalDenialReason,
  string
> = {
  'blocked': 'This tool is blocked in the user\'s settings, so the action '
    + 'did not run.',
  'missing-tool': 'This tool is no longer available, so the action did not '
    + 'run.',
  'definition-drifted': 'This tool changed after the user was asked, so the '
    + 'action did not run. Ask again if it is still needed.',
  'over-cap': 'This message reached its limit of tool calls, so the action '
    + 'did not run. Stop calling tools now. Briefly say what is done and '
    + 'what is left, so the work can continue in the next message.',
  'invalid-input': 'Besidka could not check this action, so it did not run.',
  'google-data': 'This message holds data from the user\'s Google account, '
    + 'so memory writes are unavailable and this action did not run. Do not '
    + 'call memory_write or memory_forget again in this chat. Tell the user '
    + 'nothing was saved or removed, and that memory changes can be made in '
    + 'a chat that holds no Google data.',
}

const STOP_AND_SUMMARIZE = 'Stop calling tools now. Briefly say what is '
  + 'done and what is left, so the work can continue in the next message.'

export const SEND_TOOL_DENIAL_TEXT: Record<SendToolDenialKind, string> = {
  'blocked': TOOL_APPROVAL_DENIAL_TEXT.blocked,
  'missing-tool': TOOL_APPROVAL_DENIAL_TEXT['missing-tool'],
  'definition-drifted': TOOL_APPROVAL_DENIAL_TEXT['definition-drifted'],
  'invalid-input': TOOL_APPROVAL_DENIAL_TEXT['invalid-input'],
  'google-data': TOOL_APPROVAL_DENIAL_TEXT['google-data'],
  'connector-calls': 'This message already made '
    + `${TOOL_APPROVAL_CONNECTOR_CALLS_PER_TURN} connector calls, the most `
    + `one message may make, so this call did not run. ${STOP_AND_SUMMARIZE}`,
  'built-in-calls': 'This message already made '
    + `${TOOL_APPROVAL_BUILT_IN_CALLS_PER_TURN} Besidka tool calls, the most `
    + `one message may make, so this call did not run. ${STOP_AND_SUMMARIZE}`,
  'pending': 'More than '
    + `${TOOL_APPROVAL_PENDING_PER_MESSAGE} calls in one step need the `
    + 'user\'s approval, so this call did not run yet. Make it again after '
    + 'the user answers the others.',
  'payload': 'The input of this call is too large to hold for the user\'s '
    + 'approval, so it did not run. Make the call again with a smaller '
    + 'input, or split it into parts.',
  'rounds': 'This message already asked the user for approval '
    + `${TOOL_APPROVAL_ROUNDS_PER_TURN} times, the most one message may `
    + `ask, so this call did not run. ${STOP_AND_SUMMARIZE}`,
}

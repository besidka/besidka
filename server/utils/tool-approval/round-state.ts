import {
  getConnectorToolPartName,
  parseConnectorToolName,
} from '#shared/utils/connectors-parts'
import { TOOL_APPROVAL_GOOGLE_READ_SOURCE } from '#shared/utils/tool-approval-policy'
import { chatHoldsGoogleData } from '~~/server/utils/tool-approval/google'
import { hasBesidkaToolResult } from '~~/server/utils/tool-approval/send'
import {
  createApprovalState,
  recordTaint,
  recordToolRead,
} from '~~/server/utils/tool-approval/state'
import type { ApprovalState } from '~~/server/utils/tool-approval/state'

/**
 * The approval state a new round of a long tool task starts from: fresh
 * counters (each round has its own call budget) and the taint of the
 * connector, Besidka and Google results the reply already holds, which the
 * model reads again. A Google result also counts as a tool read of the
 * turn, so web search stays withheld in the new round.
 */
export function createToolRoundApprovalState(parts: unknown): ApprovalState {
  const state = createApprovalState()

  if (!Array.isArray(parts)) {
    return state
  }

  for (const part of parts) {
    const toolName = getConnectorToolPartName(part)

    if (toolName && parseConnectorToolName(toolName)) {
      recordTaint(state, 'connector')
    }

    if (hasBesidkaToolResult([part])) {
      recordTaint(state, 'besidka')
    }
  }

  if (chatHoldsGoogleData({ messages: [{ parts }] })) {
    recordTaint(state, 'google')
    recordToolRead(state, TOOL_APPROVAL_GOOGLE_READ_SOURCE)
  }

  return state
}

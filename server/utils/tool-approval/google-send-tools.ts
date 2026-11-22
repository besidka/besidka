import type { ToolSet } from 'ai'
import {
  canOfferGoogleTools,
  isGoogleToolName,
} from '#shared/utils/google-tool-approvals'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { SendToolEntry } from '~~/server/utils/tool-approval/send'

/**
 * The Google tools of one send and their approval entries, built with
 * `buildGoogleApprovalEntry`.
 */
export interface GoogleSendTools {
  tools: ToolSet
  entries: ReadonlyMap<string, SendToolEntry>
}

function noGoogleSendTools(): GoogleSendTools {
  return { tools: {}, entries: new Map() }
}

/**
 * The one place the chat send assembles Google tools. Nothing is offered
 * unless tool approvals are active for the send (`canOfferGoogleTools`):
 * without them no approval, cleared-call guard or references-only rule
 * would run. Nothing is offered either when the send's model may not
 * receive Google data (`mayReceiveGoogleData`, the data guard), because a
 * Google result would reach that model in the next step of the same send.
 * The guard (and its keys read) runs only when `google.drive` is active for
 * the send, so a send that could never get a Google tool reads nothing.
 * The Drive, Calendar and Gmail children add their tools here; until then
 * the set is empty.
 */
export async function getGoogleSendTools(input: {
  toolApprovalsActive: boolean
  googleDriveActive: boolean
  userId: number
  chatPublicId: string
  mayReceiveGoogleData: () => Promise<boolean>
  logger: LoggerLike
}): Promise<GoogleSendTools> {
  if (!canOfferGoogleTools(input) || !input.googleDriveActive) {
    return noGoogleSendTools()
  }

  if (!await input.mayReceiveGoogleData()) {
    input.logger.set({
      attributes: { googleDataGuard: { googleTools: 'recipient-refused' } },
    })

    return noGoogleSendTools()
  }

  return noGoogleSendTools()
}

/**
 * The send's tools with every `google__` tool (any letter case) removed,
 * then the tools `getGoogleSendTools` returned added back: a Google tool
 * reaches the model only through that function, never from another tool
 * source.
 */
export function withGoogleSendTools(
  tools: ToolSet | undefined,
  google: GoogleSendTools,
): ToolSet | undefined {
  const withoutGoogle = Object.fromEntries(
    Object.entries(tools ?? {}).filter(([toolName]) => {
      return !isGoogleToolName(toolName)
    }),
  )
  const merged = { ...withoutGoogle, ...google.tools }

  return tools === undefined && Object.keys(merged).length === 0
    ? tools
    : merged
}

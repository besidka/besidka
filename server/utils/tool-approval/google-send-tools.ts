import type { ToolSet } from 'ai'
import {
  canOfferGoogleTools,
  isGoogleToolName,
} from '#shared/utils/google-tool-approvals'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  buildGoogleSendToolCandidates,
  noGoogleSendTools,
} from '~~/server/utils/tool-approval/google-send-candidates'
import type { GoogleSendTools } from '~~/server/utils/tool-approval/google-send-candidates'

export type { GoogleSendTools }

/**
 * The Google tools a send could register and whether its gateway call
 * carries the Google safeguards, decided together so they cannot drift: a
 * gateway call gets the safeguards when the chat holds Google data or at
 * least one Google tool is a candidate, and only candidates can ever be
 * registered (`getGoogleSendTools`).
 */
export interface GoogleSendPlan {
  candidates: GoogleSendTools
  gatewaySafeguards: boolean
}

function hasGoogleSendTools(google: GoogleSendTools): boolean {
  return google.entries.size > 0 || Object.keys(google.tools).length > 0
}

/**
 * Plans the Google part of one send before the provider or gateway is
 * built. No candidate unless tool approvals are active
 * (`canOfferGoogleTools`: without them no approval, cleared-call guard or
 * references-only rule would run) and `google.drive` is active.
 */
export async function planGoogleSendTools(input: {
  toolApprovalsActive: boolean
  googleDriveActive: boolean
  userId: number
  chatPublicId: string
  gatewayId: string | undefined
  holdsGoogleData: boolean
  logger: LoggerLike
}): Promise<GoogleSendPlan> {
  const candidates = canOfferGoogleTools(input) && input.googleDriveActive
    ? await buildGoogleSendToolCandidates({
      userId: input.userId,
      chatPublicId: input.chatPublicId,
      logger: input.logger,
    })
    : noGoogleSendTools()

  return {
    candidates,
    gatewaySafeguards: !!input.gatewayId
      && (input.holdsGoogleData || hasGoogleSendTools(candidates)),
  }
}

/**
 * The Google tools the send registers: the plan's candidates, and none when
 * the send's model may not receive Google data (`mayReceiveGoogleData`, the
 * data guard, whose gateway condition is the plan's `gatewaySafeguards`),
 * because a Google result would reach that model in the next step of the
 * same send. The guard (and its keys read) runs only when there is a
 * candidate.
 */
export async function getGoogleSendTools(input: {
  plan: GoogleSendPlan
  mayReceiveGoogleData: () => Promise<boolean>
  logger: LoggerLike
}): Promise<GoogleSendTools> {
  if (!hasGoogleSendTools(input.plan.candidates)) {
    return noGoogleSendTools()
  }

  if (!await input.mayReceiveGoogleData()) {
    input.logger.set({
      attributes: { googleDataGuard: { googleTools: 'recipient-refused' } },
    })

    return noGoogleSendTools()
  }

  return input.plan.candidates
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

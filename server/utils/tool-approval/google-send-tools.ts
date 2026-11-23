import type { ToolSet } from 'ai'
import {
  canOfferGoogleTools,
  isGoogleToolName,
} from '#shared/utils/google-tool-approvals'
import type { GoogleToolsWithheldReason } from '#shared/utils/google-tools-withheld'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { GoogleByoFeatureState } from '~~/server/utils/google/byo-access'
import {
  buildGoogleSendToolCandidates,
  noGoogleSendTools,
} from '~~/server/utils/tool-approval/google-send-candidates'
import type { GoogleSendTools } from '~~/server/utils/tool-approval/google-send-candidates'

export type { GoogleSendTools }

/**
 * The Google tools a send could register and whether its gateway call
 * carries the Google safeguards, decided together so they cannot drift: a
 * gateway call gets the safeguards exactly when the chat already holds
 * Google data, and on a gateway only such a chat has candidates at all
 * (a Drive file attached through the Picker flags it), so a Google tool is
 * never registered on a gateway call that does not carry the safeguards,
 * and an ordinary gateway chat sends the request options it always did.
 * Direct providers are unchanged: candidates for any connected user, no
 * gateway options.
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
 * references-only rule would run) and `google.drive` or `google.byo` is
 * active (`google.gmail` adds the Gmail tools, `google.calendar` the Calendar
 * tools).
 */
export async function planGoogleSendTools(input: {
  toolApprovalsActive: boolean
  googleDriveActive: boolean
  googleByoActive?: boolean
  googleGmailActive?: boolean
  googleCalendarActive?: boolean
  userId: number
  chatPublicId: string
  gatewayId: string | undefined
  holdsGoogleData: boolean
  priorGoogleCalls?: number
  priorParts?: readonly unknown[]
  featureState?: GoogleByoFeatureState
  logger: LoggerLike
}): Promise<GoogleSendPlan> {
  const hasGoogleFlag = input.googleDriveActive
    || input.googleByoActive === true
  const mayHaveCandidates = canOfferGoogleTools(input)
    && hasGoogleFlag
    && (!input.gatewayId || input.holdsGoogleData)
  const candidates = mayHaveCandidates
    ? await buildGoogleSendToolCandidates({
      userId: input.userId,
      chatPublicId: input.chatPublicId,
      priorCalls: input.priorGoogleCalls ?? 0,
      driveActive: input.googleDriveActive,
      byoActive: input.googleByoActive === true,
      gmailActive: input.googleGmailActive === true,
      calendarActive: input.googleCalendarActive === true,
      ...(input.featureState ? { featureState: input.featureState } : {}),
      ...(input.priorParts ? { priorParts: input.priorParts } : {}),
      logger: input.logger,
    })
    : noGoogleSendTools()

  if (
    !mayHaveCandidates
    && input.gatewayId
    && !input.holdsGoogleData
    && canOfferGoogleTools(input)
    && hasGoogleFlag
  ) {
    input.logger.set({
      attributes: { googleDataGuard: { googleTools: 'gateway-no-google-data' } },
    })
  }

  return {
    candidates,
    gatewaySafeguards: !!input.gatewayId && input.holdsGoogleData,
  }
}

/**
 * Whether the send declares a provider-run tool that cannot be removed
 * between its steps, so a Drive read in the same send could be followed by
 * a search or a code run that no approval stops: direct Anthropic with any
 * provider tool declared (that route keeps every declaration, because
 * Anthropic rejects tool history without them), and a Qwen send with
 * `enable_search` (a request flag for the whole send). Only a chat that does
 * not hold Google data yet can be in this state; in a flagged chat the
 * send withholds those tools before its first step.
 */
export function hasUnremovableProviderTool(input: {
  isAnthropicRoute: boolean
  tools: ToolSet | undefined
  providerOptions: Record<string, unknown> | undefined
}): boolean {
  const qwenOptions = input.providerOptions?.qwen as
    | { enable_search?: unknown }
    | undefined

  if (qwenOptions?.enable_search === true) {
    return true
  }

  return input.isAnthropicRoute
    && Object.values(input.tools ?? {}).some((declared) => {
      return (declared as { type?: unknown } | null)?.type === 'provider'
    })
}

/**
 * What `getGoogleSendTools` decided: the tools to register and, when there
 * were candidates but none is offered for a reason the user can act on, the
 * reason code the chat shows. No reason for a user without candidates and
 * none for a model without tool calling.
 */
export interface GoogleSendToolsDecision extends GoogleSendTools {
  withheldReason: GoogleToolsWithheldReason | null
}

function withheld(
  reason: GoogleToolsWithheldReason | null,
): GoogleSendToolsDecision {
  return { ...noGoogleSendTools(), withheldReason: reason }
}

/**
 * The Google tools the send registers: the plan's candidates, and none when
 * the send's model may not receive Google data (`mayReceiveGoogleData`, the
 * data guard, whose gateway condition is the plan's `gatewaySafeguards`),
 * because a Google result would reach that model in the next step of the
 * same send. The guard (and its keys read) runs only when there is a
 * candidate. When candidates exist and the send withholds them for the
 * unremovable provider tool or the recipient, the decision carries the
 * reason code (`withheldReason`) so the chat can say why.
 */
export async function getGoogleSendTools(input: {
  plan: GoogleSendPlan
  mayReceiveGoogleData: () => Promise<boolean>
  holdsGoogleData?: boolean
  providerToolsStayCallable?: boolean
  toolCallingAllowed?: boolean
  logger: LoggerLike
}): Promise<GoogleSendToolsDecision> {
  if (!hasGoogleSendTools(input.plan.candidates)) {
    return withheld(null)
  }

  if (input.toolCallingAllowed === false) {
    input.logger.set({
      attributes: { googleDataGuard: { googleTools: 'tool-calling-off' } },
    })

    return withheld(null)
  }

  if (input.providerToolsStayCallable && !input.holdsGoogleData) {
    input.logger.set({
      attributes: { googleDataGuard: { googleTools: 'provider-tools-declared' } },
    })

    return withheld('provider_tool_not_removable')
  }

  if (!await input.mayReceiveGoogleData()) {
    input.logger.set({
      attributes: { googleDataGuard: { googleTools: 'recipient-refused' } },
    })

    return withheld('model_may_not_receive_google_data')
  }

  return { ...input.plan.candidates, withheldReason: null }
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

import { isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import type { UIMessage } from 'ai'
import type { ToolApprovalRemember } from '#shared/utils/tool-approval-policy'

export interface ToolApprovalAnswer {
  approvalId: string
  approved: boolean
  remember?: ToolApprovalRemember
  reason?: string
}

export interface ToolApprovalResponseBody {
  approvalId: string
  approved: boolean
  remember: ToolApprovalRemember
  reason?: string
}

export interface ToolApprovalRequestBody {
  approval: {
    messageId: string
    responses: ToolApprovalResponseBody[]
  }
}

export interface ToolApprovalRememberStore {
  set: (approvalId: string, remember: ToolApprovalRemember) => void
  get: (approvalId: string) => ToolApprovalRemember | undefined
  forget: (approvalIds: readonly string[]) => void
  markSent: (approvalIds: readonly string[]) => void
  wasSent: (approvalId: string) => boolean
  markInFlight: (approvalIds: readonly string[]) => void
  settleInFlight: (isSuccess: boolean) => void
}

/**
 * Keeps the remember choice of each answered approval until the request
 * that carries the answers is built (the AI SDK records only `approved` and
 * `reason` on the tool part), and the ids whose answers already went
 * through, so an automatic resend happens once per answer. Answers count
 * as sent only after a successful response (`settleInFlight(true)`); after
 * an error (409, 429, a network failure) they can be sent again, with
 * their remember choices kept. One store per chat
 * instance, so no state is shared across chats or server requests.
 */
export function createToolApprovalRememberStore(): ToolApprovalRememberStore {
  const choices = new Map<string, ToolApprovalRemember>()
  const sentApprovalIds = new Set<string>()
  let inFlightApprovalIds: string[] = []

  return {
    set: (approvalId, remember) => {
      choices.set(approvalId, remember)
    },
    get: approvalId => choices.get(approvalId),
    forget: (approvalIds) => {
      for (const approvalId of approvalIds) {
        choices.delete(approvalId)
      }
    },
    markSent: (approvalIds) => {
      for (const approvalId of approvalIds) {
        sentApprovalIds.add(approvalId)
      }
    },
    wasSent: approvalId => sentApprovalIds.has(approvalId),
    markInFlight: (approvalIds) => {
      inFlightApprovalIds = [...approvalIds]
    },
    settleInFlight: (isSuccess) => {
      if (isSuccess) {
        for (const approvalId of inFlightApprovalIds) {
          sentApprovalIds.add(approvalId)
          choices.delete(approvalId)
        }
      }

      inFlightApprovalIds = []
    },
  }
}

function readRespondedApproval(part: UIMessage['parts'][number]): {
  approvalId: string
  approved: boolean
  reason?: string
} | null {
  if (!isToolUIPart(part) || part.state !== 'approval-responded') {
    return null
  }

  const { approval } = part

  if (typeof approval?.id !== 'string' || typeof approval.approved !== 'boolean') {
    return null
  }

  return {
    approvalId: approval.id,
    approved: approval.approved,
    ...(typeof approval.reason === 'string' && approval.reason
      ? { reason: approval.reason }
      : {}),
  }
}

/**
 * The body of the request that answers a paused reply, or null when the
 * last message is not an assistant message whose waiting calls are all
 * answered. Only the answers go to the server, with the remember choice
 * from the store (`once` when none was set); the server takes model, tools
 * and inputs from what it stored.
 */
export function buildToolApprovalRequestBody(
  messages: UIMessage[],
  rememberStore?: Pick<ToolApprovalRememberStore, 'get'>,
): ToolApprovalRequestBody | null {
  if (!lastAssistantMessageIsCompleteWithApprovalResponses({ messages })) {
    return null
  }

  const lastMessage = messages[messages.length - 1]

  if (!lastMessage) {
    return null
  }

  const responses = lastMessage.parts.flatMap((part) => {
    const responded = readRespondedApproval(part)

    if (!responded) {
      return []
    }

    return [{
      ...responded,
      remember: rememberStore?.get(responded.approvalId) ?? 'once',
    }]
  })

  if (responses.length === 0) {
    return null
  }

  return {
    approval: {
      messageId: lastMessage.id,
      responses,
    },
  }
}

/**
 * The `sendAutomaticallyWhen` check: true once every waiting call of the
 * last reply is answered and at least one answer was not sent yet. The SDK
 * runs this check after every finished response too, so without the sent
 * ids a response that leaves the answers in place (a "still working"
 * signal, a replay) would resend them in a loop.
 */
export function shouldSendToolApprovalResponses(
  messages: UIMessage[],
  store: Pick<ToolApprovalRememberStore, 'wasSent'>,
): boolean {
  const body = buildToolApprovalRequestBody(messages)

  return Boolean(body?.approval.responses.some((response) => {
    return !store.wasSent(response.approvalId)
  }))
}

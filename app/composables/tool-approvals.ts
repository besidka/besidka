import { isToolUIPart, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai'
import type { UIMessage } from 'ai'
import type { InjectionKey, Ref } from 'vue'
import { parseError } from 'evlog'
import type { ToolApprovalRemember } from '#shared/utils/tool-approval-policy'
import {
  TOOL_APPROVAL_EXPIRED_CODE,
  TOOL_APPROVAL_INTERRUPTED_CODE,
  TOOL_APPROVAL_STALE_CODE,
} from '#shared/utils/tool-approval-policy'

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
  getInFlight: () => readonly string[]
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
    getInFlight: () => inFlightApprovalIds,
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

export type ToolApprovalFailure = 'expired' | 'interrupted'

export type ToolApprovalErrorKind = ToolApprovalFailure | 'retry'

export interface ClassifiedToolApprovalError {
  kind: ToolApprovalErrorKind
  message: string
  why?: string
  fix?: string
}

const EXPIRED_ERROR_CODES = new Set<string>([
  TOOL_APPROVAL_EXPIRED_CODE,
  TOOL_APPROVAL_STALE_CODE,
])

function readErrorBody(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error
  }

  const text = error.message.trim()

  if (!text.startsWith('{')) {
    return error
  }

  try {
    return { data: JSON.parse(text) }
  } catch {
    return error
  }
}

/**
 * Sorts the error of a request that answered approvals: the server's 409
 * codes become `expired` (stale or expired records) or `interrupted`, and
 * anything else (429, 503, a network failure) is `retry`, so the buttons
 * come back. The transport hands over the response body as the error
 * message, which `parseError` reads once it is parsed.
 */
export function classifyToolApprovalError(
  error: unknown,
): ClassifiedToolApprovalError {
  const parsedException = parseError(readErrorBody(error))
  const code = typeof parsedException.code === 'string'
    ? parsedException.code
    : ''
  const kind: ToolApprovalErrorKind = EXPIRED_ERROR_CODES.has(code)
    ? 'expired'
    : code === TOOL_APPROVAL_INTERRUPTED_CODE
      ? 'interrupted'
      : 'retry'

  return {
    kind,
    message: parsedException.message || 'Could not send your answer',
    ...(parsedException.why ? { why: parsedException.why } : {}),
    ...(parsedException.fix ? { fix: parsedException.fix } : {}),
  }
}

/**
 * Puts the answered calls back to `approval-requested`, so their buttons
 * show again after a request that could not deliver the answers (429, 503,
 * a network failure). The SDK only accepts answers for calls in that state.
 */
export function revertToolApprovalResponses(
  messages: UIMessage[],
  approvalIds: readonly string[],
): UIMessage[] {
  if (approvalIds.length === 0) {
    return messages
  }

  const ids = new Set(approvalIds)
  let hasChanged = false

  const nextMessages = messages.map((message) => {
    if (message.role !== 'assistant') {
      return message
    }

    let hasMessageChanged = false

    const parts = message.parts.map((part) => {
      if (
        !isToolUIPart(part)
        || part.state !== 'approval-responded'
        || !ids.has(part.approval.id)
      ) {
        return part
      }

      hasMessageChanged = true

      return {
        ...part,
        state: 'approval-requested',
        approval: { id: part.approval.id },
      } as UIMessage['parts'][number]
    })

    if (!hasMessageChanged) {
      return message
    }

    hasChanged = true

    return { ...message, parts }
  })

  return hasChanged ? nextMessages : messages
}

/**
 * The approval ids of the last message's calls that still wait for an
 * answer, in message order.
 */
export function getPendingToolApprovalIds(
  messages: UIMessage[],
  failures: Readonly<Record<string, ToolApprovalFailure>> = {},
): string[] {
  const lastMessage = messages.at(-1)

  if (lastMessage?.role !== 'assistant') {
    return []
  }

  return lastMessage.parts.flatMap((part) => {
    if (
      !isToolUIPart(part)
      || part.state !== 'approval-requested'
      || typeof part.approval?.id !== 'string'
      || failures[part.approval.id]
    ) {
      return []
    }

    return [part.approval.id]
  })
}

/**
 * The text of the user message a paused reply answered, so "Ask again" can
 * put the original prompt back into the composer.
 */
export function getPromptBeforeMessage(
  messages: UIMessage[],
  messageId: string,
): string {
  const messageIndex = messages.findIndex((message) => {
    return message.id === messageId
  })

  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]

    if (message?.role !== 'user') {
      continue
    }

    return message.parts
      .flatMap(part => (part.type === 'text' ? [part.text] : []))
      .join('\n\n')
      .trim()
  }

  return ''
}

export interface ToolApprovalController {
  isActive: Readonly<Ref<boolean>>
  messages: Readonly<Ref<UIMessage[]>>
  isRequestActive: Readonly<Ref<boolean>>
  pendingApprovalIds: Readonly<Ref<string[]>>
  sendingApprovalIds: Readonly<Ref<readonly string[]>>
  answeredApprovalIds: Readonly<Ref<readonly string[]>>
  failures: Readonly<Ref<Readonly<Record<string, ToolApprovalFailure>>>>
  answeredAt: Readonly<Ref<Readonly<Record<string, number>>>>
  focusRequest: Readonly<Ref<{ approvalId: string, nonce: number } | null>>
  answer: (answer: ToolApprovalAnswer) => Promise<void>
  change: (approvalId: string) => void
  askAgain: (messageId: string) => Promise<void>
  focusFirstPending: () => void
}

export const TOOL_APPROVAL_CONTROLLER_KEY: InjectionKey<
  ToolApprovalController
> = Symbol('tool-approval-controller')

/**
 * The approval controller the chat page provides, or null where no chat can
 * answer (shared pages, other hosts), which renders approvals read-only.
 */
export function useToolApprovalController(): ToolApprovalController | null {
  return inject(TOOL_APPROVAL_CONTROLLER_KEY, null)
}

import type {
  UIMessage,
  TextUIPart,
  SourceUrlUIPart,
  ReasoningUIPart,
  ChatStatus,
} from 'ai'
import type { Ref, ComputedRef } from 'vue'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import type { Chat, Message, Tools } from '#shared/types/chats.d'
import type { FileMetadata } from '#shared/types/files.d'
import type { AttachedArtifact } from '~/types/chat-input-tools'
import type {
  ToolApprovalAnswer,
  ToolApprovalController,
  ToolApprovalFailure,
} from '~/composables/tool-approvals'
import type {
  ToolRoundController,
  ToolRoundRequest,
} from '~/composables/tool-rounds'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type {
  ResearchAnswer,
  ResearchClarificationResponse,
} from '#shared/types/research.d'
import { parseError } from 'evlog'
import { DefaultChatTransport, isToolUIPart } from 'ai'
import { useChat as useChatSdk } from '@ai-sdk/vue'
import { ulid } from 'ulid'
import {
  createClientErrorReportLimiter,
  getGenerationRetryDelayMs,
  isMarkupErrorText,
  toReadableErrorResponse,
  toReadableRequestError,
} from '~/utils/chat-request-errors'
import {
  getGenerateImageToolPart,
  isVisibleGenerateImageToolPart,
} from '~/utils/generated-images'
import {
  hydrateMessageUsage,
  isWebSearchTool,
} from '#shared/utils/message-metadata'
import { isPastChatPreRetrievalPart } from '#shared/utils/past-chat-retrieval'
import {
  ARTIFACT_DATA_PART_TYPE,
  toArtifactAttachmentPart,
} from '#shared/utils/artifacts'
import { CODE_EXECUTION_PART_TYPE } from '#shared/utils/code-execution'
import {
  CONNECTORS_NOTICE_PART_TYPE,
  getConnectorToolCall,
} from '#shared/utils/connectors-parts'
import {
  DOCUMENT_DATA_PART_TYPE,
  isDocumentToolPartType,
} from '#shared/utils/documents'
import { isToolApprovalPart } from '#shared/utils/tool-approval-parts'
import { isArtifactToolPartType } from '~/utils/artifact-parts'
import {
  isPersistedEmptyAnswerFailureText,
  isPersistedOversizedResponseFailureText,
  parsePersistedChatFailureNotice,
} from '#shared/utils/chat-failure-text'
import { CHAT_STREAM_HEARTBEAT_PART_TYPE } from '#shared/utils/chat-stream-heartbeat'

export interface ProcessedMessage {
  message: UIMessage
  reasoningParts: ReasoningUIPart[]
  textParts: TextUIPart[]
  sourceUrlParts: SourceUrlUIPart[]
}

export interface ChatErrorTextPart extends TextUIPart {
  error: ChatErrorPayload
}

interface NormalizeChatClientErrorOptions {
  requestId?: string
}

interface ChatClientErrorReport {
  message: string
  code: ChatErrorPayload['code']
  requestId: string
  chatId: string
  modelId: string
  providerId?: string
  reason?: string
  status?: number
  transportRequestId?: string
}

function isTransportLoadErrorMessage(message: string | undefined): boolean {
  const normalizedMessage = message?.trim().toLowerCase() || ''

  if (!normalizedMessage) {
    return false
  }

  return normalizedMessage.includes('load error')
    || normalizedMessage.includes('failed to fetch')
    || normalizedMessage.includes('networkerror')
    || normalizedMessage.includes('network request failed')
    || normalizedMessage.includes('the response body is empty')
    || normalizedMessage.includes('load failed')
    || normalizedMessage.includes('fetch failed')
    || normalizedMessage.includes('terminated')
}

function isTransportLoadError(error: ChatErrorPayload): boolean {
  return error.message === 'The chat response failed to load.'
    || isTransportLoadErrorMessage(error.why)
    || isTransportLoadErrorMessage(error.message)
}

export interface TransportInterruptionFlags {
  isAbort: boolean
  isDisconnect: boolean
  isTestChat: boolean
}

// Issue #275: the AI SDK's own isDisconnect flag only fires for a TypeError
// whose message contains "fetch" or "network" — it never matches Safari's
// actual wording ("Load failed") for a connection killed by iOS suspending
// the page. isTransportLoadError() is this codebase's broader, already-
// proven recognizer for that whole error family (issue #263), so this checks
// both rather than trusting the SDK flag alone. A turn flagged this way
// should auto-recover silently (no error bubble, automatic resend) instead
// of surfacing as a user-facing failure. Scoped off for isAbort (the user
// deliberately stopped — never auto-resume that) and the dev test route
// (deliberately simulated errors must still render as errors there).
export function isAutoRecoverableTransportInterruption(
  error: ChatErrorPayload | null,
  flags: TransportInterruptionFlags,
): boolean {
  if (flags.isTestChat || flags.isAbort) {
    return false
  }

  return flags.isDisconnect || (error ? isTransportLoadError(error) : false)
}

// Decides whether a just-completed turn is worth the "you were away when
// this finished" contextual disclosure (issue #275 follow-up). Two distinct
// signals, not one sticky "was the tab ever hidden" flag: a plain
// visibility check alone would false-positive whenever the user backgrounds
// the tab and returns *before* generation finishes (they end up watching it
// complete live, not away when it lands) — hadInterruptionThisTurn instead
// tracks only whether the turn actually had to auto-recover from a
// connection interruption (iOS-suspension scenario), which by definition
// only resolves once the user is back regardless of what the page's live
// visibility state reads by that point.
export function shouldNotifyGenerationReadyWhileHidden(
  hadInterruptionThisTurn: boolean,
  visibilityState: DocumentVisibilityState,
): boolean {
  return hadInterruptionThisTurn || visibilityState === 'hidden'
}

function isChatErrorPayload(value: unknown): value is ChatErrorPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const payload = value as Partial<ChatErrorPayload>

  return typeof payload.code === 'string'
    && typeof payload.message === 'string'
}

function normalizeGenericJsonErrorPayload(
  value: unknown,
  requestId: string | undefined,
): ChatErrorPayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const payload = value as {
    message?: unknown
    status?: unknown
    statusCode?: unknown
    statusMessage?: unknown
    why?: unknown
    fix?: unknown
  }
  const message = typeof payload.message === 'string'
    ? payload.message
    : typeof payload.statusMessage === 'string'
      ? payload.statusMessage
      : null

  if (!message) {
    return null
  }

  return {
    code: 'unknown',
    message,
    why: typeof payload.why === 'string'
      ? payload.why
      : undefined,
    fix: typeof payload.fix === 'string'
      ? payload.fix
      : undefined,
    status: typeof payload.status === 'number'
      ? payload.status
      : typeof payload.statusCode === 'number'
        ? payload.statusCode
        : undefined,
    requestId,
  }
}

export function normalizeChatClientError(
  error: unknown,
  options: NormalizeChatClientErrorOptions = {},
): ChatErrorPayload {
  if (error instanceof Error && error.message.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(error.message) as ChatErrorPayload

      if (isChatErrorPayload(parsed)) {
        return parsed
      }

      const genericPayload = normalizeGenericJsonErrorPayload(
        parsed,
        options.requestId,
      )

      if (genericPayload) {
        return genericPayload
      }
    } catch (exception) {
      void exception
    }
  }

  const parsedException = parseError(error)
  const requestId = options.requestId || ulid().toLowerCase()

  if (isMarkupErrorText(parsedException.message)) {
    return toReadableRequestError({
      status: parsedException.status,
      bodyText: parsedException.message,
      requestId: options.requestId,
    })
  }

  if (isTransportLoadErrorMessage(parsedException.message)) {
    return {
      code: 'unknown',
      message: 'The chat response failed to load.',
      why: 'The connection was interrupted before the response finished streaming.',
      fix: 'Retry the message. If it keeps failing, contact support with the request ID.',
      status: parsedException.status,
      requestId,
    }
  }

  return {
    code: 'unknown',
    message: parsedException.message || 'The chat request failed.',
    why: parsedException.why,
    fix: parsedException.fix,
    status: parsedException.status,
    requestId: options.requestId,
  }
}

export function shouldSurfaceEmptyAssistantResponse(
  messages: UIMessage[],
): boolean {
  const lastMessage = messages[messages.length - 1]

  if (!lastMessage) {
    return true
  }

  if (lastMessage.role === 'user') {
    return true
  }

  if (lastMessage.role !== 'assistant') {
    return false
  }

  return !hasMeaningfulAssistantParts(lastMessage)
}

function hasMeaningfulPersistedAssistantParts(
  parts: UIMessage['parts'],
): boolean {
  return parts.some((part) => {
    if (part.type === 'text' || part.type === 'reasoning') {
      return Boolean(part.text?.trim().length)
    }

    return part.type === 'file'
      || part.type === 'source-url'
      || isToolApprovalPart(part)
      || part.type === ARTIFACT_DATA_PART_TYPE
      || part.type === DOCUMENT_DATA_PART_TYPE
      || (
        isDocumentToolPartType(part.type)
        && 'state' in part
        && part.state === 'output-error'
      )
      || (
        part.type === CODE_EXECUTION_PART_TYPE
        && (
          part.state === 'output-available'
          || part.state === 'output-error'
        )
      )
      || (
        (part.type === 'tool-create_artifact'
          || part.type === 'tool-update_artifact')
        && part.state === 'output-error'
      )
      || (
        part.type === 'tool-generate_image'
        && (
          part.state === 'output-available'
          || part.state === 'output-error'
        )
      )
      || (
        getConnectorToolCall(part) !== null
        && (
          (part as { state?: string }).state === 'output-available'
          || (part as { state?: string }).state === 'output-error'
        )
      )
  })
}

export function isFailureOnlyAssistantMessage(
  message: UIMessage | undefined,
): boolean {
  if (!message || message.role !== 'assistant' || !message.parts?.length) {
    return false
  }

  const hasUnconditionalFailureText = message.parts.some((part) => {
    return part.type === 'text'
      && (
        isPersistedEmptyAnswerFailureText(part.text)
        || isPersistedOversizedResponseFailureText(part.text)
      )
  })

  if (hasUnconditionalFailureText) {
    return true
  }

  const partsWithoutFailureText = message.parts.filter((part) => {
    return part.type !== 'text'
      || !parsePersistedChatFailureNotice(part.text)
  })

  return !hasMeaningfulPersistedAssistantParts(partsWithoutFailureText)
}

export function hasRetryableAssistantFailure(messages: UIMessage[]): boolean {
  const lastMessage = messages.at(-1)
  const previousMessage = messages.at(-2)

  if (lastMessage?.role !== 'assistant' || previousMessage?.role !== 'user') {
    return false
  }

  return !hasMeaningfulAssistantParts(lastMessage)
    || isFailureOnlyAssistantMessage(lastMessage)
}

// Issue #275: iOS suspends the page on screen-lock or app-switch with no
// grace period, killing the in-flight stream client-side while the server
// (per the tee+persist pipeline below) keeps generating regardless. On
// visibilitychange/focus, this decides whether the chat looks like it was
// cut off mid-turn and should auto-retrigger the existing disconnect-replay
// path (issue #263) instead of waiting for the user to notice and click
// Regenerate.
export function shouldRecoverInterruptedGeneration(
  status: ChatStatus,
  messages: UIMessage[],
): boolean {
  if (status === 'streaming' || status === 'submitted') {
    return false
  }

  return shouldSurfaceEmptyAssistantResponse(messages)
}

// A freshly-created assistant message starts with empty `parts: []` and is
// only populated into `chatSdk.messages` on the stream's first `write()`
// call (the `start` chunk), which renders before `start-step`/`text-start`
// give it real parts. During that window `hasRetryableAssistantFailure`
// reads as true for an in-progress turn, not a failed one, and would show
// Regenerate alongside Stop. This mirrors displayStop's own generating
// check (including its `!isStopped` escape hatch for the abort→ready
// transition) so a genuinely failed/errored turn still shows Regenerate.
/**
 * The "Waiting for the previous reply to stop" loader of a fresh send shows
 * only while no assistant bubble with content ends the chat: a partial
 * reply or a reasoning step on screen already says something is happening,
 * and two assistant bubbles at once read as two replies. A continuation
 * (approval answers, a tool round) always continues the assistant message
 * on screen, so its wait always shows the loader.
 */
export function shouldShowWaitingLoader(
  waitingSince: number,
  lastMessage: UIMessage | undefined,
  isContinuation: boolean = false,
): boolean {
  if (waitingSince <= 0) {
    return false
  }

  return isContinuation || !hasVisibleAssistantContent(lastMessage)
}

export function shouldDisplayRegenerate(
  status: ChatStatus,
  isStopped: boolean,
  messages: UIMessage[],
  isResearchModelSelected: boolean,
): boolean {
  const isActivelyGenerating = ['submitted', 'streaming'].includes(status)
    && !isStopped

  if (isActivelyGenerating) {
    return false
  }

  return (
    isStopped
    || status === 'error'
    || hasRetryableAssistantFailure(messages)
  )
  && !isResearchModelSelected
}

// Issue #263/#268 follow-up: recovery/regenerate of an unanswered last user
// turn must never hit the streaming endpoint for a deep-research chat —
// research turns are answered asynchronously by the poll loop, and the
// streaming endpoint 400s for DR models. `userModel` is a global preference
// (see useUserModel), decoupled from the chat it currently renders, so it can
// drift after a mid-session model switch — the model check alone is not
// robust. A present research job of ANY status (including a canceled one
// still held in memory this session) is a model-independent second signal,
// so a present job or a DR model selected either one marks this a research
// context that must not auto-regenerate through the normal chat endpoint.
export function shouldBlockGenerationRecovery(
  isDeepResearchModelSelected: boolean,
  hasResearchJob: boolean,
): boolean {
  return isDeepResearchModelSelected || hasResearchJob
}

// Issue #275 mount-time recovery: a chat whose last message is the user's
// unanswered prompt (including a fresh single-message chat) means the
// previous attempt never persisted before this load, so it should
// auto-regenerate. A chat whose last message is the assistant's is already
// answered and must never regenerate — otherwise `ai@7`'s regenerate()
// resolves messageIndex to that assistant message and slices the history
// down to nothing before sending the request.
export function shouldRecoverGeneration(messages: UIMessage[]): boolean {
  return messages.at(-1)?.role === 'user'
}

export function buildChatErrorLines(error: ChatErrorPayload): string[] {
  const lines = [error.message]

  if (error.why) {
    lines.push(error.why)
  }

  if (error.fix) {
    lines.push(error.fix)
  }

  if (error.providerRequestId) {
    lines.push(`Provider request ID: ${error.providerRequestId}`)
  } else if (error.requestId) {
    lines.push(`Request ID: ${error.requestId}`)
  }

  return lines
}

export function buildChatErrorMessage(error: ChatErrorPayload): string {
  return buildChatErrorLines(error).join('\n\n')
}

function isRateLimitError(error: ChatErrorPayload): boolean {
  if (error.code === 'provider-rate-limit') {
    return true
  }

  const text = `${error.message || ''}\n${error.why || ''}`.toLowerCase()

  return text.includes('rate limit')
    || text.includes('tokens per min')
    || text.includes('too many requests')
    || text.includes('try again in')
}

export function isChatErrorTextPart(
  part: UIMessage['parts'][number] | undefined,
): part is ChatErrorTextPart {
  if (!part || part.type !== 'text') {
    return false
  }

  const record = part as Record<string, unknown>

  return Boolean(
    record.error
    && typeof record.error === 'object'
    && typeof (record.error as ChatErrorPayload).message === 'string',
  )
}

export function hasVisibleAssistantContent(message: UIMessage | undefined) {
  if (!message || message.role !== 'assistant') {
    return false
  }

  return message.parts?.some((part) => {
    if (
      part.type === 'file'
      || part.type === ARTIFACT_DATA_PART_TYPE
      || isArtifactToolPartType(part.type)
      || part.type === DOCUMENT_DATA_PART_TYPE
      || isDocumentToolPartType(part.type)
      || part.type === CODE_EXECUTION_PART_TYPE
      || isVisibleGenerateImageToolPart(part)
    ) {
      return true
    }

    // A non-image tool part alone (no reasoning, no text yet) must count as
    // visible content, otherwise shouldDisplayMessage hides the whole
    // message bubble and the reasoning box's tool-call step can never
    // render — this is a load-bearing dependency of the tool-call-as-
    // reasoning-step feature, not a cosmetic change.
    if (isThinkingToolPart(part)) {
      return true
    }

    if (
      part.type !== 'text'
      && part.type !== 'reasoning'
    ) {
      return false
    }

    return Boolean(part.text?.trim().length)
  }) || false
}

// isAwaitingGeneration only needs to force the generic loading indicator for
// the idle gaps between recovery polls, when there is nothing else on screen
// to show it's still working — once a recovered stream is actively producing
// visible reasoning/text again, that message bubble already is the loading
// indicator, and showing this one too underneath it is pure duplication
// (issue #275 follow-up: reported as two bubbles after returning from an app
// switch mid-generation).
export function shouldForceGenericLoadingIndicator(
  isAwaitingGeneration: boolean,
  lastMessage: UIMessage | undefined,
): boolean {
  return isAwaitingGeneration && !hasVisibleAssistantContent(lastMessage)
}

export function shouldShowGenericLoadingIndicator(
  status: ChatStatus,
  isAwaitingGeneration: boolean,
  lastMessage: UIMessage | undefined,
): boolean {
  if (hasVisibleAssistantContent(lastMessage)) {
    return false
  }

  if (shouldForceGenericLoadingIndicator(
    isAwaitingGeneration,
    lastMessage,
  )) {
    return true
  }

  if (status === 'submitted') {
    return true
  }

  if (status !== 'streaming' || lastMessage?.role !== 'assistant') {
    return false
  }

  return !hasVisibleAssistantContent(lastMessage)
}

// The AI SDK Vue adapter keeps `messages` in a shallowRef, mutates it in place
// (push / element replace), and signals updates via triggerRef. Feeding that
// same array reference straight through a computed is a trap: Vue 3.4+ compares
// a computed's new result against its previous one and, when they are === (the
// same array), suppresses the downstream notification entirely. Message-content
// changes then never reach template bindings that depend only on the messages
// (e.g. shouldDisplayMessage's data-hide-content), so a fully streamed reply
// can stay display:hidden until an unrelated re-render reads the live array.
// Returning a fresh array on every call gives the computed a new identity per
// SDK trigger, so those bindings react. Do NOT change these to `return
// messages`.
export function getRenderableChatMessages(
  messages: UIMessage[],
): UIMessage[] {
  const lastMessage = messages.at(-1)

  if (!lastMessage || lastMessage.role !== 'assistant') {
    return [...messages]
  }

  const hasImageToolPart = lastMessage.parts.some((part) => {
    return getGenerateImageToolPart(part) !== null
  })

  if (!hasImageToolPart) {
    return [...messages]
  }

  return [
    ...messages.slice(0, -1),
    {
      ...lastMessage,
      parts: lastMessage.parts.map((part) => {
        return getGenerateImageToolPart(part) ? { ...part } : part
      }),
    } as UIMessage,
  ]
}

export function hasMeaningfulAssistantParts(message: UIMessage | undefined) {
  if (!message || message.role !== 'assistant') {
    return false
  }

  if (!message.parts?.length) {
    return false
  }

  return message.parts.some((part) => {
    if (
      part.type === 'text'
      || part.type === 'reasoning'
    ) {
      return Boolean(part.text?.trim().length)
    }

    return part.type !== 'data-omitted-context-files'
      && part.type !== CONNECTORS_NOTICE_PART_TYPE
      && !isPastChatPreRetrievalPart(part)
  })
}

export function applyChatErrorToMessages(
  messages: UIMessage[],
  error: ChatErrorPayload,
): UIMessage[] {
  const nextMessages = [...messages]
  const errorText = buildChatErrorMessage(error)
  const lastMessage = nextMessages[nextMessages.length - 1]
  const errorPart = {
    type: 'text',
    text: errorText,
    error,
  } as unknown as TextUIPart
  const errorMessage: UIMessage = {
    id: ulid(),
    role: 'assistant',
    parts: [errorPart],
    createdAt: new Date(),
  } as UIMessage

  if (lastMessage?.role === 'assistant') {
    nextMessages[nextMessages.length - 1] = {
      ...lastMessage,
      parts: hasMeaningfulAssistantParts(lastMessage)
        ? [...lastMessage.parts, ...errorMessage.parts]
        : errorMessage.parts,
    } as UIMessage

    return nextMessages
  }

  nextMessages.push(errorMessage)

  return nextMessages
}

export function shouldSurfaceChatError(
  messages: UIMessage[],
  error: ChatErrorPayload,
): boolean {
  const lastMessage = messages[messages.length - 1]

  if (
    isRateLimitError(error)
    && hasVisibleAssistantContent(lastMessage)
  ) {
    return false
  }

  return true
}

function showChatError(
  messages: UIMessage[],
  error: ChatErrorPayload,
): UIMessage[] {
  useErrorMessage(
    error.message,
    error.why
    || error.fix
    || error.providerRequestId
    || error.requestId,
  )

  return applyChatErrorToMessages(messages, error)
}

const CLIENT_ERRORS_PATH = '/api/v1/chats/client-errors'
const clientErrorReportLimiter = createClientErrorReportLimiter({
  maxPerWindow: 3,
  windowMs: 60_000,
  maxPerSession: 10,
})

/**
 * Whether a client error report may go out: never one about the reporter's
 * own request, and only within the page session's limits.
 */
export function shouldSendChatClientErrorReport(
  payload: Pick<ChatClientErrorReport, 'code' | 'message' | 'reason'>,
  limiter = clientErrorReportLimiter,
): boolean {
  const isAboutReporter = [payload.message, payload.reason].some((text) => {
    return !!text?.includes(CLIENT_ERRORS_PATH)
  })

  if (isAboutReporter) {
    return false
  }

  return limiter.allow(
    [payload.code, payload.message, payload.reason ?? ''].join('|'),
  )
}

function reportChatClientError(payload: ChatClientErrorReport) {
  if (!import.meta.client) {
    return
  }

  if (!shouldSendChatClientErrorReport(payload)) {
    return
  }

  const body = JSON.stringify(payload)

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], {
        type: 'application/json',
      })

      navigator.sendBeacon(CLIENT_ERRORS_PATH, blob)

      return
    }
  } catch (exception) {
    void exception
  }

  globalThis.fetch(CLIENT_ERRORS_PATH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    keepalive: true,
  }).catch((exception) => {
    void exception
  })
}

const STOP_REQUEST_WAIT_MS = 2_000

// Bounds how long the client keeps polling a "still generating" turn (issue
// #275) before giving up and falling back to the manual Regenerate button.
// The resends back off (getGenerationRetryDelayMs: 4 s, 8 s, then 15 s), so
// 42 attempts still cover about 10 minutes, well past the 2-3 min
// generations from the bug report.
const MAX_GENERATION_RETRY_ATTEMPTS = 42
const STREAM_PUBLISH_THROTTLE_MS = 50
const STREAM_STALL_TIMEOUT_MS = 45_000
const STREAM_STALL_CHECK_INTERVAL_MS = 5_000

// A turn counts as active "thinking" while the last message is the
// assistant's in-progress reply and EITHER at least one of its reasoning
// parts is still being streamed by the provider or a non-image tool call is
// currently in flight (never inferred from the presence of a text part
// ALONE, since xAI/OpenAI-agentic/Google turns can reopen reasoning or call
// tools after a gap that already produced visible text) OR no text part has
// appeared at all yet. That second clause covers both the moment before the
// very first token and the real multi-second gap after reasoning/tool calls
// finish but before the model's answer starts streaming — there is no SDK
// event to hook into for that gap, so absence of text is the only signal.
export function isReasoningActiveForTurn(
  status: ChatStatus,
  lastMessage: UIMessage | undefined,
): boolean {
  if (status !== 'streaming') {
    return false
  }

  if (lastMessage?.role !== 'assistant') {
    return false
  }

  return isThinkingActive(lastMessage.parts)
    || !hasAnyTextPart(lastMessage.parts)
}

export const REASONING_SEGMENT_GRACE_WINDOW_MS = 500

export interface ReasoningSegmentTracker {
  accumulatedMs: Ref<number>
  segmentStartedAt: Ref<number>
  isTurnThinkingHeld: ComputedRef<boolean>
  reset: () => void
}

// Wraps the raw, un-debounced isTurnReasoningActive signal with hysteresis so
// a genuinely momentary part-level gap (xAI settling one web search and
// opening the next as two fully separate SDK events leaves a real sub-second
// gap with nothing pending, confirmed via a live recording) doesn't fold the
// segment and restart the "time spent thinking" clock or flip the header
// wording several times a second. A real end of turn — status itself leaving
// 'streaming' — still folds immediately, since there is no more turn left to
// resume within.
export function createReasoningSegmentTracker(
  isTurnReasoningActive: Ref<boolean>,
  isTurnStreaming: () => boolean,
): ReasoningSegmentTracker {
  const accumulatedMs = shallowRef<number>(0)
  const segmentStartedAt = shallowRef<number>(0)
  let pendingFoldTimeoutId: ReturnType<typeof setTimeout> | null = null

  const isTurnThinkingHeld = computed<boolean>(() => {
    return segmentStartedAt.value !== 0
  })

  function clearPendingFold(): void {
    if (pendingFoldTimeoutId === null) {
      return
    }

    clearTimeout(pendingFoldTimeoutId)
    pendingFoldTimeoutId = null
  }

  function fold(endedAt: number): void {
    accumulatedMs.value = foldReasoningSegment(
      true,
      accumulatedMs.value,
      segmentStartedAt.value,
      endedAt,
    )
    segmentStartedAt.value = 0
  }

  watch(isTurnReasoningActive, (isActive) => {
    if (isActive) {
      clearPendingFold()

      if (!segmentStartedAt.value) {
        segmentStartedAt.value = Date.now()
      }

      return
    }

    if (!isTurnStreaming()) {
      clearPendingFold()
      fold(Date.now())

      return
    }

    // Captured now, at the false edge -- not inside the timeout callback --
    // so a gap that is never recovered folds as ending here, not 500ms later.
    // Using the timer's own fire time would silently pad every unrecovered
    // gap's "time spent thinking" by up to the grace window itself.
    const goneInactiveAt = Date.now()

    clearPendingFold()
    pendingFoldTimeoutId = setTimeout(() => {
      pendingFoldTimeoutId = null
      fold(goneInactiveAt)
    }, REASONING_SEGMENT_GRACE_WINDOW_MS)
  })

  function reset(): void {
    clearPendingFold()
    accumulatedMs.value = 0
    segmentStartedAt.value = 0
  }

  return {
    accumulatedMs,
    segmentStartedAt,
    isTurnThinkingHeld,
    reset,
  }
}

// Folds a just-ended thinking segment (streaming reasoning or an in-flight
// tool call) duration into the running total. wasActive false or a missing
// segmentStartedAt means there was no live segment to fold (e.g. the very
// first evaluation, or a turn that never reasoned at all), so the
// accumulated total is returned unchanged.
export function foldReasoningSegment(
  wasActive: boolean,
  accumulatedMs: number,
  segmentStartedAt: number,
  now: number,
): number {
  if (!wasActive || !segmentStartedAt) {
    return accumulatedMs
  }

  return accumulatedMs + (now - segmentStartedAt)
}

export function findLastUserMessageTools(messages: Message[]): Tools {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index]

    if (candidate?.role === 'user') {
      return candidate.tools || []
    }
  }

  return []
}

/**
 * The reasoning level a reopened chat continues with: the last user
 * message's, or `null` when the chat has no user message yet (a new chat).
 */
export function findLastUserMessageReasoning(
  messages: Message[],
): ReasoningLevel | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index]

    if (candidate?.role === 'user') {
      return normalizeReasoningLevel(candidate.reasoning)
    }
  }

  return null
}

export interface InitialChatToolsPreferences {
  isAutoWebSearchPreferred: boolean
  savedWebSearchTool: string | null
}

/**
 * The tools a reopened chat starts with: the last user message's. An Auto
 * web search skip persists that message without its search tool, so while
 * Auto is preferred an empty set whose turn was skipped, or is still
 * unanswered (a new chat's first message), falls back to the saved
 * provider instead of showing search as off.
 */
export function resolveInitialChatTools(
  messages: Message[],
  preferences: InitialChatToolsPreferences,
): Tools {
  const lastUserTools = findLastUserMessageTools(messages)
  const tools = messages.at(-1)?.role === 'user'
    ? lastUserTools
    : stripCodeExecutionTool(lastUserTools)
  const savedTool = preferences.savedWebSearchTool

  if (
    tools.length > 0
    || !preferences.isAutoWebSearchPreferred
    || !isWebSearchTool(savedTool)
  ) {
    return tools
  }

  const lastUserIndex = messages.findLastIndex((message) => {
    return message.role === 'user'
  })

  if (lastUserIndex < 0) {
    return tools
  }

  const reply = messages.slice(lastUserIndex + 1).find((message) => {
    return message.role === 'assistant'
  })

  if (reply && reply.usage?.autoWebSearch !== 'skipped') {
    return tools
  }

  return [savedTool]
}

export function useChat(chat: MaybeRefOrGetter<Chat>) {
  const { selection, userModel } = useUserModel()
  const { handleConsentError } = useLegalConsent()
  const { isModelCapabilityResolved } = useChatInput()
  const {
    isPreferred: isAutoWebSearchPreferred,
    resolveWebSearchMode,
  } = useAutoWebSearch()
  const connectorsFeature = useFeature('connectors')
  const { selection: connectorSelection } = useChatConnectorSelection()
  const isBesidkaToolsAvailable = useBesidkaToolsAvailability()
  const { selection: besidkaToolsSelection } = useBesidkaToolsSelection()
  const isStopped = shallowRef<boolean>(false)
  const prefStorage = usePreferenceStorage()
  // App-wide signal for whether any chat turn is actively streaming, read by
  // the PWA Refresher to avoid auto-applying a service-worker update (and
  // reloading the page) mid-response. Scoped to 'submitted'/'streaming'
  // rather than isLoading's broader definition, since those are the only
  // statuses where a reload would actually cut off in-flight generation.
  const isChatStreaming = useState<boolean>('chat-streaming', () => false)
  const input = customRef<string>((track, trigger) => ({
    get() {
      track()

      return prefStorage.getItem('chat_input') ?? ''
    },
    set(value) {
      prefStorage.setItem('chat_input', value)
      trigger()
    },
  }))
  const files = ref<FileMetadata[]>([])
  const attachedArtifacts = ref<AttachedArtifact[]>([])
  const composerSkillInvocation = useComposerSkillInvocation()
  const composerBuiltinCommand = useComposerBuiltinCommand()
  const pendingError = shallowRef<ChatErrorPayload | null>(null)
  const transportRequestId = shallowRef<string>()
  const reportedClientErrorIds = new Set<string>()

  chat = toValue(chat)

  const chatSlug = chat.slug

  const tools = shallowRef<Tools>(resolveInitialChatTools(chat.messages, {
    isAutoWebSearchPreferred: isAutoWebSearchPreferred.value,
    savedWebSearchTool: prefStorage.getItem('settings_web_search_tool'),
  }))
  const { defaultReasoningLevel } = useUserSetting()
  const reasoning = shallowRef<ReasoningLevel>(
    findLastUserMessageReasoning(chat.messages)
    ?? resolveInitialReasoningLevel(
      defaultReasoningLevel.value,
      prefStorage.getItem('settings_reasoning_level'),
    ),
  )
  const pendingClarification = shallowRef<
    ResearchClarificationResponse | null
  >(null)
  const isClarifying = shallowRef<boolean>(false)
  const pendingResearchTopic = shallowRef<string>('')
  let deferredResearchParts: UIMessage['parts'] = []
  const { api, shouldAutoRegenerate, isTestChat } = useChatTest(chat, reasoning)
  const wakeLock = useWakeLock()
  // True for the whole span of an auto-recovery attempt, including the idle
  // gaps between individual "still generating" polls — chatSdk.status alone
  // settles back to a terminal value between each poll, which would
  // otherwise make the UI flash back to "nothing happening" every cycle.
  const isAwaitingGeneration = shallowRef<boolean>(false)
  const waitingForPreviousReplySince = shallowRef<number>(0)
  const isContinuationRequest = shallowRef<boolean>(false)
  let pendingStopRequest: Promise<void> | null = null
  let stoppedRun: { messageId: string, runId: string } | null = null
  let isPendingGenerationRetry = false
  let pendingRetryAttempts = 0
  let pendingRetryTimeoutId: ReturnType<typeof setTimeout> | undefined
  let hadInterruptionThisTurn = false
  // Anchors "how long has this turn been reasoning" to a timestamp owned by
  // this composable rather than any per-message component's local state.
  // The recovery-poll loop (attemptGenerationRecovery below) resends the
  // same user message every few seconds via regenerate(), which the AI SDK
  // implements by slicing the in-progress assistant reply off chatSdk.
  // messages and later re-adding it under a brand new id once the response
  // resumes — since ChatReasoning is keyed by message.id, that destroys and
  // remounts the component on every single poll, wiping any local timer
  // state it holds. A value read from this stable, page-lifetime ref
  // survives that churn: a freshly (re)mounted ChatReasoning instance reads
  // the same currentTurnStartedAt and immediately computes the correct
  // elapsed time, with no special-casing needed for the remount itself.
  const currentTurnStartedAt = shallowRef<number>(0)

  function getConnectorIdsField(): {
    connectorIds?: string[]
    offConnectorIds?: string[]
  } {
    const { chatKey, ids, offIds, isKnown } = connectorSelection.value

    if (
      !connectorsFeature.value.active
      || !isKnown
      || chatKey !== chatSlug
    ) {
      return {}
    }

    return { connectorIds: ids, offConnectorIds: offIds }
  }

  function getBesidkaToolsField(): { besidkaToolsEnabled?: boolean } {
    const { chatKey, enabled, isKnown } = besidkaToolsSelection.value

    if (!isBesidkaToolsAvailable.value || !isKnown || chatKey !== chatSlug) {
      return {}
    }

    return { besidkaToolsEnabled: enabled }
  }

  const hydratedMessages = chat.messages.map(hydrateMessageUsage)
  const toolApprovalRemember = createToolApprovalRememberStore()
  const toolApprovalsFeature = useFeature('tool-approvals')
  const sendingApprovalIds = shallowRef<readonly string[]>([])
  const answeredApprovalIds = shallowRef<readonly string[]>([])
  const toolApprovalFailures = shallowRef<
    Record<string, ToolApprovalFailure>
  >({})
  const toolApprovalAnsweredAt = shallowRef<Record<string, number>>({})
  const toolApprovalFocusRequest = shallowRef<
    { approvalId: string, nonce: number } | null
  >(null)
  let toolApprovalRequestError: unknown = null
  let requestedToolRound: ToolRoundRequest | null = null
  const deferredToolRound = shallowRef<ToolRoundRequest | null>(null)
  const requestedToolRoundKeys = shallowRef<ReadonlySet<string>>(new Set())
  const activeToolRound = shallowRef<number>(0)
  const isToolRoundHalted = shallowRef<boolean>(false)
  let isToolApprovalResendHeld = false
  let toolApprovalResendAttempts = 0
  let toolApprovalResendTimeoutId: ReturnType<typeof setTimeout> | undefined
  let isStreamStallAbort = false

  const {
    messages: sdkMessages,
    status: sdkStatus,
    error: sdkError,
    regenerate: sdkRegenerate,
    stop: sdkStop,
    clearError: sdkClearError,
    addToolApprovalResponse: sdkAddToolApprovalResponse,
    sendMessage: sdkSendMessage,
  } = useChatSdk<UIMessage>({
    id: chat.id,
    messages: hydratedMessages as unknown as UIMessage[],
    throttle: STREAM_PUBLISH_THROTTLE_MS,
    transport: new DefaultChatTransport({
      api: api.value,
      async fetch(input, init) {
        transportRequestId.value = undefined

        const response = await globalThis.fetch(input, init)

        transportRequestId.value = response.headers.get('cf-ray')
          || response.headers.get('x-request-id')
          || undefined

        return await toReadableErrorResponse(
          response,
          transportRequestId.value,
        )
      },
      prepareSendMessagesRequest({ messages }) {
        if (messages.at(-1)?.role === 'assistant') {
          nuxtApp.callHook('chat:continue')
        }

        const toolRound = requestedToolRound
        const lastSentMessage = messages.at(-1)

        isContinuationRequest.value = lastSentMessage?.role === 'assistant'
        requestedToolRound = null

        if (
          toolRound
          && lastSentMessage?.role === 'assistant'
          && lastSentMessage.id === toolRound.messageId
        ) {
          activeToolRound.value = toolRound.round

          return { body: { continue: toolRound } }
        }

        activeToolRound.value = 0

        const approvalBody = buildToolApprovalRequestBody(
          messages,
          toolApprovalRemember,
        )

        if (approvalBody) {
          const { responses } = approvalBody.approval
          const answeredIds = responses.map(response => response.approvalId)

          toolApprovalRemember.markInFlight(answeredIds)
          sendingApprovalIds.value = answeredIds

          return { body: approvalBody }
        }

        const lastMessage = messages[messages.length - 1]

        const canSendCapabilityGatedFields = isModelCapabilityResolved.value
        const sentTools = canSendCapabilityGatedFields ? tools.value : []

        return {
          body: {
            model: userModel.value,
            gateway: getSelectionGatewayId(selection.value),
            tools: sentTools,
            webSearchMode: resolveWebSearchMode(tools.value),
            messages: [lastMessage],
            reasoning: canSendCapabilityGatedFields
              ? reasoning.value
              : 'off',
            exaSearchLevel: normalizeExaSearchLevel(
              prefStorage.getItem('settings_exa_search_level'),
            ),
            ...getConnectorIdsField(),
            ...getBesidkaToolsField(),
            ...getStoppedRunField(lastMessage?.id),
          },
        }
      },
    }),
    sendAutomaticallyWhen: ({ messages }) => {
      if (isToolApprovalResendHeld) {
        return false
      }

      if (shouldSendToolApprovalResponses(messages, toolApprovalRemember)) {
        return true
      }

      const nextToolRound = resolveAutoToolRound(messages, {
        isHalted: isToolRoundHalted.value,
        requestedKeys: requestedToolRoundKeys.value,
      })

      if (nextToolRound && document.visibilityState !== 'visible') {
        deferredToolRound.value = nextToolRound

        return false
      }

      return requestToolRound(nextToolRound)
    },
    onFinish({
      isAbort: isSdkAbort,
      isDisconnect: isSdkDisconnect,
      isError,
      messages,
    }) {
      const isStallAbort = isSdkAbort && isStreamStallAbort
      const isAbort = isSdkAbort && !isStallAbort
      const isDisconnect = isSdkDisconnect || isStallAbort
      const approvalRequestIds = toolApprovalRemember.getInFlight()

      isStreamStallAbort = false

      if (
        approvalRequestIds.length > 0
        && finishToolApprovalRequest({
          approvalRequestIds,
          isAbort,
          isDisconnect,
          isError,
        })
      ) {
        return
      }

      const isSuccessfulResponse = !isAbort && !isDisconnect && !isError

      toolApprovalRemember.settleInFlight(isSuccessfulResponse)

      if (isAbort || isError) {
        isToolRoundHalted.value = true
        deferredToolRound.value = null
      }

      const requestId = transportRequestId.value
      const wasPendingGenerationRetry = isPendingGenerationRetry
      let parsedError = pendingError.value

      isPendingGenerationRetry = false

      if (!parsedError && isError) {
        parsedError = normalizeChatClientError(
          sdkError.value || new Error('Load Error'),
          { requestId },
        )
      }

      const wasTransportInterruption = isAutoRecoverableTransportInterruption(
        parsedError,
        { isAbort, isDisconnect, isTestChat: isTestChat.value },
      )

      if (
        !parsedError
        && !isAbort
        && !wasTransportInterruption
        && !wasPendingGenerationRetry
        && shouldSurfaceEmptyAssistantResponse(messages)
      ) {
        parsedError = normalizeChatClientError(
          new Error('Load Error'),
          { requestId },
        )
      }

      pendingError.value = null
      transportRequestId.value = undefined

      // The AI SDK never calls onError on the abort path (it returns before
      // reaching that call), so parsedError && isAbort can't co-occur here in
      // practice — the !isAbort guard is defensive, not load-bearing.
      if (parsedError && !isAbort && !wasTransportInterruption) {
        if (shouldSurfaceChatError(messages, parsedError)) {
          sdkMessages.value = showChatError(
            messages,
            parsedError,
          ) as typeof sdkMessages.value
        } else {
          sdkClearError()
        }
      } else if (parsedError) {
        sdkClearError()
      }

      if (
        wasPendingGenerationRetry
        && !isAbort
        && !wasTransportInterruption
      ) {
        scheduleGenerationRetry()
        return
      }

      waitingForPreviousReplySince.value = 0

      if (isAbort) {
        wakeLock.release()
        isAwaitingGeneration.value = false
        hadInterruptionThisTurn = false
        isStopped.value = true
        tools.value = stripCodeExecutionTool(tools.value)
        nuxtApp.callHook('chat:context-changed')
        return
      }

      if (wasTransportInterruption) {
        hadInterruptionThisTurn = true
        recoverFromTransportInterruption()
        return
      }

      wakeLock.release()
      isAwaitingGeneration.value = false
      tools.value = stripCodeExecutionTool(tools.value)
      nuxtApp.callHook('chat:generation-finished')

      if (isError) {
        isStopped.value = parsedError
          ? shouldSurfaceChatError(messages, parsedError)
          : true
      } else if (shouldNotifyGenerationReadyWhileHidden(
        hadInterruptionThisTurn,
        document.visibilityState,
      )) {
        nuxtApp.callHook('chat:generation-ready-while-hidden')
      }

      hadInterruptionThisTurn = false
      pendingRetryAttempts = 0
    },
    onError(error: any) {
      if (toolApprovalRemember.getInFlight().length > 0) {
        toolApprovalRequestError = error
      }

      const parsedError = normalizeChatClientError(error, {
        requestId: transportRequestId.value,
      })

      pendingError.value = parsedError
      handleConsentError(error)

      if (
        parsedError.requestId
        && !reportedClientErrorIds.has(parsedError.requestId)
        && isTransportLoadError(parsedError)
      ) {
        reportedClientErrorIds.add(parsedError.requestId)

        const { provider } = getModel(userModel.value)

        reportChatClientError({
          code: parsedError.code,
          message: error instanceof Error
            ? error.message
            : parsedError.message,
          reason: parsedError.why,
          requestId: parsedError.requestId,
          transportRequestId: transportRequestId.value,
          chatId: chat.id,
          modelId: userModel.value,
          providerId: provider?.id,
          status: parsedError.status,
        })
      }
    },
    onData(dataPart) {
      markStreamActivity()

      if (dataPart.type === CHAT_STREAM_HEARTBEAT_PART_TYPE) {
        hasStreamHeartbeat = true

        return
      }

      if (dataPart.type === 'data-generation-pending') {
        isPendingGenerationRetry = true

        if (!waitingForPreviousReplySince.value) {
          waitingForPreviousReplySince.value = Date.now()
        }

        return
      }

      if (dataPart.type !== 'data-missing-files') {
        return
      }

      const { count, filenames } = dataPart.data as {
        count: number
        filenames: string[]
      }

      if (count === 1 && filenames[0]) {
        useWarningMessage(`File "${filenames[0]}" is no longer available`)
      } else {
        useWarningMessage(
          `${count} attached ${count === 1 ? 'file is' : 'files are'} no longer available`,
        )
      }
    },
  })

  watch(sdkStatus, (status) => {
    isChatStreaming.value = status === 'submitted' || status === 'streaming'
  }, { immediate: true })

  let lastStreamActivityAt = 0
  let lastStreamStallCheckAt = 0
  let hasStreamHeartbeat = false
  let streamStallIntervalId: ReturnType<typeof setInterval> | undefined

  function markStreamActivity() {
    lastStreamActivityAt = Date.now()
  }

  function clearStreamStallCheck() {
    hasStreamHeartbeat = false

    if (streamStallIntervalId === undefined) {
      return
    }

    clearInterval(streamStallIntervalId)
    streamStallIntervalId = undefined
  }

  /**
   * Reconnects a reply whose stream went silent. The send route writes a
   * heartbeat every 15 seconds while it works, also during a long tool
   * call, so a stream that had heartbeats and then nothing for 45 seconds
   * is dead. It is aborted and settled like a dropped connection
   * (`isStreamStallAbort` in `onFinish`): the transport-interruption
   * recovery resends it, or resends the approval answers, instead of
   * leaving a spinner that never ends. A stream without heartbeats is never
   * ended here. The check waits while the page is hidden and after a tick
   * that came late (the device slept or timers were frozen), because the
   * connection may still deliver.
   */
  function checkStreamStall() {
    const now = Date.now()
    const isLateTick = now - lastStreamStallCheckAt
      > STREAM_STALL_CHECK_INTERVAL_MS * 2

    lastStreamStallCheckAt = now

    if (isLateTick) {
      markStreamActivity()

      return
    }

    if (!hasStreamHeartbeat || document.visibilityState === 'hidden') {
      return
    }

    if (now - lastStreamActivityAt < STREAM_STALL_TIMEOUT_MS) {
      return
    }

    clearStreamStallCheck()
    isStreamStallAbort = true
    sdkStop()
    useWarningMessage(
      'The reply stopped arriving',
      'Reconnecting to it. This can take a couple of minutes.',
    )
  }

  watch(sdkMessages, markStreamActivity)

  watch(sdkStatus, (status) => {
    if (status !== 'submitted' && status !== 'streaming') {
      clearStreamStallCheck()

      return
    }

    if (status === 'submitted') {
      hasStreamHeartbeat = false
    }

    markStreamActivity()

    if (streamStallIntervalId !== undefined) {
      return
    }

    lastStreamStallCheckAt = Date.now()
    streamStallIntervalId = setInterval(
      checkStreamStall,
      STREAM_STALL_CHECK_INTERVAL_MS,
    )
  })

  const renderableMessages = computed<UIMessage[]>(() => {
    return getRenderableChatMessages(sdkMessages.value)
  })

  const isTurnReasoningActive = computed<boolean>(() => {
    return isReasoningActiveForTurn(sdkStatus.value, sdkMessages.value.at(-1))
  })

  // Sum of completed reasoning segments for the current turn, plus the live
  // segment's anchor — together they let Reasoning.vue show genuine "time
  // spent thinking" rather than wall-clock-since-turn-start, even for
  // providers (xAI, OpenAI agentic tool loops, Google) that reopen reasoning
  // after a tool-calling gap. Tracked here rather than in Reasoning.vue
  // because the recovery-poll loop can destroy/recreate that component mid
  // segment, and only this page-lifetime composable is guaranteed to observe
  // the segment's true start and end.
  const reasoningSegmentTracker = createReasoningSegmentTracker(
    isTurnReasoningActive,
    () => sdkStatus.value === 'streaming',
  )
  const currentTurnReasoningAccumulatedMs
    = reasoningSegmentTracker.accumulatedMs
  const currentReasoningSegmentStartedAt
    = reasoningSegmentTracker.segmentStartedAt
  const isTurnThinkingHeld = reasoningSegmentTracker.isTurnThinkingHeld

  const chatSdk = {
    get messages() {
      return renderableMessages.value
    },
    set messages(value: UIMessage[]) {
      sdkMessages.value = value
    },
    get status() {
      return sdkStatus.value
    },
    get error() {
      return sdkError.value
    },
    regenerate: sdkRegenerate,
    stop: sdkStop,
    clearError: sdkClearError,
  }

  const {
    researchJob,
    researchElapsedMs,
    researchStatusChecking,
    researchCurrentStep,
    researchRecentSteps,
    isResearchJobActive,
    startResearchJob,
    cancelResearchJob,
    seedActiveResearchJob,
    dismissResearchJob,
    dispose: disposeChatResearch,
  } = useChatResearch({
    chatSlug: chat.slug,
    chatSdk,
  })

  const isResearchModelSelected = computed<boolean>(() => {
    return isDeepResearchModel(getModel(userModel.value).model)
  })

  // Union gate (see shouldBlockGenerationRecovery above): blocks recovery
  // whenever the globally-selected model is a DR model, OR this chat still
  // holds a research job of any status (running, failed, or a canceled job
  // kept in memory for the rest of the session — see dismissResearchJob's
  // callers, which intentionally never clear a canceled job).
  const shouldBlockGenerationRecovery = computed<boolean>(() => {
    return isResearchModelSelected.value || researchJob.value !== null
  })

  const lastMessage = computed<UIMessage | undefined>(() => {
    return chatSdk.messages.at(-1)
  })

  const isLoading = computed<boolean>(() => {
    return shouldShowGenericLoadingIndicator(
      chatSdk.status,
      isAwaitingGeneration.value,
      lastMessage.value,
    )
  })

  const displayStop = computed<boolean>(() => {
    return (
      ['submitted', 'streaming'].includes(chatSdk.status)
      || waitingForPreviousReplySince.value > 0
    )
    && !isStopped.value
  })

  const waitingLoaderSince = computed<number>(() => {
    return shouldShowWaitingLoader(
      waitingForPreviousReplySince.value,
      lastMessage.value,
      isContinuationRequest.value,
    )
      ? waitingForPreviousReplySince.value
      : 0
  })

  const displayRegenerate = computed<boolean>(() => {
    return !displayStop.value && shouldDisplayRegenerate(
      chatSdk.status,
      isStopped.value,
      chatSdk.messages,
      isResearchModelSelected.value,
    )
  })

  function clearScheduledGenerationRetry(): void {
    if (pendingRetryTimeoutId === undefined) {
      return
    }

    clearTimeout(pendingRetryTimeoutId)
    pendingRetryTimeoutId = undefined
  }

  // Shared by scheduleGenerationRetry() and recoverFromTransportInterruption()
  // so a network flaky enough to make every recovery attempt disconnect (not
  // just every "still generating" poll) is still bounded by the same cap,
  // instead of looping forever through the immediate-retry path.
  function attemptGenerationRecovery(options: { immediate: boolean }): void {
    // Belt-and-suspenders: today only the mount auto-regenerate and
    // recoverIfInterrupted() call into this, and both already gate on
    // shouldBlockGenerationRecovery before calling — this guards any future
    // onFinish-driven caller against firing while a DR model is selected.
    if (isResearchModelSelected.value) {
      return
    }

    isAwaitingGeneration.value = true

    if (pendingRetryAttempts >= MAX_GENERATION_RETRY_ATTEMPTS) {
      waitingForPreviousReplySince.value = 0
      isAwaitingGeneration.value = false
      isStopped.value = true
      wakeLock.release()

      return
    }

    const isFirstAttempt = pendingRetryAttempts === 0

    pendingRetryAttempts += 1
    clearScheduledGenerationRetry()

    if (!options.immediate || !isFirstAttempt) {
      pendingRetryTimeoutId = setTimeout(() => {
        // The generation this was polling for may have resumed on its own
        // between scheduling and firing (e.g. a brief connection hiccup that
        // self-recovered) — resending against an already-active generation
        // would push a second, redundant response into the message list.
        if (['submitted', 'streaming'].includes(chatSdk.status)) {
          return
        }

        chatSdk.regenerate()
      }, getGenerationRetryDelayMs(pendingRetryAttempts))

      return
    }

    isStopped.value = false
    wakeLock.acquire()
    chatSdk.regenerate()
  }

  function scheduleGenerationRetry(): void {
    attemptGenerationRecovery({ immediate: false })
  }

  // Called once onFinish has already confirmed (via wasTransportInterruption)
  // that this exact turn was cut off — so unlike recoverIfInterrupted() below,
  // this does not re-check shouldRecoverInterruptedGeneration's message-shape
  // heuristic: a turn with substantial partial reasoning/text already visible
  // still needs the resend, since that heuristic only exists to *infer*
  // interruption from message shape when there is no direct signal.
  function recoverFromTransportInterruption(): void {
    attemptGenerationRecovery({ immediate: true })
  }

  function recoverIfInterrupted(): void {
    if (isTestChat.value) {
      return
    }

    if (shouldBlockGenerationRecovery.value) {
      return
    }

    if (isStopped.value) {
      return
    }

    if (!shouldRecoverInterruptedGeneration(chatSdk.status, chatSdk.messages)) {
      return
    }

    clearScheduledGenerationRetry()
    isAwaitingGeneration.value = true
    isStopped.value = false
    wakeLock.acquire()
    chatSdk.regenerate()
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      markStreamActivity()
      recoverIfInterrupted()
    }
  }

  onMounted(() => {
    if (
      shouldRecoverGeneration(chat?.messages ?? [])
      && shouldAutoRegenerate.value
      && !shouldBlockGenerationRecovery.value
    ) {
      // A reply-less last message on a freshly loaded chat (issue #275) means
      // the previous attempt never persisted before this load — could still
      // be generating server-side, so this may resolve into the same
      // "still generating" poll loop as a live recovery, not just a replay.
      isAwaitingGeneration.value = true
      currentTurnStartedAt.value = Date.now()
      reasoningSegmentTracker.reset()
      wakeLock.acquire()
      chatSdk.regenerate()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', recoverIfInterrupted)
  })

  onUnmounted(() => {
    stopGenerationOnLeave()
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('focus', recoverIfInterrupted)
    clearScheduledGenerationRetry()
    clearToolApprovalResend()
    clearStreamStallCheck()
    reasoningSegmentTracker.reset()
    disposeChatResearch()
    wakeLock.release()
    isChatStreaming.value = false
  })

  useSetChatTitle(chat.title)

  const nuxtApp = useNuxtApp()

  async function buildUserMessageParts(
    text: string,
  ): Promise<UIMessage['parts']> {
    const parts: any[] = []
    const artifactParts = attachedArtifacts.value.map(toArtifactAttachmentPart)
    const skillInvocationPart = composerSkillInvocation.part.value
    const builtinCommandPart = composerBuiltinCommand.part.value

    if (text.trim()) {
      parts.push({
        type: 'text',
        text,
      })
    }

    if (files.value.length > 0) {
      const fileParts = await convertFilesToUIParts(files.value)

      parts.push(...fileParts)
    }

    parts.push(...artifactParts)

    if (skillInvocationPart) {
      parts.push(skillInvocationPart)
    }

    if (builtinCommandPart) {
      parts.push(builtinCommandPart)
    }

    return parts
  }

  function buildTextOnlyParts(text: string): UIMessage['parts'] {
    if (!text.trim()) {
      return []
    }

    return [{
      type: 'text',
      text,
    }] as unknown as UIMessage['parts']
  }

  async function requestResearchClarification(topic: string): Promise<void> {
    try {
      deferredResearchParts = await buildUserMessageParts(topic)
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to prepare your message',
        parsedException.why,
      )

      return
    }

    pendingResearchTopic.value = topic
    isClarifying.value = true

    try {
      const response = await $fetch<ResearchClarificationResponse>(
        '/api/v1/chats/research/clarify',
        {
          method: 'POST',
          body: {
            model: userModel.value,
            topic,
          },
        },
      )

      pendingClarification.value = response
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to prepare research questions',
        parsedException.why,
      )

      await submitResearchClarification([])
    } finally {
      isClarifying.value = false
    }
  }

  async function submitResearchClarification(
    answers: ResearchAnswer[],
  ): Promise<void> {
    const parts = deferredResearchParts.length
      ? deferredResearchParts
      : buildTextOnlyParts(pendingResearchTopic.value)

    deferredResearchParts = []
    pendingClarification.value = null
    pendingResearchTopic.value = ''

    if (!parts.length) {
      useErrorMessage(
        'Failed to start research',
        'Your message could not be recovered. Please try again.',
      )

      return
    }

    const { model } = getModel(userModel.value)

    if (!isDeepResearchModel(model)) {
      useErrorMessage(
        'Failed to start research',
        'Research mode is no longer active for this model.',
      )

      return
    }

    const started = await startResearchJob({
      userMessage: { id: ulid(), parts },
      answers,
    })

    if (started) {
      input.value = ''
      files.value = []
    }
  }

  async function submit() {
    if (isClarifying.value) {
      return
    }

    if (isResearchJobActive.value) {
      useWarningMessage('Research in progress — please wait.')

      return
    }

    const topic = input.value
    const { model } = getModel(userModel.value)

    if (
      isDeepResearchModel(model)
      && !pendingClarification.value
      && !composerBuiltinCommand.command.value
      && topic.trim()
    ) {
      await requestResearchClarification(topic)

      return
    }

    waitingForPreviousReplySince.value = 0
    isStopped.value = false
    isAwaitingGeneration.value = false
    hadInterruptionThisTurn = false
    isToolRoundHalted.value = false
    pendingRetryAttempts = 0
    currentTurnStartedAt.value = Date.now()
    reasoningSegmentTracker.reset()
    clearScheduledGenerationRetry()
    wakeLock.acquire()

    const parts = await buildUserMessageParts(topic)

    await waitForPendingStop()

    chatSdk.messages = [
      ...chatSdk.messages,
      {
        id: ulid(),
        role: 'user',
        parts,
        createdAt: new Date(),
        reasoning: reasoning.value,
      } as unknown as UIMessage,
    ]

    chatSdk.regenerate()
  }

  /**
   * The id of the generation lease the request in flight holds: the
   * assistant message for an approval or round continuation, the user
   * message for every other send.
   */
  function findGenerationLeaseMessageId(): string | null {
    const isContinuation = activeToolRound.value > 0
      || sendingApprovalIds.value.length > 0

    if (isContinuation) {
      const lastMessage = sdkMessages.value.at(-1)

      return lastMessage?.role === 'assistant' ? lastMessage.id : null
    }

    return sdkMessages.value.findLast(message => message.role === 'user')?.id
      ?? null
  }

  /**
   * Tells the server the user stopped the reply, so it ends the run and
   * frees the chat at once and Retry does not wait for the old run's lease.
   * Sent with `keepalive`, so it still goes out when the page is closing;
   * a failure only means Retry may wait for the lease as before. The run it
   * stopped goes back with the retry of the same message.
   */
  async function requestGenerationStop(messageId: string): Promise<void> {
    stoppedRun = null

    try {
      const response = await $fetch(`/api/v1/chats/${chatSlug}/stop`, {
        method: 'POST',
        body: { messageId },
        keepalive: true,
      })

      stoppedRun = response.runId
        ? { messageId, runId: response.runId }
        : null
    } catch {
      return
    }
  }

  function getStoppedRunField(
    messageId: string | undefined,
  ): { stoppedRunId?: string } {
    if (!stoppedRun || stoppedRun.messageId !== messageId) {
      return {}
    }

    const { runId } = stoppedRun

    stoppedRun = null

    return { stoppedRunId: runId }
  }

  async function waitForPendingStop(): Promise<void> {
    if (!pendingStopRequest) {
      return
    }

    const request = pendingStopRequest
    let waitTimer: ReturnType<typeof setTimeout> | undefined

    pendingStopRequest = null
    await Promise.race([
      request,
      new Promise((resolve) => {
        waitTimer = setTimeout(resolve, STOP_REQUEST_WAIT_MS)
      }),
    ])
    clearTimeout(waitTimer)
  }

  function stop() {
    const leaseMessageId = isTestChat.value || !displayStop.value
      ? null
      : findGenerationLeaseMessageId()

    if (leaseMessageId) {
      pendingStopRequest = requestGenerationStop(leaseMessageId)
    }

    endGenerationLocally()
  }

  /**
   * Leaving the chat inside the app (history, another chat) while a reply
   * streams: tells the server to stop the run, so it stores what it has as
   * a stopped reply and frees the chat, then ends the local request. Before,
   * the request kept streaming in the background until the next visit
   * dropped it, the run died with it, nothing was stored and the return
   * visit waited for a stale lease (owner report, 2026-11-21). A wait for
   * another run only ends the local polling, as Cancel does.
   */
  function stopGenerationOnLeave(): void {
    if (!displayStop.value) {
      return
    }

    const isWaitingOnly = waitingForPreviousReplySince.value > 0
      && !['submitted', 'streaming'].includes(chatSdk.status)

    if (!isWaitingOnly && !isTestChat.value) {
      const leaseMessageId = findGenerationLeaseMessageId()

      if (leaseMessageId) {
        requestGenerationStop(leaseMessageId)
      }
    }

    waitingForPreviousReplySince.value = 0
    chatSdk.stop()
  }

  /**
   * Cancel in the "Waiting for the previous reply to stop" state: ends the
   * wait without telling the server, so a reply another tab is still
   * writing keeps running. Stop is the button that ends that reply.
   */
  function cancelWaiting() {
    endGenerationLocally()
  }

  function endGenerationLocally() {
    waitingForPreviousReplySince.value = 0
    clearScheduledGenerationRetry()
    clearToolApprovalResend()
    isAwaitingGeneration.value = false
    hadInterruptionThisTurn = false
    currentTurnStartedAt.value = 0
    reasoningSegmentTracker.reset()
    wakeLock.release()
    chatSdk.stop()
    nuxtApp.callHook('chat:stop')
  }

  async function regenerate() {
    // displayRegenerate already hides the button for a DR-selected model —
    // this guards any other caller of regenerate() against streaming against
    // a model that only accepts research turns through the async job flow.
    if (isResearchModelSelected.value) {
      return
    }

    await waitForPendingStop()
    waitingForPreviousReplySince.value = 0
    isStopped.value = false
    isAwaitingGeneration.value = false
    hadInterruptionThisTurn = false
    pendingRetryAttempts = 0
    currentTurnStartedAt.value = Date.now()
    reasoningSegmentTracker.reset()
    clearScheduledGenerationRetry()
    wakeLock.acquire()
    chatSdk.regenerate()
    nuxtApp.callHook('chat:regenerate')
  }

  function isLastUserMessage(index: number): boolean {
    const message = chatSdk.messages[index]

    if (!message || message.role !== 'user') return false

    const lastMessage = chatSdk.messages[chatSdk.messages.length - 1]

    return index === chatSdk.messages.length - 1
      || (
        index === chatSdk.messages.length - 2
        && lastMessage?.role === 'assistant'
      )
  }

  function isLastAssistantMessage(index: number): boolean {
    const message = chatSdk.messages[index]

    if (!message || message.role !== 'assistant') return false

    return index === chatSdk.messages.length - 1
  }

  function shouldDisplayMessage(id: UIMessage['id']): boolean {
    const message = chatSdk.messages.find(
      candidate => candidate.id === id,
    )

    if (!message) {
      return false
    } else if (message.role === 'user') {
      return true
    }

    return hasVisibleAssistantContent(message)
  }

  function getMessageReasoning(
    message: UIMessage,
    index: number,
  ): ReasoningLevel {
    const persistedReasoning = normalizeReasoningLevel(
      (message as UIMessage & {
        reasoning?: unknown
      }).reasoning,
    )

    if (persistedReasoning !== 'off') {
      return persistedReasoning
    }

    if (message.role !== 'assistant') {
      return persistedReasoning
    }

    for (let messageIndex = index - 1; messageIndex >= 0; messageIndex -= 1) {
      const candidate = chatSdk.messages[messageIndex]

      if (candidate?.role !== 'user') {
        continue
      }

      return normalizeReasoningLevel(
        (candidate as UIMessage & {
          reasoning?: unknown
        }).reasoning,
      )
    }

    return 'off'
  }

  /**
   * Answers one waiting tool call. Once every waiting call of the reply is
   * answered, the SDK sends the answers on its own
   * (`sendAutomaticallyWhen`) and the reply continues in the same message.
   */
  async function answerToolApproval(answer: ToolApprovalAnswer) {
    toolApprovalRemember.set(answer.approvalId, answer.remember ?? 'once')
    toolApprovalResendAttempts = 0
    answeredApprovalIds.value = [
      ...answeredApprovalIds.value.filter((approvalId) => {
        return approvalId !== answer.approvalId
      }),
      answer.approvalId,
    ]
    toolApprovalAnsweredAt.value = {
      ...toolApprovalAnsweredAt.value,
      [answer.approvalId]: Date.now(),
    }

    await sdkAddToolApprovalResponse({
      id: answer.approvalId,
      approved: answer.approved,
      ...(answer.reason ? { reason: answer.reason } : {}),
    })
  }

  function forgetAnsweredApprovals(approvalIds: readonly string[]) {
    const ids = new Set(approvalIds)

    answeredApprovalIds.value = answeredApprovalIds.value.filter(
      (approvalId) => {
        return !ids.has(approvalId)
      },
    )
    toolApprovalRemember.forget(approvalIds)
  }

  /**
   * Takes back a local answer while other calls of the same reply still
   * wait, so nothing was sent yet.
   */
  function changeToolApprovalAnswer(approvalId: string) {
    if (
      sendingApprovalIds.value.includes(approvalId)
      || ['submitted', 'streaming'].includes(sdkStatus.value)
    ) {
      return
    }

    forgetAnsweredApprovals([approvalId])
    sdkMessages.value = revertToolApprovalResponses(
      sdkMessages.value,
      [approvalId],
    ) as typeof sdkMessages.value
  }

  /**
   * Arms the next send to run `request` as the next round of a long tool
   * task in the same reply. Each round is requested once.
   */
  function requestToolRound(request: ToolRoundRequest | null): boolean {
    if (!request || requestedToolRoundKeys.value.has(toolRoundKey(request))) {
      return false
    }

    requestedToolRoundKeys.value = new Set([
      ...requestedToolRoundKeys.value,
      toolRoundKey(request),
    ])
    requestedToolRound = request

    return true
  }

  /**
   * Runs the next round of a long tool task on the user's click (a hidden
   * tab, or after Stop), into the same reply.
   */
  async function continueToolRound() {
    if (isChatStreaming.value) {
      return
    }

    const next = findNextToolRound(sdkMessages.value)

    if (!next) {
      return
    }

    requestedToolRoundKeys.value = new Set(
      [...requestedToolRoundKeys.value].filter((key) => {
        return key !== toolRoundKey(next)
      }),
    )
    deferredToolRound.value = null

    if (!requestToolRound(next)) {
      return
    }

    isToolRoundHalted.value = false
    isStopped.value = false
    currentTurnStartedAt.value = Date.now()
    reasoningSegmentTracker.reset()
    wakeLock.acquire()

    await sdkSendMessage()
  }

  /**
   * Goes on after a reply used every round one message may run: sends
   * "Continue" as a new message, or adds it to a draft the user is writing.
   */
  async function continueToolTaskAsNewMessage() {
    if (input.value.trim()) {
      await nuxtApp.callHook('chat-input:prefill', 'Continue')

      return
    }

    input.value = 'Continue'
    await submit()
  }

  async function askAgainAfterApproval(messageId: string) {
    const prompt = getPromptBeforeMessage(sdkMessages.value, messageId)

    if (!prompt || input.value.trimEnd().endsWith(prompt)) {
      return
    }

    await nuxtApp.callHook('chat-input:prefill', prompt)
  }

  function markToolApprovalFailures(
    approvalIds: readonly string[],
    failure: ToolApprovalFailure,
  ) {
    const failures = { ...toolApprovalFailures.value }

    for (const approvalId of approvalIds) {
      failures[approvalId] = failure
    }

    toolApprovalFailures.value = failures
  }

  function clearToolApprovalResend() {
    isToolApprovalResendHeld = false

    if (toolApprovalResendTimeoutId === undefined) {
      return
    }

    clearTimeout(toolApprovalResendTimeoutId)
    toolApprovalResendTimeoutId = undefined
  }

  /**
   * Sends the same answers again after a "still working" signal or a
   * dropped connection. The server keeps one claim per answer, so a resend
   * either waits again, replays the stored reply into the same message or
   * reports the run as interrupted; it never runs the tool twice.
   */
  function scheduleToolApprovalResend(approvalIds: readonly string[]) {
    clearToolApprovalResend()

    if (toolApprovalResendAttempts >= MAX_GENERATION_RETRY_ATTEMPTS) {
      toolApprovalRemember.markSent(approvalIds)
      markToolApprovalFailures(approvalIds, 'interrupted')

      return
    }

    toolApprovalResendAttempts += 1
    isToolApprovalResendHeld = true
    toolApprovalResendTimeoutId = setTimeout(() => {
      toolApprovalResendTimeoutId = undefined
      isToolApprovalResendHeld = false

      if (['submitted', 'streaming'].includes(sdkStatus.value)) {
        return
      }

      if (!shouldSendToolApprovalResponses(
        sdkMessages.value,
        toolApprovalRemember,
      )) {
        return
      }

      sdkSendMessage()
    }, getGenerationRetryDelayMs(toolApprovalResendAttempts))
  }

  function hasRespondedApprovalParts(approvalIds: readonly string[]) {
    const ids = new Set(approvalIds)

    return sdkMessages.value.at(-1)?.parts.some((part) => {
      return isToolUIPart(part)
        && part.state === 'approval-responded'
        && ids.has(part.approval.id)
    }) ?? false
  }

  /**
   * Settles a request that answered approvals. Returns true when it handled
   * the outcome itself (the generic error card and Regenerate would point at
   * a reply the server cannot regenerate): a pending signal or a dropped
   * connection resends the answers, a 409 marks the calls expired or
   * interrupted, and any other error brings the buttons back with a toast.
   */
  function finishToolApprovalRequest(input: {
    approvalRequestIds: readonly string[]
    isAbort: boolean
    isDisconnect: boolean
    isError: boolean
  }): boolean {
    const { approvalRequestIds } = input
    const requestError = toolApprovalRequestError ?? sdkError.value
    const wasPendingGenerationRetry = isPendingGenerationRetry

    toolApprovalRequestError = null
    sendingApprovalIds.value = []

    if (input.isAbort) {
      toolApprovalRemember.settleInFlight(true)
      markToolApprovalFailures(approvalRequestIds, 'interrupted')

      return false
    }

    const isInterruption = isAutoRecoverableTransportInterruption(
      pendingError.value,
      {
        isAbort: false,
        isDisconnect: input.isDisconnect,
        isTestChat: isTestChat.value,
      },
    )

    if (wasPendingGenerationRetry || isInterruption) {
      isPendingGenerationRetry = false
      pendingError.value = null
      toolApprovalRemember.settleInFlight(false)
      sdkClearError()
      scheduleToolApprovalResend(approvalRequestIds)

      return true
    }

    if (!input.isError) {
      toolApprovalResendAttempts = 0

      return false
    }

    if (!hasRespondedApprovalParts(approvalRequestIds)) {
      toolApprovalRemember.settleInFlight(true)

      return false
    }

    const classified = classifyToolApprovalError(requestError)

    pendingError.value = null
    sdkClearError()
    isStopped.value = false

    if (classified.kind === 'retry') {
      toolApprovalRemember.settleInFlight(false)
      forgetAnsweredApprovals(approvalRequestIds)
      sdkMessages.value = revertToolApprovalResponses(
        sdkMessages.value,
        approvalRequestIds,
      ) as typeof sdkMessages.value
      useErrorMessage(classified.message, classified.why || classified.fix)

      return true
    }

    toolApprovalRemember.settleInFlight(true)
    markToolApprovalFailures(approvalRequestIds, classified.kind)

    return true
  }

  const toolApprovalController: ToolApprovalController = {
    isActive: computed<boolean>(() => {
      return toolApprovalsFeature.value.active
    }),
    messages: renderableMessages,
    isRequestActive: computed<boolean>(() => {
      return ['submitted', 'streaming'].includes(sdkStatus.value)
    }),
    pendingApprovalIds: computed<string[]>(() => {
      if (!toolApprovalsFeature.value.active) {
        return []
      }

      return getPendingToolApprovalIds(
        renderableMessages.value,
        toolApprovalFailures.value,
      )
    }),
    sendingApprovalIds,
    answeredApprovalIds,
    failures: toolApprovalFailures,
    answeredAt: toolApprovalAnsweredAt,
    focusRequest: toolApprovalFocusRequest,
    answer: answerToolApproval,
    change: changeToolApprovalAnswer,
    askAgain: askAgainAfterApproval,
    focusFirstPending: () => {
      const approvalId = toolApprovalController.pendingApprovalIds.value[0]

      if (!approvalId) {
        return
      }

      toolApprovalController.focusApproval(approvalId)
    },
    focusApproval: (approvalId) => {
      toolApprovalFocusRequest.value = { approvalId, nonce: Date.now() }
    },
  }

  provide(TOOL_APPROVAL_CONTROLLER_KEY, toolApprovalController)

  const toolRoundController: ToolRoundController = {
    activeRound: activeToolRound,
    isRequestActive: isChatStreaming,
    isWaitingForUser: computed<boolean>(() => {
      return isToolRoundHalted.value || deferredToolRound.value !== null
    }),
    isRequested: (request) => {
      return requestedToolRoundKeys.value.has(toolRoundKey(request))
    },
    continueRound: continueToolRound,
    continueAsNewMessage: continueToolTaskAsNewMessage,
  }

  provide(TOOL_ROUND_CONTROLLER_KEY, toolRoundController)

  if (import.meta.client) {
    useEventListener(document, 'visibilitychange', () => {
      const deferred = deferredToolRound.value

      if (
        !deferred
        || document.visibilityState !== 'visible'
        || isChatStreaming.value
        || isToolRoundHalted.value
      ) {
        return
      }

      deferredToolRound.value = null

      const next = findNextToolRound(sdkMessages.value)

      if (next && toolRoundKey(next) === toolRoundKey(deferred)) {
        continueToolRound()
      }
    })
  }

  return {
    chatSdk,
    input,
    submit,
    answerToolApproval,
    stop,
    isStopped,
    regenerate,
    tools,
    reasoning,
    getMessageReasoning,
    isLoading,
    displayRegenerate,
    displayStop,
    waitingForPreviousReplySince,
    waitingLoaderSince,
    cancelWaiting,
    isLastUserMessage,
    isLastAssistantMessage,
    shouldDisplayMessage,
    files,
    attachedArtifacts,
    currentTurnStartedAt,
    currentTurnReasoningAccumulatedMs,
    currentReasoningSegmentStartedAt,
    isTurnThinkingHeld,
    pendingClarification,
    pendingResearchTopic,
    isClarifying,
    submitResearchClarification,
    researchJob,
    researchElapsedMs,
    researchStatusChecking,
    researchCurrentStep,
    researchRecentSteps,
    isResearchJobActive,
    cancelResearchJob,
    seedActiveResearchJob,
    dismissResearchJob,
  }
}

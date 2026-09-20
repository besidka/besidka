import type {
  UIMessage,
  TextUIPart,
  SourceUrlUIPart,
  ReasoningUIPart,
  ChatStatus,
} from 'ai'
import type { Ref, ComputedRef } from 'vue'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import type { Chat, Tools } from '#shared/types/chats.d'
import type { FileMetadata } from '#shared/types/files.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import type {
  ResearchAnswer,
  ResearchClarificationResponse,
} from '#shared/types/research.d'
import { parseError } from 'evlog'
import { DefaultChatTransport } from 'ai'
import { useChat as useChatSdk } from '@ai-sdk/vue'
import { ulid } from 'ulid'
import {
  getGenerateImageToolPart,
  isVisibleGenerateImageToolPart,
} from '~/utils/generated-images'
import { hydrateMessageUsage } from '#shared/utils/message-metadata'

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

export function hasRetryableAssistantFailure(messages: UIMessage[]): boolean {
  const lastMessage = messages.at(-1)
  const previousMessage = messages.at(-2)

  return lastMessage?.role === 'assistant'
    && previousMessage?.role === 'user'
    && !hasMeaningfulAssistantParts(lastMessage)
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
// robust. A present research job of ANY status (including a cancelled one
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
    if (part.type === 'file' || isVisibleGenerateImageToolPart(part)) {
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

    return true
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

function reportChatClientError(payload: ChatClientErrorReport) {
  if (!import.meta.client) {
    return
  }

  const body = JSON.stringify(payload)

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], {
        type: 'application/json',
      })

      navigator.sendBeacon('/api/v1/chats/client-errors', blob)

      return
    }
  } catch (exception) {
    void exception
  }

  globalThis.fetch('/api/v1/chats/client-errors', {
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

// Bounds how long the client keeps polling a "still generating" turn (issue
// #275) before giving up and falling back to the manual Regenerate button.
// 150 attempts * 4s = 10 min, comfortably covering the 2-3 min generations
// from the bug report with margin, and roughly matching the server's KV ttl
// on the in-flight generation flag (server/api/v1/chats/[slug]/index.post.ts)
// — once that expires a retry just starts a fresh generation instead, which
// is an acceptable fallback.
const MAX_GENERATION_RETRY_ATTEMPTS = 150
const GENERATION_RETRY_DELAY_MS = 4_000

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

export function useChat(chat: MaybeRefOrGetter<Chat>) {
  const { userModel } = useUserModel()
  const isStopped = shallowRef<boolean>(false)
  const prefStorage = usePreferenceStorage()
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
  const pendingError = shallowRef<ChatErrorPayload | null>(null)
  const transportRequestId = shallowRef<string>()
  const reportedClientErrorIds = new Set<string>()

  chat = toValue(chat)

  const tools = shallowRef<Tools>(
    chat.messages[chat.messages.length - 1]?.tools || [],
  )
  const savedReasoningLevel = customRef<ReasoningLevel>((track, trigger) => ({
    get() {
      track()

      return (prefStorage.getItem('settings_reasoning_level') as ReasoningLevel)
        ?? 'off'
    },
    set(value) {
      prefStorage.setItem('settings_reasoning_level', value)
      trigger()
    },
  }))
  const reasoning = shallowRef<ReasoningLevel>(
    normalizeReasoningLevel(savedReasoningLevel.value),
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

  const hydratedMessages = chat.messages.map(hydrateMessageUsage)

  const {
    messages: sdkMessages,
    status: sdkStatus,
    error: sdkError,
    regenerate: sdkRegenerate,
    stop: sdkStop,
    clearError: sdkClearError,
  } = useChatSdk<UIMessage>({
    id: chat.id,
    messages: hydratedMessages as unknown as UIMessage[],
    transport: new DefaultChatTransport({
      api: api.value,
      async fetch(input, init) {
        transportRequestId.value = undefined

        const response = await globalThis.fetch(input, init)

        transportRequestId.value = response.headers.get('cf-ray')
          || response.headers.get('x-request-id')
          || undefined

        return response
      },
      prepareSendMessagesRequest({ messages }) {
        const lastMessage = messages[messages.length - 1]

        return {
          body: {
            model: userModel.value,
            tools: tools.value,
            messages: [lastMessage],
            reasoning: reasoning.value,
          },
        }
      },
    }),
    onFinish({ isAbort, isDisconnect, isError, messages }) {
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

      if (isAbort) {
        wakeLock.release()
        isAwaitingGeneration.value = false
        hadInterruptionThisTurn = false
        isStopped.value = true
        return
      }

      if (wasTransportInterruption) {
        hadInterruptionThisTurn = true
        recoverFromTransportInterruption()
        return
      }

      wakeLock.release()
      isAwaitingGeneration.value = false

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
    },
    onError(error: any) {
      const parsedError = normalizeChatClientError(error, {
        requestId: transportRequestId.value,
      })

      pendingError.value = parsedError

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
      if (dataPart.type === 'data-generation-pending') {
        isPendingGenerationRetry = true
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
  // holds a research job of any status (running, failed, or a cancelled job
  // kept in memory for the rest of the session — see dismissResearchJob's
  // callers, which intentionally never clear a cancelled job).
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
    return ['submitted', 'streaming'].includes(chatSdk.status)
      && !isStopped.value
  })

  const displayRegenerate = computed<boolean>(() => {
    return shouldDisplayRegenerate(
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
      isAwaitingGeneration.value = false
      isStopped.value = true
      wakeLock.release()

      return
    }

    pendingRetryAttempts += 1
    clearScheduledGenerationRetry()

    if (!options.immediate) {
      pendingRetryTimeoutId = setTimeout(() => {
        // The generation this was polling for may have resumed on its own
        // between scheduling and firing (e.g. a brief connection hiccup that
        // self-recovered) — resending against an already-active generation
        // would push a second, redundant response into the message list.
        if (['submitted', 'streaming'].includes(chatSdk.status)) {
          return
        }

        chatSdk.regenerate()
      }, GENERATION_RETRY_DELAY_MS)

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
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('focus', recoverIfInterrupted)
    clearScheduledGenerationRetry()
    reasoningSegmentTracker.reset()
    disposeChatResearch()
    wakeLock.release()
  })

  useSetChatTitle(chat.title)

  const nuxtApp = useNuxtApp()

  async function buildUserMessageParts(
    text: string,
  ): Promise<UIMessage['parts']> {
    const parts: any[] = []

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
      && topic.trim()
    ) {
      await requestResearchClarification(topic)

      return
    }

    isStopped.value = false
    isAwaitingGeneration.value = false
    hadInterruptionThisTurn = false
    pendingRetryAttempts = 0
    currentTurnStartedAt.value = Date.now()
    reasoningSegmentTracker.reset()
    clearScheduledGenerationRetry()
    wakeLock.acquire()

    const parts = await buildUserMessageParts(topic)

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

  function stop() {
    clearScheduledGenerationRetry()
    isAwaitingGeneration.value = false
    hadInterruptionThisTurn = false
    currentTurnStartedAt.value = 0
    reasoningSegmentTracker.reset()
    wakeLock.release()
    chatSdk.stop()
    nuxtApp.callHook('chat:stop')
  }

  function regenerate() {
    // displayRegenerate already hides the button for a DR-selected model —
    // this guards any other caller of regenerate() against streaming against
    // a model that only accepts research turns through the async job flow.
    if (isResearchModelSelected.value) {
      return
    }

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

  watch(reasoning, (level) => {
    savedReasoningLevel.value = level
  }, {
    immediate: true,
    flush: 'post',
  })

  return {
    chatSdk,
    input,
    submit,
    stop,
    isStopped,
    regenerate,
    tools,
    reasoning,
    getMessageReasoning,
    isLoading,
    displayRegenerate,
    displayStop,
    isLastUserMessage,
    isLastAssistantMessage,
    shouldDisplayMessage,
    files,
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

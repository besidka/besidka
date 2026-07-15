import type { UIMessage } from 'ai'
import type { Chat } from '#shared/types/chats.d'
import type { MessageUsage } from '#shared/types/message-usage.d'
import type {
  ResearchAnswer,
  ResearchJobStatus,
  ResearchJobView,
  ResearchProviderId,
  ResearchTraceEntry,
} from '#shared/types/research.d'
import { parseError } from 'evlog'
import { hydrateMessageUsage } from '#shared/utils/message-metadata'

export interface UseChatResearchChatSdk {
  messages: UIMessage[]
}

// The `/research` poll and full-chat GET endpoints return the raw persisted
// message row (a flat `usage` column, per server/db/schemas/chats.ts), not a
// UIMessage with `metadata.usage` already attached — appendMessageDeduped()
// below hydrates it via the same helper the initial chat load uses.
type RawResearchMessage = UIMessage & {
  usage?: MessageUsage | null
  createdAt?: string | number | Date | null
}

export interface UseChatResearchOptions {
  chatSlug: string
  chatSdk: UseChatResearchChatSdk
}

export interface StartResearchJobInput {
  userMessage: {
    id: string
    parts: UIMessage['parts']
  }
  answers?: ResearchAnswer[]
}

const RESEARCH_POLL_INTERVAL_MS = 10_000
const RESEARCH_ELAPSED_TICK_MS = 1_000
const RESEARCH_RECENT_STEPS_MAX = 3
const ACTIVE_RESEARCH_JOB_STATUSES: ResearchJobStatus[] = [
  'pending',
  'running',
]
const TERMINAL_RESEARCH_JOB_STATUSES: ResearchJobStatus[] = [
  'completed',
  'failed',
  'cancelled',
]

// Issue #1 (round-3): starting a research job has 10-15s of dead air between
// the user answering the clarify form and the POST resolving (server does a
// brief-rewrite via the assist model, then starts the provider job before
// responding). This builds a client-only placeholder ResearchJobView so the
// pending block can render instantly, before any server round trip — the
// real job returned by the POST replaces it via applyJobUpdate(), and a
// failed POST reverts to null. publicId 'local-pending' is never sent to or
// read from the server; it only exists to satisfy ResearchJobView's shape.
export function buildLocalPendingResearchJob(
  modelId: string,
  answers?: ResearchAnswer[],
): ResearchJobView | null {
  const { model, provider } = getModel(modelId)
  const research = getModelResearch(model)

  if (!research || !provider) {
    return null
  }

  return {
    publicId: 'local-pending',
    status: 'pending',
    provider: provider.id as ResearchProviderId,
    level: research.tier,
    modelId,
    startedAt: null,
    error: null,
    resultMessageId: null,
    answers: answers?.length ? answers : null,
  }
}

export function useChatResearch(options: UseChatResearchOptions) {
  const { userModel } = useUserModel()
  const nuxtApp = useNuxtApp()

  const researchJob = shallowRef<ResearchJobView | null>(null)
  const researchElapsedMs = shallowRef<number>(0)
  const researchStatusChecking = shallowRef<boolean>(false)
  const researchCurrentStep = shallowRef<ResearchTraceEntry | null>(null)
  const researchRecentSteps = shallowRef<ResearchTraceEntry[]>([])

  let pollIntervalId: ReturnType<typeof setInterval> | undefined
  let elapsedIntervalId: ReturnType<typeof setInterval> | undefined
  let isPolling = false
  let listenersAttached = false

  const isResearchJobActive = computed<boolean>(() => {
    const status = researchJob.value?.status

    return !!status && ACTIVE_RESEARCH_JOB_STATUSES.includes(status)
  })

  function clearPollLoop(): void {
    if (pollIntervalId === undefined) {
      return
    }

    clearInterval(pollIntervalId)
    pollIntervalId = undefined
  }

  function clearElapsedTimer(): void {
    if (elapsedIntervalId === undefined) {
      return
    }

    clearInterval(elapsedIntervalId)
    elapsedIntervalId = undefined
  }

  function tickElapsed(): void {
    const startedAt = researchJob.value?.startedAt

    researchElapsedMs.value = startedAt ? Date.now() - startedAt : 0
  }

  function startElapsedTimer(): void {
    if (!import.meta.client) {
      return
    }

    tickElapsed()

    if (elapsedIntervalId !== undefined) {
      return
    }

    elapsedIntervalId = setInterval(tickElapsed, RESEARCH_ELAPSED_TICK_MS)
  }

  function pollOnce(): void {
    void runPoll()
  }

  function startPollLoop(): void {
    if (!import.meta.client || pollIntervalId !== undefined) {
      return
    }

    pollIntervalId = setInterval(pollOnce, RESEARCH_POLL_INTERVAL_MS)
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState !== 'visible') {
      return
    }

    pollOnce()
  }

  function handleFocus(): void {
    pollOnce()
  }

  function attachVisibilityListeners(): void {
    if (!import.meta.client || listenersAttached) {
      return
    }

    listenersAttached = true
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleFocus)
  }

  function detachVisibilityListeners(): void {
    if (!listenersAttached) {
      return
    }

    listenersAttached = false
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('focus', handleFocus)
  }

  function syncLoops(): void {
    if (!isResearchJobActive.value) {
      clearPollLoop()
      clearElapsedTimer()
      detachVisibilityListeners()

      return
    }

    startPollLoop()
    startElapsedTimer()
    attachVisibilityListeners()
  }

  function appendMessageDeduped(message: RawResearchMessage): void {
    const alreadyAppended = options.chatSdk.messages.some((existing) => {
      return existing.id === message.id
    })

    if (alreadyAppended) {
      return
    }

    options.chatSdk.messages = [
      ...options.chatSdk.messages,
      hydrateMessageUsage(message),
    ]

    nuxtApp.callHook('chat:scroll-to-bottom')
  }

  async function rehydrateResultMessage(
    resultMessageId: string,
  ): Promise<void> {
    try {
      const chat = await $fetch<Chat>(`/api/v1/chats/${options.chatSlug}`)
      const resultMessage = chat.messages.find((candidate) => {
        return candidate.id === resultMessageId
      })

      if (resultMessage) {
        appendMessageDeduped(resultMessage as unknown as RawResearchMessage)
      }
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to load the research report',
        parsedException.why,
      )
    }
  }

  // Round-8 issue #5: the pending block shows a rolling window of the last
  // few distinct steps instead of only the single latest one, so the
  // in-progress feel doesn't flicker down to nothing between polls whenever
  // a step repeats. Consecutive identical kind+text pairs are deduped (the
  // poll can return the same step across ticks while the provider is still
  // working through it) and the window is capped so the pending block
  // doesn't grow unbounded over a long-running job.
  function pushRecentStep(step: ResearchTraceEntry): void {
    const last = researchRecentSteps.value.at(-1)

    if (last && last.kind === step.kind && last.text === step.text) {
      return
    }

    researchRecentSteps.value = [...researchRecentSteps.value, step]
      .slice(-RESEARCH_RECENT_STEPS_MAX)
  }

  function applyJobUpdate(
    job: ResearchJobView | null,
    message?: RawResearchMessage,
  ): void {
    researchJob.value = job
    syncLoops()

    if (!job || TERMINAL_RESEARCH_JOB_STATUSES.includes(job.status)) {
      researchCurrentStep.value = null
      researchRecentSteps.value = []
    }

    if (job?.status !== 'completed') {
      return
    }

    if (message) {
      appendMessageDeduped(message)

      return
    }

    if (job.resultMessageId) {
      rehydrateResultMessage(job.resultMessageId)
    }
  }

  async function runPoll(): Promise<void> {
    if (isPolling || !researchJob.value) {
      return
    }

    isPolling = true

    try {
      const response = await $fetch<{
        job: ResearchJobView
        message?: RawResearchMessage
        currentStep?: ResearchTraceEntry
      }>(`/api/v1/chats/${options.chatSlug}/research`)

      applyJobUpdate(response.job, response.message)
      researchCurrentStep.value = response.currentStep ?? null

      if (response.currentStep) {
        pushRecentStep(response.currentStep)
      }
    } catch (exception) {
      void exception
    } finally {
      isPolling = false
      researchStatusChecking.value = false
    }
  }

  async function startResearchJob(
    input: StartResearchJobInput,
  ): Promise<boolean> {
    options.chatSdk.messages = [
      ...options.chatSdk.messages,
      {
        id: input.userMessage.id,
        role: 'user',
        parts: input.userMessage.parts,
        createdAt: new Date(),
      } as unknown as UIMessage,
    ]

    applyJobUpdate(
      buildLocalPendingResearchJob(userModel.value, input.answers),
    )

    try {
      const response = await $fetch<{ job: ResearchJobView }>(
        `/api/v1/chats/${options.chatSlug}/research`,
        {
          method: 'POST',
          body: {
            model: userModel.value,
            userMessage: input.userMessage,
            answers: input.answers,
          },
        },
      )

      applyJobUpdate(response.job)

      return true
    } catch (exception) {
      applyJobUpdate(null)

      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to start the research job',
        parsedException.why,
      )

      return false
    }
  }

  async function cancelResearchJob(): Promise<void> {
    if (!researchJob.value) {
      return
    }

    try {
      const response = await $fetch<{ job: ResearchJobView }>(
        `/api/v1/chats/${options.chatSlug}/research/cancel`,
        { method: 'POST' },
      )

      applyJobUpdate(response.job)
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to cancel the research job',
        parsedException.why,
      )
    }
  }

  function seedActiveResearchJob(job: ResearchJobView | null): void {
    applyJobUpdate(job)

    if (
      import.meta.client
        && job
        && ACTIVE_RESEARCH_JOB_STATUSES.includes(job.status)
    ) {
      researchStatusChecking.value = true
      pollOnce()
    }
  }

  function dismissResearchJob(): void {
    clearPollLoop()
    clearElapsedTimer()
    detachVisibilityListeners()
    researchJob.value = null
    researchElapsedMs.value = 0
    researchStatusChecking.value = false
    researchCurrentStep.value = null
    researchRecentSteps.value = []
  }

  function dispose(): void {
    clearPollLoop()
    clearElapsedTimer()
    detachVisibilityListeners()
    researchCurrentStep.value = null
    researchRecentSteps.value = []
  }

  return {
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
    dispose,
  }
}

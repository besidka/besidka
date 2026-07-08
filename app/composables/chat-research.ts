import type { UIMessage } from 'ai'
import type { Chat } from '#shared/types/chats.d'
import type {
  ResearchAnswer,
  ResearchJobStatus,
  ResearchJobView,
  ResearchLevel,
} from '#shared/types/research.d'
import { parseError } from 'evlog'

export interface UseChatResearchChatSdk {
  messages: UIMessage[]
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
  level: ResearchLevel
  answers?: ResearchAnswer[]
}

const RESEARCH_POLL_INTERVAL_MS = 10_000
const RESEARCH_ELAPSED_TICK_MS = 1_000
const ACTIVE_RESEARCH_JOB_STATUSES: ResearchJobStatus[] = [
  'pending',
  'running',
]

export function useChatResearch(options: UseChatResearchOptions) {
  const { userModel } = useUserModel()
  const nuxtApp = useNuxtApp()

  const researchJob = shallowRef<ResearchJobView | null>(null)
  const researchElapsedMs = shallowRef<number>(0)

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

  function appendMessageDeduped(message: UIMessage): void {
    const alreadyAppended = options.chatSdk.messages.some((existing) => {
      return existing.id === message.id
    })

    if (alreadyAppended) {
      return
    }

    options.chatSdk.messages = [...options.chatSdk.messages, message]

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
        appendMessageDeduped(resultMessage as unknown as UIMessage)
      }
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to load the research report',
        parsedException.why,
      )
    }
  }

  function applyJobUpdate(
    job: ResearchJobView | null,
    message?: UIMessage,
  ): void {
    researchJob.value = job
    syncLoops()

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
        message?: UIMessage
      }>(`/api/v1/chats/${options.chatSlug}/research`)

      applyJobUpdate(response.job, response.message)
    } catch (exception) {
      void exception
    } finally {
      isPolling = false
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

    try {
      const response = await $fetch<{ job: ResearchJobView }>(
        `/api/v1/chats/${options.chatSlug}/research`,
        {
          method: 'POST',
          body: {
            model: userModel.value,
            level: input.level,
            userMessage: input.userMessage,
            answers: input.answers,
          },
        },
      )

      applyJobUpdate(response.job)

      return true
    } catch (exception) {
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
  }

  function dismissResearchJob(): void {
    clearPollLoop()
    clearElapsedTimer()
    detachVisibilityListeners()
    researchJob.value = null
    researchElapsedMs.value = 0
  }

  function dispose(): void {
    clearPollLoop()
    clearElapsedTimer()
    detachVisibilityListeners()
  }

  return {
    researchJob,
    researchElapsedMs,
    isResearchJobActive,
    startResearchJob,
    cancelResearchJob,
    seedActiveResearchJob,
    dismissResearchJob,
    dispose,
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UIMessage } from 'ai'
import type { ResearchJobView } from '#shared/types/research.d'
import { useChatResearch } from '../../../app/composables/chat-research'

function createJob(
  overrides: Partial<ResearchJobView> = {},
): ResearchJobView {
  return {
    publicId: 'job-1',
    status: 'pending',
    provider: 'openai',
    level: 'quick',
    modelId: 'o4-mini-deep-research',
    startedAt: Date.now(),
    error: null,
    resultMessageId: null,
    ...overrides,
  }
}

function createChatSdk() {
  return {
    messages: [] as UIMessage[],
  }
}

describe('useChatResearch', () => {
  let visibilityHandler: (() => void) | null = null
  let focusHandler: (() => void) | null = null
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    visibilityHandler = null
    focusHandler = null

    vi.spyOn(document, 'addEventListener').mockImplementation(
      (type, handler) => {
        if (type === 'visibilitychange') {
          visibilityHandler = handler as () => void
        }
      },
    )
    vi.spyOn(document, 'removeEventListener').mockImplementation((type) => {
      if (type === 'visibilitychange') {
        visibilityHandler = null
      }
    })
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (type, handler) => {
        if (type === 'focus') {
          focusHandler = handler as () => void
        }
      },
    )
    vi.spyOn(window, 'removeEventListener').mockImplementation((type) => {
      if (type === 'focus') {
        focusHandler = null
      }
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })

    fetchMock = vi.fn()
    vi.stubGlobal('$fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('starts a job, appends the user message locally, and begins polling', async () => {
    const chatSdk = createChatSdk()

    fetchMock.mockResolvedValueOnce({
      job: createJob({ status: 'pending' }),
    })

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    const started = await research.startResearchJob({
      userMessage: {
        id: 'user-msg-1',
        parts: [{ type: 'text', text: 'Topic' }],
      },
    })

    expect(started).toBe(true)
    expect(chatSdk.messages).toHaveLength(1)
    expect(chatSdk.messages[0]?.id).toBe('user-msg-1')
    expect(chatSdk.messages[0]?.role).toBe('user')
    expect(research.researchJob.value?.status).toBe('pending')
    expect(research.isResearchJobActive.value).toBe(true)

    fetchMock.mockResolvedValueOnce({
      job: createJob({ status: 'running' }),
    })

    await vi.advanceTimersByTimeAsync(10_000)

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-1/research')
    expect(research.researchJob.value?.status).toBe('running')
  })

  it('seeds a synthetic local-pending job before the POST resolves', async () => {
    const chatSdk = createChatSdk()
    const { userModel } = useUserModel()

    userModel.value = 'o4-mini-deep-research'

    let resolveFetch!: (value: { job: ResearchJobView }) => void

    fetchMock.mockReturnValueOnce(new Promise((resolve) => {
      resolveFetch = resolve
    }))

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    const startPromise = research.startResearchJob({
      userMessage: { id: 'user-msg-1', parts: [] },
    })

    expect(research.researchJob.value).toEqual({
      publicId: 'local-pending',
      status: 'pending',
      provider: 'openai',
      level: 'quick',
      modelId: 'o4-mini-deep-research',
      startedAt: null,
      error: null,
      resultMessageId: null,
    })

    resolveFetch({ job: createJob({ status: 'pending', modelId: 'o4-mini-deep-research' }) })
    await startPromise

    expect(research.researchJob.value?.publicId).toBe('job-1')
  })

  it('reverts the synthetic pending job to null when starting a job fails', async () => {
    const chatSdk = createChatSdk()
    const { userModel } = useUserModel()

    userModel.value = 'o4-mini-deep-research'

    fetchMock.mockRejectedValueOnce(new Error('boom'))

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    const started = await research.startResearchJob({
      userMessage: { id: 'user-msg-1', parts: [] },
    })

    expect(started).toBe(false)
    expect(research.researchJob.value).toBeNull()
    expect(research.isResearchJobActive.value).toBe(false)
  })

  it('returns false and surfaces an error when starting a job fails', async () => {
    const chatSdk = createChatSdk()

    fetchMock.mockRejectedValueOnce(new Error('boom'))

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    const started = await research.startResearchJob({
      userMessage: { id: 'user-msg-1', parts: [] },
    })

    expect(started).toBe(false)
    expect(research.researchJob.value).toBeNull()
    expect(research.isResearchJobActive.value).toBe(false)
  })

  it('ticks the elapsed timer every second while a job is active', async () => {
    const chatSdk = createChatSdk()
    const startedAt = Date.now()

    fetchMock.mockResolvedValueOnce({
      job: createJob({ status: 'running', startedAt }),
    })

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    await research.startResearchJob({
      userMessage: { id: 'user-msg-1', parts: [] },
    })

    fetchMock.mockResolvedValue({
      job: createJob({ status: 'running', startedAt }),
    })

    await vi.advanceTimersByTimeAsync(3_000)

    expect(research.researchElapsedMs.value).toBeGreaterThanOrEqual(3_000)
  })

  it('appends the completed message and stops polling', async () => {
    const chatSdk = createChatSdk()
    const reportMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [],
    } as unknown as UIMessage

    fetchMock.mockResolvedValueOnce({
      job: createJob({ status: 'running' }),
    })

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    await research.startResearchJob({
      userMessage: { id: 'user-msg-1', parts: [] },
    })

    fetchMock.mockResolvedValueOnce({
      job: createJob({ status: 'completed' }),
      message: reportMessage,
    })

    await vi.advanceTimersByTimeAsync(10_000)

    expect(research.researchJob.value?.status).toBe('completed')
    expect(
      chatSdk.messages.some(message => message.id === 'assistant-1'),
    ).toBe(true)
    expect(research.isResearchJobActive.value).toBe(false)

    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('dedupes the completed message against one already appended', async () => {
    const chatSdk = createChatSdk()
    const reportMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [],
    } as unknown as UIMessage

    chatSdk.messages.push(reportMessage)

    fetchMock.mockResolvedValueOnce({
      job: createJob({ status: 'running' }),
    })

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    await research.startResearchJob({
      userMessage: { id: 'user-msg-1', parts: [] },
    })

    fetchMock.mockResolvedValueOnce({
      job: createJob({ status: 'completed' }),
      message: reportMessage,
    })

    await vi.advanceTimersByTimeAsync(10_000)

    expect(
      chatSdk.messages.filter(message => message.id === 'assistant-1'),
    ).toHaveLength(1)
  })

  it('sets the job error and stops the loops on failure', async () => {
    const chatSdk = createChatSdk()

    fetchMock.mockResolvedValueOnce({
      job: createJob({ status: 'running' }),
    })

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    await research.startResearchJob({
      userMessage: { id: 'user-msg-1', parts: [] },
    })

    fetchMock.mockResolvedValueOnce({
      job: createJob({
        status: 'failed',
        error: { code: 'unknown', message: 'Research failed' },
      }),
    })

    await vi.advanceTimersByTimeAsync(10_000)

    expect(research.researchJob.value?.status).toBe('failed')
    expect(research.researchJob.value?.error?.message).toBe(
      'Research failed',
    )
    expect(research.isResearchJobActive.value).toBe(false)

    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('cancels the job and stops polling', async () => {
    const chatSdk = createChatSdk()

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    research.seedActiveResearchJob(createJob({ status: 'running' }))

    fetchMock.mockResolvedValueOnce({
      job: createJob({ status: 'cancelled' }),
    })

    await research.cancelResearchJob()

    expect(research.researchJob.value?.status).toBe('cancelled')
    expect(research.isResearchJobActive.value).toBe(false)

    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('polls immediately on visibilitychange and on window focus', async () => {
    const chatSdk = createChatSdk()

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    fetchMock.mockResolvedValue({
      job: createJob({ status: 'running' }),
    })

    research.seedActiveResearchJob(createJob({ status: 'running' }))
    await Promise.resolve()

    fetchMock.mockClear()
    visibilityHandler?.()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockClear()
    focusHandler?.()
    await Promise.resolve()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('seeds an already-active job from the chat GET and resumes polling', async () => {
    const chatSdk = createChatSdk()

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    research.seedActiveResearchJob(createJob({ status: 'running' }))

    expect(research.isResearchJobActive.value).toBe(true)

    fetchMock.mockResolvedValueOnce({
      job: createJob({ status: 'running' }),
    })

    await vi.advanceTimersByTimeAsync(10_000)

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/chats/chat-1/research')
  })

  it('dismissResearchJob clears the job and stops the loops', async () => {
    const chatSdk = createChatSdk()

    const research = useChatResearch({ chatSlug: 'chat-1', chatSdk })

    research.seedActiveResearchJob(createJob({ status: 'failed' }))
    research.dismissResearchJob()

    expect(research.researchJob.value).toBeNull()
    expect(research.researchElapsedMs.value).toBe(0)

    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

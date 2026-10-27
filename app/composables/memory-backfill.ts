import { parseError } from 'evlog'
import type {
  MemoryBackfillEstimate,
  MemoryBackfillOverview,
  MemoryBackfillProgress,
  MemoryBackfillUnavailableReason,
} from '#shared/types/memory-backfill.d'
import type { MemoryBackfillErrorMessage } from '~/utils/memory-backfill'

const COOLDOWN_SAFETY_MS = 250
const MAX_CONSECUTIVE_STEP_FAILURES = 3

type StepOutcome = 'advanced' | 'cooldown' | 'idle' | 'failed' | 'busy'

interface StepResult {
  outcome: StepOutcome
  retryAfterMs: number
}

interface BackfillRequestOptions {
  restart?: boolean
}

interface PendingSleep {
  timer: ReturnType<typeof setTimeout>
  resolve: () => void
}

let nextSequence = 0
let appliedSequence = 0

export function useMemoryBackfill() {
  const overview = useState<MemoryBackfillOverview | null>(
    'memory-backfill-overview',
    () => null,
  )

  const isStarting = shallowRef<boolean>(false)
  const isCancelling = shallowRef<boolean>(false)
  const isPolling = shallowRef<boolean>(false)
  const isPaused = shallowRef<boolean>(false)
  const pendingLoads = shallowRef<number>(0)
  const error = shallowRef<MemoryBackfillErrorMessage | null>(null)
  const pollError = shallowRef<MemoryBackfillErrorMessage | null>(null)

  let isStepping = false
  let hasStepError = false
  let pollLoopId = 0
  let pendingSleep: PendingSleep | null = null

  const job = computed<MemoryBackfillProgress | null>(() => {
    return overview.value?.job ?? null
  })

  const estimate = computed<MemoryBackfillEstimate | null>(() => {
    return overview.value?.estimate ?? null
  })

  const reason = computed<MemoryBackfillUnavailableReason | null>(() => {
    return overview.value?.reason ?? null
  })

  const isRunning = computed<boolean>(() => {
    return job.value?.status === 'running'
  })

  const isLoading = computed<boolean>(() => {
    return pendingLoads.value > 0
  })

  function claimSequence(): number {
    nextSequence += 1

    return nextSequence
  }

  function applyOverview(
    sequence: number,
    next: MemoryBackfillOverview,
  ): boolean {
    if (sequence < appliedSequence) {
      return false
    }

    appliedSequence = sequence
    overview.value = next

    return true
  }

  function applyJob(
    sequence: number,
    nextJob: MemoryBackfillProgress | null,
  ): boolean {
    return applyOverview(sequence, {
      job: nextJob,
      estimate: overview.value?.estimate ?? null,
      reason: overview.value?.reason ?? null,
    })
  }

  function sleep(milliseconds: number): Promise<void> {
    return new Promise((resolve) => {
      pendingSleep = {
        timer: setTimeout(() => {
          pendingSleep = null
          resolve()
        }, milliseconds),
        resolve,
      }
    })
  }

  function cancelPendingSleep() {
    if (!pendingSleep) {
      return
    }

    clearTimeout(pendingSleep.timer)
    pendingSleep.resolve()
    pendingSleep = null
  }

  async function load(
    options: BackfillRequestOptions = {},
  ): Promise<boolean> {
    const sequence = claimSequence()

    pendingLoads.value += 1

    try {
      const response = await $fetch('/api/v1/memory/backfill', {
        query: options.restart ? { restart: 'true' } : {},
      })

      error.value = null

      return applyOverview(sequence, response)
    } catch (exception) {
      error.value = describeBackfillError(
        exception,
        'Failed to load the memory backfill.',
      )

      return false
    } finally {
      pendingLoads.value -= 1
    }
  }

  async function start(
    options: BackfillRequestOptions = {},
  ): Promise<boolean> {
    if (isStarting.value) {
      return false
    }

    const { ensureSendConsent, handleConsentError } = useLegalConsent()

    isStarting.value = true
    error.value = null

    if (!await ensureSendConsent(null)) {
      isStarting.value = false

      return false
    }

    const sequence = claimSequence()

    try {
      const response = await $fetch('/api/v1/memory/backfill', {
        method: 'POST',
        ...(options.restart ? { body: { restart: true } } : {}),
      })

      return applyJob(sequence, response.job)
    } catch (exception) {
      if (await handleConsentError(exception)) {
        return false
      }

      const described = describeBackfillError(
        exception,
        'Failed to start building memory.',
      )

      error.value = described

      if (described.status === 409) {
        await load()

        error.value = described
      }

      return false
    } finally {
      isStarting.value = false
    }
  }

  async function cancel(): Promise<boolean> {
    if (isCancelling.value) {
      return false
    }

    const wasPolling = isPolling.value

    stopPolling()
    isCancelling.value = true
    error.value = null

    const sequence = claimSequence()

    try {
      const response = await $fetch('/api/v1/memory/backfill/cancel', {
        method: 'POST',
      })
      const isApplied = applyJob(sequence, response.job)

      if (!response.job) {
        await load()
      }

      return isApplied
    } catch (exception) {
      error.value = describeBackfillError(
        exception,
        'Failed to stop building memory.',
      )

      if (wasPolling && isRunning.value) {
        startPolling()
      }

      return false
    } finally {
      isCancelling.value = false
    }
  }

  async function step(): Promise<StepResult> {
    if (isStepping) {
      return { outcome: 'busy', retryAfterMs: MEMORY_BACKFILL_COOLDOWN_MS }
    }

    isStepping = true

    const sequence = claimSequence()

    try {
      const response = await $fetch('/api/v1/memory/backfill/step', {
        method: 'POST',
      })

      applyJob(sequence, response.job)

      if (hasStepError) {
        error.value = null
        hasStepError = false
      }

      return { outcome: 'advanced', retryAfterMs: MEMORY_BACKFILL_COOLDOWN_MS }
    } catch (exception) {
      const parsedException = parseError(exception)

      if (parsedException.status === 429) {
        return {
          outcome: 'cooldown',
          retryAfterMs: getBackfillRetryAfterMs(exception),
        }
      }

      if (parsedException.status === 409) {
        await load()

        return { outcome: 'idle', retryAfterMs: 0 }
      }

      error.value = describeBackfillError(
        exception,
        'Failed to continue building memory.',
      )
      hasStepError = true

      return { outcome: 'failed', retryAfterMs: MEMORY_BACKFILL_COOLDOWN_MS }
    } finally {
      isStepping = false
    }
  }

  function resolveWaitMs(result: StepResult, elapsedMs: number): number {
    if (result.outcome === 'advanced') {
      return Math.max(
        MEMORY_BACKFILL_COOLDOWN_MS + COOLDOWN_SAFETY_MS - elapsedMs,
        0,
      )
    }

    return result.retryAfterMs
  }

  async function runPollLoop(loopId: number) {
    let consecutiveFailures = 0

    while (loopId === pollLoopId && isRunning.value) {
      const startedAt = Date.now()
      const result = await step()

      if (loopId !== pollLoopId || result.outcome === 'idle') {
        break
      }

      consecutiveFailures = result.outcome === 'failed'
        ? consecutiveFailures + 1
        : 0

      if (consecutiveFailures >= MAX_CONSECUTIVE_STEP_FAILURES) {
        isPaused.value = true
        pollError.value = error.value

        break
      }

      if (!isRunning.value) {
        break
      }

      await sleep(resolveWaitMs(result, Date.now() - startedAt))
    }

    if (loopId === pollLoopId) {
      isPolling.value = false
    }
  }

  function startPolling() {
    if (isPolling.value || !isRunning.value) {
      return
    }

    pollLoopId += 1
    isPolling.value = true
    isPaused.value = false
    pollError.value = null
    runPollLoop(pollLoopId)
  }

  function stopPolling() {
    pollLoopId += 1
    isPolling.value = false
    isPaused.value = false
    pollError.value = null
    cancelPendingSleep()
  }

  if (getCurrentScope()) {
    onScopeDispose(stopPolling)
  }

  return {
    overview,
    job,
    estimate,
    reason,
    isRunning,
    isLoading,
    isStarting,
    isCancelling,
    isPolling,
    isPaused,
    pollError,
    error,
    load,
    start,
    cancel,
    step,
    startPolling,
    stopPolling,
  }
}

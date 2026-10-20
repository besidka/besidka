import type {
  VideoTrigger,
  VideoWatchEndReason,
} from '#shared/types/analytics.d'

interface VideoWatchSession {
  trigger: VideoTrigger
  watchedSeconds: number
  maxPosition: number
  durationSeconds: number
  lastTime: number | null
}

const MAX_CONTINUOUS_DELTA_SECONDS = 1.5
const MIN_REPORTED_WATCH_SECONDS = 1
const DECIMAL_PRECISION = 10
const FULL_PERCENT = 100

const KEEPALIVE_END_REASONS = new Set<VideoWatchEndReason>([
  'hidden',
  'unmount',
])

function roundToTenth(value: number): number {
  return Math.round(value * DECIMAL_PRECISION) / DECIMAL_PRECISION
}

function toFiniteSeconds(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : 0
}

export function useVideoWatchAnalytics(getTarget: () => string) {
  const { track } = useLandingAnalytics()

  let session: VideoWatchSession | null = null
  let resumeTrigger: VideoTrigger | null = null

  function isActive(): boolean {
    return session !== null
  }

  function start(trigger: VideoTrigger, currentTime?: number): void {
    if (session) {
      return
    }

    resumeTrigger = null
    session = {
      trigger,
      watchedSeconds: 0,
      maxPosition: toFiniteSeconds(currentTime),
      durationSeconds: 0,
      lastTime: typeof currentTime === 'number' && Number.isFinite(currentTime)
        ? currentTime
        : null,
    }
  }

  function update(currentTime: number, duration: number): void {
    if (!Number.isFinite(currentTime)) {
      return
    }

    if (!session) {
      if (resumeTrigger && document.visibilityState === 'visible') {
        start(resumeTrigger, currentTime)
      }

      if (!session) {
        return
      }
    }

    session.durationSeconds = toFiniteSeconds(duration)

    if (session.lastTime !== null) {
      const delta = currentTime - session.lastTime

      if (delta > 0 && delta <= MAX_CONTINUOUS_DELTA_SECONDS) {
        session.watchedSeconds += delta
      }
    }

    session.lastTime = currentTime
    session.maxPosition = Math.max(session.maxPosition, currentTime)
  }

  function upgradeToUser(): boolean {
    if (!session || session.trigger === 'user') {
      return false
    }

    session.trigger = 'user'

    return true
  }

  function end(reason: VideoWatchEndReason): void {
    const finishedSession = session

    if (!finishedSession) {
      if (reason !== 'hidden') {
        resumeTrigger = null
      }

      return
    }

    session = null
    resumeTrigger = reason === 'hidden' ? finishedSession.trigger : null

    if (reason === 'ended') {
      finishedSession.maxPosition = Math.max(
        finishedSession.maxPosition,
        finishedSession.durationSeconds,
      )
    }

    if (finishedSession.watchedSeconds < MIN_REPORTED_WATCH_SECONDS) {
      return
    }

    const { durationSeconds } = finishedSession
    const watchedSeconds = durationSeconds
      ? Math.min(finishedSession.watchedSeconds, durationSeconds)
      : finishedSession.watchedSeconds
    const completionPercent = durationSeconds
      ? Math.min(
        FULL_PERCENT,
        Math.round(
          finishedSession.maxPosition / durationSeconds * FULL_PERCENT,
        ),
      )
      : 0

    track('video_watch', {
      target: getTarget(),
      value: roundToTenth(watchedSeconds),
      trigger: finishedSession.trigger,
      watchedSeconds: roundToTenth(watchedSeconds),
      durationSeconds: roundToTenth(durationSeconds),
      completionPercent,
      endReason: reason,
    }, { keepalive: KEEPALIVE_END_REASONS.has(reason) })
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'hidden') {
      end('hidden')
    }
  }

  function handlePageHide(): void {
    end('hidden')
  }

  if (import.meta.client) {
    useEventListener(document, 'visibilitychange', handleVisibilityChange)
    useEventListener(window, 'pagehide', handlePageHide)
  }

  tryOnBeforeUnmount(() => {
    end('unmount')
  })

  return { start, update, upgradeToUser, end, isActive }
}

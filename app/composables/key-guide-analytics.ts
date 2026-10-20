import type { KeyGuideOpenTrigger } from '#shared/types/analytics.d'

const openedProviders = new Set<string>()
const playedVideos = new Set<string>()

export function resetKeyGuideTracking(): void {
  openedProviders.clear()
  playedVideos.clear()
}

export function useKeyGuideAnalytics() {
  const { track } = useLandingAnalytics()

  function trackGuideOpen(
    provider: string,
    trigger: KeyGuideOpenTrigger,
  ): void {
    if (openedProviders.has(provider)) {
      return
    }

    openedProviders.add(provider)
    track('key_guide_open', {
      target: provider,
      value: trigger === 'user' ? 1 : 0,
      trigger,
    })
  }

  function trackGuideVideoPlay(
    provider: string,
    isUserInitiated: boolean,
  ): void {
    const value = isUserInitiated ? 1 : 0
    const playKey = `${provider}:${value}`

    if (playedVideos.has(playKey)) {
      return
    }

    playedVideos.add(playKey)
    track('key_guide_video_play', {
      target: provider,
      value,
      trigger: isUserInitiated ? 'user' : 'autoplay',
    })
  }

  return { trackGuideOpen, trackGuideVideoPlay }
}

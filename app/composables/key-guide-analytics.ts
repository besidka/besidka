const openedProviders = new Set<string>()
const playedVideos = new Set<string>()

export function resetKeyGuideTracking(): void {
  openedProviders.clear()
  playedVideos.clear()
}

export function useKeyGuideAnalytics() {
  const { track } = useLandingAnalytics()

  function trackGuideOpen(provider: string): void {
    if (openedProviders.has(provider)) {
      return
    }

    openedProviders.add(provider)
    track('key_guide_open', { target: provider })
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
    track('key_guide_video_play', { target: provider, value })
  }

  return { trackGuideOpen, trackGuideVideoPlay }
}

import type { VideoQuality } from '#shared/types/video.d'
import type {
  NavigatorWithConnection,
  VideoMenuOption,
} from '~/types/video-player.d'
import { pickInitialQuality } from '#shared/utils/video'

interface PendingQualitySwitch {
  listener: () => void
  resumeTime: number
  wasPaused: boolean
  rate: number
}

interface VideoQualityOptions {
  videoRef: Readonly<ShallowRef<HTMLVideoElement | null>>
  qualities: () => VideoQuality[]
  fallbackSrc: () => string
  measureElement: () => HTMLElement | null
  getPendingStartAt?: () => number | undefined
  onRestored?: () => void
  onSettled?: () => void
}

const FALLBACK_QUALITY = 720
const THUMBNAIL_QUALITY = 720

/**
 * Quality renditions of one `<video>`: the sorted menu options, the start
 * rendition (saved deliberate pick, then `pickInitialQuality`, then 720) and
 * the switch itself. While renditions exist and the start is unresolved
 * `currentSrc` is undefined, so the element is only ever given one source.
 * A switch swaps `src` and restores time, rate and play state on
 * `loadedmetadata`; a second switch before that reuses the first captured
 * values. `isResumingAfterSwitch` is true from a switch of a playing video
 * until its `play()` settles, so a player can tell the programmatic play and
 * pause events of a switch from user actions. `onSettled` runs then.
 */
export function useVideoQuality(options: VideoQualityOptions) {
  const currentQuality = shallowRef<number | null>(null)
  const hasResolvedStartQuality = shallowRef<boolean>(false)

  let userQuality: number | null = null
  let isResuming = false
  let pendingQualitySwitch: PendingQualitySwitch | null = null

  const sortedQualities = computed<VideoQuality[]>(() => {
    return [...options.qualities()].sort((a, b) => {
      return b.size - a.size
    })
  })

  const qualityOptions = computed<VideoMenuOption[]>(() => {
    return sortedQualities.value.map((quality) => {
      return { value: String(quality.size), label: `${quality.size}p` }
    })
  })

  const currentSrc = computed<string | undefined>(() => {
    if (sortedQualities.value.length && !hasResolvedStartQuality.value) {
      return undefined
    }

    const quality = sortedQualities.value.find((item) => {
      return item.size === currentQuality.value
    })

    return quality?.src ?? options.fallbackSrc()
  })

  const selectedQualityValue = computed<string>(() => {
    return currentQuality.value === null ? '' : String(currentQuality.value)
  })

  function qualitySizes(): number[] {
    return sortedQualities.value.map((quality) => {
      return quality.size
    })
  }

  function isKnownQuality(size: number): boolean {
    return qualitySizes().includes(size)
  }

  function getUserQuality(): number | null {
    return userQuality
  }

  function rememberUserQuality(size: number) {
    if (isKnownQuality(size)) {
      userQuality = size
    }
  }

  function thumbnailSource(): string {
    return options.qualities().find((quality) => {
      return quality.size === THUMBNAIL_QUALITY
    })?.src ?? options.fallbackSrc()
  }

  function fallbackQualitySize(): number | null {
    const sizes = qualitySizes()

    if (!sizes.length) {
      return null
    }

    return sizes.includes(FALLBACK_QUALITY) ? FALLBACK_QUALITY : sizes[0]!
  }

  function measureStartQuality(): number | null {
    const connection = (navigator as NavigatorWithConnection).connection

    return pickInitialQuality({
      sizes: qualitySizes(),
      playerWidth: options.measureElement()?.getBoundingClientRect().width
        ?? 0,
      devicePixelRatio: window.devicePixelRatio,
      saveData: connection?.saveData,
      effectiveType: connection?.effectiveType,
    })
  }

  function resolveStartQuality(savedQuality: number | null = null) {
    if (savedQuality !== null && isKnownQuality(savedQuality)) {
      userQuality = savedQuality
      currentQuality.value = savedQuality
    } else {
      currentQuality.value = measureStartQuality() ?? fallbackQualitySize()
    }

    hasResolvedStartQuality.value = true
  }

  function cancelPendingQualitySwitch(): PendingQualitySwitch | null {
    const pending = pendingQualitySwitch

    pendingQualitySwitch = null

    if (pending) {
      options.videoRef.value?.removeEventListener(
        'loadedmetadata',
        pending.listener,
      )
    }

    return pending
  }

  function abandonQualitySwitch() {
    cancelPendingQualitySwitch()
    isResuming = false
  }

  function selectQuality(size: number) {
    const video = options.videoRef.value

    if (!video || !isKnownQuality(size) || size === currentQuality.value) {
      return
    }

    const mediaElement: HTMLVideoElement = video
    const previous = cancelPendingQualitySwitch()
    const resumeTime = previous?.resumeTime
      ?? options.getPendingStartAt?.()
      ?? video.currentTime
    const wasPaused = previous?.wasPaused ?? video.paused
    const rate = previous?.rate ?? video.playbackRate

    async function resumePlayback() {
      if (pendingQualitySwitch?.listener === resumePlayback) {
        pendingQualitySwitch = null
      }

      const hasKnownDuration = Number.isFinite(mediaElement.duration)

      mediaElement.currentTime = hasKnownDuration
        && resumeTime >= mediaElement.duration
        ? 0
        : resumeTime
      mediaElement.defaultPlaybackRate = rate
      mediaElement.playbackRate = rate
      options.onRestored?.()

      if (wasPaused) {
        return
      }

      try {
        await mediaElement.play()
      } catch {
        return
      } finally {
        settleResume()
      }
    }

    function settleResume() {
      if (pendingQualitySwitch) {
        return
      }

      isResuming = false
      options.onSettled?.()
    }

    pendingQualitySwitch = {
      listener: resumePlayback,
      resumeTime,
      wasPaused,
      rate,
    }
    isResuming = !wasPaused

    if (mediaElement.preload === 'none') {
      mediaElement.preload = 'metadata'
    }

    mediaElement.addEventListener('loadedmetadata', resumePlayback, {
      once: true,
    })
    currentQuality.value = size
  }

  function isResumingAfterSwitch(): boolean {
    return isResuming
  }

  useEventListener(options.videoRef, 'error', abandonQualitySwitch)
  tryOnScopeDispose(abandonQualitySwitch)

  return {
    sortedQualities,
    qualityOptions,
    currentQuality,
    selectedQualityValue,
    currentSrc,
    thumbnailSource,
    resolveStartQuality,
    selectQuality,
    rememberUserQuality,
    getUserQuality,
    isResumingAfterSwitch,
  }
}

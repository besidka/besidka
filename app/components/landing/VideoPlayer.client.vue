<template>
  <div
    class="w-full"
    :aria-label="caption || 'Besidka demo video'"
  >
    <VideoShell
      variant="full"
      :poster="poster"
      container-class="js-landing-player shadow-xl"
      :qualities="qualityOptions"
      :selected-quality="selectedQualityValue"
      :speeds="SPEED_OPTIONS"
      :selected-speed="String(currentSpeed)"
      @ready="onPlayerReady"
      @failed="fallbackToNative"
      @select-quality="onSelectQuality"
      @select-speed="onSelectSpeed"
    >
      <video
        ref="videoRef"
        class="video-media"
        playsinline
        preload="metadata"
        crossorigin="anonymous"
        :src="currentSrc"
        :poster="poster || undefined"
        data-testid="video-media"
      >
        <track
          v-for="captionTrack in captions"
          :key="captionTrack.src"
          kind="captions"
          :src="captionTrack.src"
          :srclang="captionTrack.srclang"
          :label="captionTrack.label"
        >
        <track
          v-if="chaptersTrackUrl"
          kind="chapters"
          srclang="en"
          label="Chapters"
          :src="chaptersTrackUrl"
          default
        >
        <track
          v-if="thumbnailsTrackUrl"
          kind="metadata"
          label="thumbnails"
          :src="thumbnailsTrackUrl"
          default
        >
        <p class="sr-only">
          Your browser does not support the video element.
        </p>
      </video>

      <template #overlay>
        <div
          v-if="!isReady && !hasError"
          class="absolute inset-0 z-10 flex items-center justify-center
            overflow-hidden rounded-2xl"
          :class="{ 'skeleton skeleton--default': !poster }"
          aria-hidden="true"
          data-testid="player-loading"
        >
          <img
            v-if="poster"
            :src="poster"
            alt=""
            decoding="async"
            data-testid="player-loading-poster"
            class="absolute inset-0 size-full object-contain"
          >
          <Icon
            name="lucide:loader-circle"
            size="32"
            class="relative animate-spin"
            :class="poster
              ? 'text-white drop-shadow-md'
              : 'text-base-content/40'"
          />
        </div>
      </template>
    </VideoShell>

    <p
      v-if="caption"
      class="text-sm text-base-content/60 text-center mt-3"
    >
      {{ caption }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type {
  VideoQuality,
  VideoCaption,
  VideoMarker,
} from '#shared/types/video.d'
import type {
  VideoMenuOption,
  VideoShellReadyPayload,
} from '~/types/video-player.d'
import { toMarkerPoints } from '#shared/utils/video'

const props = withDefaults(defineProps<{
  src?: string
  poster?: string
  caption?: string
  qualities?: VideoQuality[]
  captions?: VideoCaption[]
  markers?: VideoMarker[]
  thumbnails?: boolean
  guideProvider?: string
  startAt?: number
}>(), {
  src: '/videos/demo.mp4',
  poster: undefined,
  caption: undefined,
  qualities: () => [],
  captions: () => [],
  markers: () => [],
  thumbnails: true,
  guideProvider: undefined,
  startAt: undefined,
})

const DEMO_TARGET = 'demo'
const DEFAULT_QUALITY = 720
const DEFAULT_SPEED = 1
const SPEED_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2]
const SPEED_OPTIONS: VideoMenuOption[] = SPEED_RATES.map((rate) => {
  return {
    value: String(rate),
    label: rate === DEFAULT_SPEED ? 'Normal' : `${rate}×`,
  }
})

const { track } = useLandingAnalytics()
const {
  start: startWatch,
  update: updateWatch,
  end: endWatch,
} = useVideoWatchAnalytics(() => {
  return analyticsTarget()
})

const videoRef = shallowRef<HTMLVideoElement | null>(null)
const isReady = shallowRef<boolean>(false)
const hasError = shallowRef<boolean>(false)
const currentSpeed = shallowRef<number>(DEFAULT_SPEED)

const sortedQualities = computed<VideoQuality[]>(() => {
  return [...props.qualities].sort((a, b) => {
    return b.size - a.size
  })
})

const qualityOptions = computed<VideoMenuOption[]>(() => {
  return sortedQualities.value.map((quality) => {
    return { value: String(quality.size), label: `${quality.size}p` }
  })
})

const currentQuality = shallowRef<number | null>(defaultQualitySize())

const currentSrc = computed<string>(() => {
  const quality = sortedQualities.value.find((item) => {
    return item.size === currentQuality.value
  })

  return quality?.src ?? props.src
})

const selectedQualityValue = computed<string>(() => {
  return currentQuality.value === null ? '' : String(currentQuality.value)
})

const markerPoints = toMarkerPoints(props.markers)

let hasTrackedPlay = false
let hasAppliedStartAt = false

const {
  chaptersTrackUrl,
  thumbnailsTrackUrl,
  attach: attachTimeline,
} = useVideoTimeline({
  videoRef,
  markerPoints,
  isThumbnailsEnabled: props.thumbnails,
  getThumbnailSource: () => {
    return props.qualities.find((quality) => {
      return quality.size === DEFAULT_QUALITY
    })?.src ?? props.src
  },
})

const { attach: attachPreferences, persist: persistPreferences }
  = useVideoPlayerPreferences({
    getQuality: () => {
      return currentQuality.value
    },
    getSpeed: () => {
      return videoRef.value?.playbackRate ?? DEFAULT_SPEED
    },
    applyQuality: (size) => {
      selectQuality(size)
    },
    applySpeed: (rate) => {
      applySpeed(rate)
    },
  })

function defaultQualitySize(): number | null {
  const sizes = sortedQualities.value.map((quality) => {
    return quality.size
  })

  if (!sizes.length) {
    return null
  }

  return sizes.includes(DEFAULT_QUALITY) ? DEFAULT_QUALITY : sizes[0]!
}

function analyticsTarget(): string {
  return props.guideProvider ?? DEMO_TARGET
}

function trackFirstPlay() {
  if (hasTrackedPlay) {
    return
  }

  hasTrackedPlay = true

  if (props.guideProvider) {
    track('key_guide_video_play', {
      target: props.guideProvider,
      value: 1,
      trigger: 'user',
    })

    return
  }

  track('video_play', { target: DEMO_TARGET, value: 1, trigger: 'user' })
}

function applySpeed(rate: number) {
  const video = videoRef.value

  if (!video || !SPEED_RATES.includes(rate)) {
    return
  }

  video.defaultPlaybackRate = rate
  video.playbackRate = rate
}

function selectQuality(size: number) {
  const video = videoRef.value
  const isKnown = sortedQualities.value.some((quality) => {
    return quality.size === size
  })

  if (!video || !isKnown || size === currentQuality.value) {
    return
  }

  const resumeTime = video.currentTime
  const wasPaused = video.paused
  const rate = video.playbackRate

  video.addEventListener('loadedmetadata', async () => {
    video.currentTime = resumeTime
    video.defaultPlaybackRate = rate
    video.playbackRate = rate

    if (wasPaused) {
      return
    }

    try {
      await video.play()
    } catch {
      return
    }
  }, { once: true })

  currentQuality.value = size
}

function onSelectQuality(value: string) {
  selectQuality(Number(value))
  persistPreferences()
}

function onSelectSpeed(value: string) {
  applySpeed(Number(value))
}

function applyStartAt() {
  const video = videoRef.value

  if (!video || hasAppliedStartAt || props.startAt === undefined) {
    return
  }

  if (
    video.readyState < HTMLMediaElement.HAVE_METADATA
    || !Number.isFinite(video.duration)
    || props.startAt >= video.duration
  ) {
    return
  }

  hasAppliedStartAt = true
  video.currentTime = props.startAt
}

useEventListener(videoRef, 'loadedmetadata', applyStartAt)

useEventListener(videoRef, 'ratechange', () => {
  currentSpeed.value = videoRef.value?.playbackRate ?? DEFAULT_SPEED
})

useEventListener(videoRef, 'play', () => {
  const video = videoRef.value

  trackFirstPlay()
  startWatch('user', video?.currentTime)
})

useEventListener(videoRef, 'timeupdate', () => {
  const video = videoRef.value

  if (video) {
    updateWatch(video.currentTime, video.duration)
  }
})

useEventListener(videoRef, 'pause', () => {
  endWatch(videoRef.value?.ended ? 'ended' : 'pause')
})

useEventListener(videoRef, 'ended', () => {
  endWatch('ended')
  track('video_complete', { target: analyticsTarget() })
})

function onPlayerReady({ player, timeSlider }: VideoShellReadyPayload) {
  isReady.value = true
  attachTimeline(timeSlider)
  attachPreferences(player)
  applyStartAt()
}

/** Native HTML5 fallback when the Video.js elements fail to load. */
function fallbackToNative() {
  const video = videoRef.value

  hasError.value = true

  if (!video) {
    return
  }

  video.controls = true

  if (!video.getAttribute('src') && props.src) {
    video.src = props.src
  }
}

onMounted(() => {
  removeLegacyPlyrPreferences()
})
</script>

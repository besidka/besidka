<template>
  <div
    ref="rootRef"
    class="w-full"
    :aria-label="caption || 'Besidka demo video'"
  >
    <VideoShell
      variant="full"
      container-class="js-landing-player shadow-xl"
      :qualities="qualityOptions"
      :selected-quality="selectedQualityValue"
      :speeds="VIDEO_SPEED_OPTIONS"
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
import type { VideoShellReadyPayload } from '~/types/video-player.d'
import { toMarkerPoints } from '#shared/utils/video'
import {
  DEFAULT_VIDEO_SPEED,
  VIDEO_SPEED_OPTIONS,
} from '~/utils/video-speed'

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

const { track } = useLandingAnalytics()
const {
  start: startWatch,
  update: updateWatch,
  end: endWatch,
} = useVideoWatchAnalytics(() => {
  return analyticsTarget()
})

const rootRef = shallowRef<HTMLElement | null>(null)
const videoRef = shallowRef<HTMLVideoElement | null>(null)
const isReady = shallowRef<boolean>(false)
const hasError = shallowRef<boolean>(false)
const { currentSpeed, applySpeed, syncSpeed } = useVideoSpeed(videoRef)

let hasTrackedPlay = false
let hasAppliedStartAt = false

const {
  qualityOptions,
  selectedQualityValue,
  currentSrc,
  thumbnailSource,
  resolveStartQuality,
  selectQuality,
  rememberUserQuality,
  getUserQuality,
} = useVideoQuality({
  videoRef,
  qualities: () => {
    return props.qualities
  },
  fallbackSrc: () => {
    return props.src
  },
  measureElement: () => {
    return rootRef.value
  },
  getPendingStartAt: () => {
    return !hasAppliedStartAt && isValidStartAt(props.startAt)
      ? props.startAt
      : undefined
  },
  onRestored: syncSpeed,
})

const markerPoints = toMarkerPoints(props.markers)

const {
  chaptersTrackUrl,
  thumbnailsTrackUrl,
  attach: attachTimeline,
} = useVideoTimeline({
  videoRef,
  markerPoints,
  isThumbnailsEnabled: props.thumbnails,
  getThumbnailSource: () => {
    return thumbnailSource()
  },
})

const {
  attach: attachPreferences,
  persist: persistPreferences,
  readSavedQuality,
} = useVideoPlayerPreferences({
  getQuality: getUserQuality,
  getSpeed: () => {
    return videoRef.value?.playbackRate ?? DEFAULT_VIDEO_SPEED
  },
  applyQuality: (size) => {
    selectQuality(size)
    rememberUserQuality(size)
  },
  applySpeed: (rate) => {
    applySpeed(rate)
  },
})

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

function isValidStartAt(startAt: number | undefined): startAt is number {
  return startAt !== undefined && Number.isFinite(startAt) && startAt >= 0
}

function onSelectQuality(value: string) {
  const size = Number(value)

  selectQuality(size)
  rememberUserQuality(size)
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

onMounted(() => {
  resolveStartQuality(readSavedQuality())
})

useEventListener(videoRef, 'loadedmetadata', applyStartAt)

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
</script>

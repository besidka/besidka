<template>
  <div
    ref="containerRef"
    class="w-full"
  >
    <VideoShell
      variant="lean"
      :qualities="qualityOptions"
      :selected-quality="selectedQualityValue"
      :speeds="VIDEO_SPEED_OPTIONS"
      :selected-speed="String(currentSpeed)"
      @ready="onPlayerReady"
      @select-quality="onSelectQuality"
      @select-speed="onSelectSpeed"
      @failed="fallbackToNative"
    >
      <video
        ref="videoRef"
        class="video-media"
        muted
        loop
        playsinline
        :preload="startAt === undefined ? 'none' : 'metadata'"
        :src="currentSrc"
        :poster="poster || undefined"
        :aria-label="label"
        data-testid="video-media"
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
    </VideoShell>
  </div>
</template>

<script setup lang="ts">
import type { VideoMarker, VideoQuality } from '#shared/types/video.d'
import type {
  VideoShellReadyPayload,
  WebKitPresentationVideo,
} from '~/types/video-player.d'
import { toMarkerPoints } from '#shared/utils/video'
import { canAutoplayGuideVideo } from '~/utils/key-guide-video'
import { VIDEO_SPEED_OPTIONS } from '~/utils/video-speed'

const props = withDefaults(defineProps<{
  provider?: string
  explainer?: string
  src: string
  label: string
  poster?: string
  markers?: VideoMarker[]
  qualities?: VideoQuality[]
  startAt?: number
}>(), {
  provider: undefined,
  explainer: undefined,
  poster: undefined,
  startAt: undefined,
  markers: () => [],
  qualities: () => [],
})

const emit = defineEmits<{
  failed: []
}>()

const VISIBILITY_THRESHOLD = 0.5
const WEBKIT_PIP_MODE = 'picture-in-picture'

const { trackGuideVideoPlay, trackExplainerVideoPlay } = useKeyGuideAnalytics()
const {
  start: startWatch,
  update: updateWatch,
  upgradeToUser: upgradeWatchToUser,
  end: endWatch,
} = useVideoWatchAnalytics(() => {
  return props.explainer ?? props.provider ?? ''
})

const containerRef = shallowRef<HTMLElement | null>(null)
const videoRef = shallowRef<HTMLVideoElement | null>(null)
const { currentSpeed, applySpeed, syncSpeed } = useVideoSpeed(videoRef)

const canAutoplay = canAutoplayGuideVideo()
const markerPoints = toMarkerPoints(props.markers)

let isPlayerReady = false
let isVisible = false
let isAutoplayRequested = false
let isProgrammaticPause = false
let hasUserPaused = false
let isPlayPending = false
let wasMuted = true
let hasAppliedStartAt = false

const {
  qualityOptions,
  selectedQualityValue,
  currentSrc,
  thumbnailSource,
  resolveStartQuality,
  selectQuality,
  isResumingAfterSwitch,
} = useVideoQuality({
  videoRef,
  qualities: () => {
    return props.qualities
  },
  fallbackSrc: () => {
    return props.src
  },
  measureElement: () => {
    return containerRef.value
  },
  getPendingStartAt: () => {
    return !hasAppliedStartAt && isValidStartAt(props.startAt)
      ? props.startAt
      : undefined
  },
  onRestored: syncSpeed,
  onSettled: syncPlayback,
})

const {
  chaptersTrackUrl,
  thumbnailsTrackUrl,
  attach: attachTimeline,
} = useVideoTimeline({
  videoRef,
  markerPoints,
  isThumbnailsEnabled: true,
  getThumbnailSource: thumbnailSource,
})

function trackVideoPlay(isUserInitiated: boolean) {
  if (props.explainer) {
    trackExplainerVideoPlay(props.explainer, isUserInitiated)

    return
  }

  if (props.provider) {
    trackGuideVideoPlay(props.provider, isUserInitiated)
  }
}

function isValidStartAt(startAt: number | undefined): startAt is number {
  return startAt !== undefined && Number.isFinite(startAt) && startAt >= 0
}

function applyStartAt() {
  const video = videoRef.value

  if (!video || hasAppliedStartAt || !isValidStartAt(props.startAt)) {
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

function isPictureInPicture(video: HTMLVideoElement): boolean {
  if (document.pictureInPictureElement === video) {
    return true
  }

  return (video as WebKitPresentationVideo)
    .webkitPresentationMode === WEBKIT_PIP_MODE
}

async function requestAutoplay(video: HTMLVideoElement) {
  isAutoplayRequested = true

  try {
    await video.play()
  } catch {
    isAutoplayRequested = false
  }
}

function syncPlayback() {
  const video = videoRef.value

  if (!video || !isPlayerReady || !canAutoplay || isResumingAfterSwitch()) {
    return
  }

  if (!isVisible) {
    if (isPictureInPicture(video)) {
      return
    }

    if (!video.paused) {
      isProgrammaticPause = true
      video.pause()
    }

    return
  }

  if (hasUserPaused || !video.paused) {
    return
  }

  requestAutoplay(video)
}

useIntersectionObserver(
  containerRef,
  ([entry]) => {
    isVisible = !!entry?.isIntersecting
    syncPlayback()
  },
  {
    root: () => {
      return containerRef.value?.closest('.js-page-content') ?? null
    },
    threshold: VISIBILITY_THRESHOLD,
  },
)

useEventListener(videoRef, 'loadedmetadata', applyStartAt)

useEventListener(videoRef, 'error', () => {
  emit('failed')
})

useEventListener(videoRef, 'leavepictureinpicture', syncPlayback)
useEventListener(videoRef, 'webkitpresentationmodechanged', syncPlayback)

useEventListener(videoRef, 'playing', () => {
  const video = videoRef.value

  if (!video || !isPlayPending || isResumingAfterSwitch()) {
    return
  }

  isPlayPending = false

  const isUserInitiated = !isAutoplayRequested

  trackVideoPlay(isUserInitiated)
  startWatch(
    isUserInitiated || !video.muted ? 'user' : 'autoplay',
    video.currentTime,
  )
  isAutoplayRequested = false
})

useEventListener(videoRef, 'play', () => {
  if (isResumingAfterSwitch()) {
    return
  }

  isPlayPending = true

  if (!isAutoplayRequested) {
    hasUserPaused = false
  }
})

useEventListener(videoRef, 'timeupdate', () => {
  const video = videoRef.value

  if (video) {
    updateWatch(video.currentTime, video.duration)
  }
})

useEventListener(videoRef, 'volumechange', () => {
  const video = videoRef.value

  if (!video) {
    return
  }

  const isUnmuted = wasMuted && !video.muted

  wasMuted = video.muted

  if (isUnmuted && upgradeWatchToUser()) {
    trackVideoPlay(true)
  }
})

useEventListener(videoRef, 'pause', () => {
  if (isResumingAfterSwitch()) {
    return
  }

  isPlayPending = false
  endWatch(isProgrammaticPause ? 'offscreen' : 'pause')

  if (isProgrammaticPause) {
    isProgrammaticPause = false

    return
  }

  hasUserPaused = true
})

function onSelectQuality(value: string) {
  selectQuality(Number(value))
}

function onSelectSpeed(value: string) {
  applySpeed(Number(value))
}

onMounted(() => {
  resolveStartQuality()
})

function onPlayerReady({ timeSlider }: VideoShellReadyPayload) {
  isPlayerReady = true
  attachTimeline(timeSlider)
  applyStartAt()
  syncPlayback()
}

function fallbackToNative() {
  const video = videoRef.value

  if (!video) {
    return
  }

  video.controls = true

  if (!video.getAttribute('src')) {
    video.src = props.src
  }
}
</script>

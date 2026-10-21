<template>
  <div
    ref="containerRef"
    class="w-full"
  >
    <VideoShell
      variant="lean"
      :poster="poster"
      @ready="onPlayerReady"
      @failed="fallbackToNative"
    >
      <video
        ref="videoRef"
        class="video-media"
        muted
        loop
        playsinline
        preload="none"
        :src="src"
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
import type { VideoMarker } from '#shared/types/video.d'
import type { VideoShellReadyPayload } from '~/types/video-player.d'
import { toMarkerPoints } from '#shared/utils/video'
import { canAutoplayGuideVideo } from '~/utils/key-guide-video'

const props = withDefaults(defineProps<{
  provider: string
  src: string
  label: string
  poster?: string
  markers?: VideoMarker[]
}>(), {
  poster: undefined,
  markers: () => [],
})

const emit = defineEmits<{
  failed: []
}>()

interface WebKitPresentationVideo extends HTMLVideoElement {
  webkitPresentationMode?: string
}

const VISIBILITY_THRESHOLD = 0.5
const WEBKIT_PIP_MODE = 'picture-in-picture'

const { trackGuideVideoPlay } = useKeyGuideAnalytics()
const {
  start: startWatch,
  update: updateWatch,
  upgradeToUser: upgradeWatchToUser,
  end: endWatch,
} = useVideoWatchAnalytics(() => {
  return props.provider
})

const containerRef = shallowRef<HTMLElement | null>(null)
const videoRef = shallowRef<HTMLVideoElement | null>(null)

const canAutoplay = canAutoplayGuideVideo()
const markerPoints = toMarkerPoints(props.markers)

let isPlayerReady = false
let isVisible = false
let isAutoplayRequested = false
let isProgrammaticPause = false
let hasUserPaused = false
let isPlayPending = false
let wasMuted = true

const {
  chaptersTrackUrl,
  thumbnailsTrackUrl,
  attach: attachTimeline,
} = useVideoTimeline({
  videoRef,
  markerPoints,
  isThumbnailsEnabled: true,
  getThumbnailSource: () => {
    return props.src
  },
})

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

  if (!video || !isPlayerReady || !canAutoplay) {
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

useEventListener(videoRef, 'error', () => {
  emit('failed')
})

useEventListener(videoRef, 'leavepictureinpicture', syncPlayback)
useEventListener(videoRef, 'webkitpresentationmodechanged', syncPlayback)

useEventListener(videoRef, 'playing', () => {
  const video = videoRef.value

  if (!video || !isPlayPending) {
    return
  }

  isPlayPending = false

  const isUserInitiated = !isAutoplayRequested

  trackGuideVideoPlay(props.provider, isUserInitiated)
  startWatch(
    isUserInitiated || !video.muted ? 'user' : 'autoplay',
    video.currentTime,
  )
  isAutoplayRequested = false
})

useEventListener(videoRef, 'play', () => {
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
    trackGuideVideoPlay(props.provider, true)
  }
})

useEventListener(videoRef, 'pause', () => {
  isPlayPending = false
  endWatch(isProgrammaticPause ? 'offscreen' : 'pause')

  if (isProgrammaticPause) {
    isProgrammaticPause = false

    return
  }

  hasUserPaused = true
})

function onPlayerReady({ timeSlider }: VideoShellReadyPayload) {
  isPlayerReady = true
  attachTimeline(timeSlider)
  syncPlayback()
}

function fallbackToNative() {
  const video = videoRef.value

  if (!video) {
    return
  }

  video.controls = true
}
</script>

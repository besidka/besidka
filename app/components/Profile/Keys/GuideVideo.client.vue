<template>
  <div
    ref="containerRef"
    class="landing-player relative w-full aspect-video
      rounded-2xl bg-base-300 ring-1 ring-base-content/10"
  >
    <video
      ref="videoRef"
      class="size-full"
      muted
      loop
      playsinline
      preload="none"
      :src="src"
      :poster="poster || undefined"
      :aria-label="label"
    >
      <p class="sr-only">
        Your browser does not support the video element.
      </p>
    </video>

    <VideoProgressPreview
      :target="plyrRef"
      :visible="!!sprite && preview.visible"
      :label="preview.label"
      :time-label="preview.timeLabel"
      :overlay-style="overlayStyle"
      :thumb-style="thumbStyle"
    />
  </div>
</template>

<script setup lang="ts">
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import '~/assets/css/plyr-theme.css'
import type { VideoMarker } from '#shared/types/video.d'
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

const VISIBILITY_THRESHOLD = 0.5

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
const plyrRef = shallowRef<HTMLElement | null>(null)

const canAutoplay = canAutoplayGuideVideo()
const markerPoints = toMarkerPoints(props.markers)

let player: Plyr | null = null
let isVisible = false
let isAutoplayRequested = false
let isProgrammaticPause = false
let hasUserPaused = false
let isPlayPending = false
let wasMuted = true

const {
  sprite,
  preview,
  overlayStyle,
  thumbStyle,
  attach: attachProgressPreview,
  dispose: disposeProgressPreview,
} = useVideoProgressPreview({
  containerRef,
  plyrRef,
  markerPoints,
  isEnabled: true,
  getThumbnailSource: () => {
    return props.src
  },
  seekTo: (time) => {
    if (player) {
      player.currentTime = time
    }
  },
  getDuration: () => {
    return player?.duration ?? 0
  },
})

async function requestAutoplay() {
  isAutoplayRequested = true

  try {
    await player?.play()
  } catch (_exception) {
    isAutoplayRequested = false
  }
}

function syncPlayback() {
  if (!player || !canAutoplay) {
    return
  }

  if (!isVisible) {
    if (player.pip) {
      return
    }

    if (!player.paused) {
      isProgrammaticPause = true
      player.pause()
    }

    return
  }

  if (hasUserPaused || !player.paused) {
    return
  }

  requestAutoplay()
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

function registerListeners(instance: Plyr) {
  instance.on('ready', () => {
    plyrRef.value = containerRef.value?.querySelector('.plyr') ?? null
    attachProgressPreview()
  })

  instance.on('playing', () => {
    if (!isPlayPending) {
      return
    }

    isPlayPending = false

    const isUserInitiated = !isAutoplayRequested

    trackGuideVideoPlay(props.provider, isUserInitiated)
    startWatch(
      isUserInitiated || !instance.muted ? 'user' : 'autoplay',
      instance.currentTime,
    )
    isAutoplayRequested = false
  })

  instance.on('play', () => {
    isPlayPending = true

    if (!isAutoplayRequested) {
      hasUserPaused = false
    }
  })

  instance.on('timeupdate', () => {
    updateWatch(instance.currentTime, instance.duration)
  })

  instance.on('volumechange', () => {
    const isUnmuted = wasMuted && !instance.muted

    wasMuted = instance.muted

    if (isUnmuted && upgradeWatchToUser()) {
      trackGuideVideoPlay(props.provider, true)
    }
  })

  instance.on('pause', () => {
    isPlayPending = false
    endWatch(isProgrammaticPause ? 'offscreen' : 'pause')

    if (isProgrammaticPause) {
      isProgrammaticPause = false

      return
    }

    hasUserPaused = true
  })
}

onMounted(() => {
  const element = videoRef.value

  if (!element) {
    return
  }

  try {
    player = new Plyr(element, {
      controls: [
        'play-large',
        'play',
        'progress',
        'mute',
        'pip',
        'fullscreen',
      ],
      markers: {
        enabled: markerPoints.length > 0,
        points: markerPoints,
      },
      muted: true,
      loop: { active: true },
      clickToPlay: true,
      ratio: '16:9',
      tooltips: { controls: true, seek: false },
      fullscreen: { enabled: true, iosNative: true },
      storage: { enabled: false },
    })
  } catch (_exception) {
    element.controls = true

    return
  }

  registerListeners(player)
  syncPlayback()
})

onUnmounted(() => {
  plyrRef.value = null
  disposeProgressPreview()
  player?.destroy()
  player = null
})
</script>

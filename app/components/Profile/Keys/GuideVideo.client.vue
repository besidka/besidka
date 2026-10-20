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
  </div>
</template>

<script setup lang="ts">
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import '~/assets/css/plyr-theme.css'
import { canAutoplayGuideVideo } from '~/utils/key-guide-video'

const props = withDefaults(defineProps<{
  provider: string
  src: string
  label: string
  poster?: string
}>(), {
  poster: undefined,
})

const emit = defineEmits<{
  failed: []
}>()

const VISIBILITY_THRESHOLD = 0.5

const { trackGuideVideoPlay } = useKeyGuideAnalytics()

const containerRef = shallowRef<HTMLElement | null>(null)
const videoRef = shallowRef<HTMLVideoElement | null>(null)

const canAutoplay = canAutoplayGuideVideo()

let player: Plyr | null = null
let isVisible = false
let isAutoplayRequested = false
let isProgrammaticPause = false
let hasUserPaused = false

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

function registerListeners(instance: Plyr) {
  instance.on('playing', () => {
    trackGuideVideoPlay(props.provider, !isAutoplayRequested)
    isAutoplayRequested = false
  })

  instance.on('play', () => {
    if (!isAutoplayRequested) {
      hasUserPaused = false
    }
  })

  instance.on('pause', () => {
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
      controls: ['play-large', 'play', 'progress', 'mute', 'fullscreen'],
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
  player?.destroy()
  player = null
})
</script>

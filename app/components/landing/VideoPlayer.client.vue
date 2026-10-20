<template>
  <div
    class="w-full"
    :aria-label="caption || 'Besidka demo video'"
  >
    <div
      ref="containerRef"
      class="landing-player js-landing-player relative w-full aspect-video
        rounded-2xl bg-base-300
        ring-1 ring-base-content/10 shadow-xl"
    >
      <video
        ref="videoRef"
        class="w-full h-full"
        playsinline
        preload="metadata"
        crossorigin="anonymous"
        :poster="poster || undefined"
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

      <div
        v-if="!isReady && !hasError"
        class="absolute inset-0 z-10 flex items-center justify-center
          overflow-hidden rounded-2xl"
        :class="{ 'skeleton skeleton--default': !poster }"
        aria-hidden="true"
      >
        <img
          v-if="poster"
          :src="poster"
          alt=""
          decoding="async"
          data-testid="player-loading-poster"
          class="absolute inset-0 size-full object-cover"
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
    </div>

    <p
      v-if="caption"
      class="text-sm text-base-content/60 text-center mt-3"
    >
      {{ caption }}
    </p>
  </div>
</template>

<script setup lang="ts">
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import '~/assets/css/plyr-theme.css'
import type {
  VideoQuality,
  VideoCaption,
  VideoMarker,
} from '#shared/types/video.d'
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
}>(), {
  src: '/videos/demo.mp4',
  poster: undefined,
  caption: undefined,
  qualities: () => [],
  captions: () => [],
  markers: () => [],
  thumbnails: true,
  guideProvider: undefined,
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
const { isAllowed, onConsentChange } = useCookieConsent()

const DEFAULT_QUALITY = 720

const videoRef = shallowRef<HTMLVideoElement | null>(null)
const containerRef = shallowRef<HTMLElement | null>(null)
const plyrRef = shallowRef<HTMLElement | null>(null)
const isReady = shallowRef<boolean>(false)
const hasError = shallowRef<boolean>(false)

const markerPoints = toMarkerPoints(props.markers)

let player: Plyr | null = null
let hasTrackedPlay = false

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
  isEnabled: props.thumbnails,
  getThumbnailSource: () => {
    return props.qualities.find((quality) => {
      return quality.size === DEFAULT_QUALITY
    })?.src ?? props.src
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

function sortedQualities(): VideoQuality[] {
  return [...props.qualities].sort((a, b) => {
    return b.size - a.size
  })
}

function buildSources(): Plyr.Source[] {
  const qualities = sortedQualities()

  if (qualities.length) {
    return qualities.map((quality) => {
      return { src: quality.src, type: 'video/mp4', size: quality.size }
    })
  }

  return [{ src: props.src, type: 'video/mp4' }]
}

function buildTracks(): Plyr.Track[] {
  return props.captions.map((caption) => {
    return {
      kind: 'captions',
      label: caption.label,
      srcLang: caption.srclang,
      src: caption.src,
      default: caption.default ?? false,
    }
  })
}

function buildOptions(): Plyr.Options {
  const sizes = sortedQualities().map((quality) => {
    return quality.size
  })

  const options: Plyr.Options = {
    controls: [
      'play-large',
      'play',
      'progress',
      'current-time',
      'mute',
      'volume',
      'captions',
      'settings',
      'pip',
      'airplay',
      'fullscreen',
    ],
    settings: ['captions', 'quality', 'speed'],
    speed: { selected: 1, options: [0.5, 0.75, 1, 1.25, 1.5, 2] },
    captions: { active: false, language: 'en', update: false },
    fullscreen: { enabled: true, iosNative: true },
    tooltips: { controls: true, seek: false },
    clickToPlay: true,
    ratio: '16:9',
    storage: { enabled: isAllowed('preferences'), key: 'plyr' },
  }

  if (sizes.length) {
    options.quality = {
      default: sizes.includes(DEFAULT_QUALITY) ? DEFAULT_QUALITY : sizes[0]!,
      options: sizes,
    }
  }

  if (markerPoints.length) {
    options.markers = { enabled: true, points: markerPoints }
  }

  return options
}

function keepMetadataPreload() {
  const media = containerRef.value?.querySelector('video')

  if (media) {
    media.preload = 'metadata'
  }
}

function registerListeners(instance: Plyr) {
  instance.on('ready', () => {
    isReady.value = true
    keepMetadataPreload()
    plyrRef.value = containerRef.value?.querySelector('.plyr') ?? null
    attachProgressPreview()
  })

  instance.on('play', () => {
    trackFirstPlay()
    startWatch('user', instance.currentTime)
  })

  instance.on('timeupdate', () => {
    updateWatch(instance.currentTime, instance.duration)
  })

  instance.on('pause', () => {
    endWatch(instance.ended ? 'ended' : 'pause')
  })

  instance.on('ended', () => {
    endWatch('ended')
    track('video_complete', { target: analyticsTarget() })
  })
}

function setPlyrStorageEnabled(enabled: boolean) {
  if (!player) {
    return
  }

  const storage = (player as unknown as { storage: { enabled: boolean } })
    .storage

  storage.enabled = enabled
}

onConsentChange(({ granted, denied }) => {
  if (granted.includes('preferences')) {
    setPlyrStorageEnabled(true)
  }

  if (denied.includes('preferences')) {
    setPlyrStorageEnabled(false)
    localStorage.removeItem('plyr')
  }
})

/** Native HTML5 fallback when Plyr fails to initialize. */
function fallbackToNative(element: HTMLVideoElement) {
  hasError.value = true
  element.controls = true

  if (!element.src && props.src) {
    element.src = props.src
  }
}

onMounted(() => {
  const element = videoRef.value

  if (!element) {
    return
  }

  try {
    player = new Plyr(element, buildOptions())
  } catch {
    fallbackToNative(element)

    return
  }

  registerListeners(player)

  player.source = {
    type: 'video',
    title: 'Besidka demo',
    poster: props.poster,
    sources: buildSources(),
    tracks: buildTracks(),
  }
})

onUnmounted(() => {
  plyrRef.value = null
  disposeProgressPreview()

  if (player) {
    player.destroy()
    player = null
  }
})
</script>

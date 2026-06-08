<template>
  <div
    class="w-full"
    :aria-label="caption || 'Besidka demo video'"
  >
    <div
      ref="containerRef"
      class="landing-player js-landing-player relative w-full aspect-video
        rounded-2xl overflow-hidden bg-base-300
        ring-1 ring-base-content/10 shadow-xl"
    >
      <video
        ref="videoRef"
        class="w-full h-full"
        playsinline
        crossorigin="anonymous"
        :poster="poster || undefined"
      >
        <p class="sr-only">
          Your browser does not support the video element.
        </p>
      </video>

      <div
        v-if="sprite && preview.visible"
        class="landing-player__preview pointer-events-none absolute z-20
          flex flex-col gap-1 p-1.5 rounded-2xl bubble"
        :style="overlayStyle"
        aria-hidden="true"
      >
        <div
          class="rounded-xl overflow-hidden ring-1 ring-accent/40"
          :style="thumbStyle"
        />
        <div class="flex items-center justify-between gap-2 px-1 pb-0.5">
          <span
            v-if="preview.label"
            class="text-xs font-medium text-base-content truncate max-w-[7rem]"
          >
            {{ preview.label }}
          </span>
          <span class="text-xs tabular-nums text-base-content/70 ml-auto">
            {{ preview.timeLabel }}
          </span>
        </div>
      </div>

      <div
        v-if="!isReady && !hasError"
        class="skeleton skeleton--default absolute inset-0 z-10
          flex items-center justify-center"
        aria-hidden="true"
      >
        <Icon
          name="lucide:loader-circle"
          size="32"
          class="animate-spin text-base-content/40"
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
import type { ThumbnailSprite } from '~/composables/landing-video-thumbnails'
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'
import '~/assets/css/plyr-theme.css'
import type {
  VideoQuality,
  VideoCaption,
  VideoMarker,
  VideoMarkerPoint,
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
}>(), {
  src: '/videos/demo.mp4',
  poster: undefined,
  caption: undefined,
  qualities: () => [],
  captions: () => [],
  markers: () => [],
  thumbnails: true,
})

const { track } = useLandingAnalytics()
const { generate } = useLandingVideoThumbnails()

const DEFAULT_QUALITY = 720
const THUMBNAIL_COUNT = 12

const videoRef = shallowRef<HTMLVideoElement | null>(null)
const containerRef = shallowRef<HTMLElement | null>(null)
const isReady = shallowRef<boolean>(false)
const hasError = shallowRef<boolean>(false)
const sprite = shallowRef<ThumbnailSprite | null>(null)

const preview = reactive({
  visible: false,
  left: 0,
  top: 0,
  bgX: 0,
  bgY: 0,
  timeLabel: '0:00',
  label: '',
})

const markerPoints: VideoMarkerPoint[] = toMarkerPoints(props.markers)

let player: Plyr | null = null
let hasTrackedPlay = false
let progressElement: HTMLElement | null = null
let detachPreview: (() => void) | null = null
let cancelled = false

const overlayStyle = computed(() => {
  return {
    left: `${preview.left}px`,
    top: `${preview.top}px`,
    width: `${sprite.value?.tileWidth ?? 160}px`,
  }
})

const thumbStyle = computed(() => {
  if (!sprite.value) {
    return {}
  }

  return {
    width: `${sprite.value.tileWidth}px`,
    height: `${sprite.value.tileHeight}px`,
    backgroundImage: `url(${sprite.value.url})`,
    backgroundPosition: `-${preview.bgX}px -${preview.bgY}px`,
    backgroundRepeat: 'no-repeat',
  }
})

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const secs = total % 60

  return `${minutes}:${String(secs).padStart(2, '0')}`
}

function chapterAt(time: number): string {
  let label = ''

  for (const point of markerPoints) {
    if (point.time <= time + 0.001) {
      label = point.label
      continue
    }

    break
  }

  return label
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

function onPreviewMove(event: PointerEvent) {
  const data = sprite.value
  const container = containerRef.value

  if (!data || !container || !progressElement) {
    return
  }

  const bar = progressElement.getBoundingClientRect()
  const box = container.getBoundingClientRect()
  const ratio = (event.clientX - bar.left) / bar.width
  const fraction = Math.min(1, Math.max(0, ratio))
  const time = fraction * data.duration
  const index = Math.min(data.count - 1, Math.floor(fraction * data.count))
  const column = index % data.columns

  preview.bgX = column * data.tileWidth
  preview.bgY = Math.floor(index / data.columns) * data.tileHeight
  preview.timeLabel = formatClock(time)
  preview.label = chapterAt(time)

  const left = (event.clientX - box.left) - data.tileWidth / 2

  preview.left = Math.min(
    box.width - data.tileWidth - 8,
    Math.max(8, left),
  )
  preview.top = Math.max(
    8,
    (bar.top - box.top) - data.tileHeight - 42,
  )
  preview.visible = true
}

function onPreviewLeave() {
  preview.visible = false
}

function setupPreview() {
  const container = containerRef.value

  if (!sprite.value || !container || detachPreview) {
    return
  }

  progressElement = container.querySelector('.plyr__progress')

  if (!progressElement) {
    return
  }

  progressElement.addEventListener('pointermove', onPreviewMove)
  progressElement.addEventListener('pointerleave', onPreviewLeave)

  detachPreview = () => {
    progressElement?.removeEventListener('pointermove', onPreviewMove)
    progressElement?.removeEventListener('pointerleave', onPreviewLeave)
    progressElement = null
  }
}

function registerListeners(instance: Plyr) {
  instance.on('ready', () => {
    isReady.value = true
    setupPreview()
  })

  instance.on('play', () => {
    if (hasTrackedPlay) {
      return
    }

    hasTrackedPlay = true
    track('video_play', { target: 'demo' })
  })

  instance.on('ended', () => {
    track('video_complete', { target: 'demo' })
  })
}

/** Native HTML5 fallback when Plyr fails to initialize. */
function fallbackToNative(element: HTMLVideoElement) {
  hasError.value = true
  element.controls = true

  if (!element.src && props.src) {
    element.src = props.src
  }
}

/**
 * Generate hover thumbnails in the background and attach the overlay once they
 * land. Never gates playback — frame decoding can take seconds, so the player
 * is already interactive by the time this resolves.
 */
async function loadThumbnails() {
  const thumbnailSource
    = props.qualities.find((quality) => {
      return quality.size === DEFAULT_QUALITY
    })?.src ?? props.src

  const result = await generate(thumbnailSource, { count: THUMBNAIL_COUNT })

  if (!result) {
    return
  }

  // The component may have unmounted while frames were decoding — discard the
  // late sprite so its object URL is revoked rather than leaked.
  if (cancelled) {
    result.cleanup()

    return
  }

  sprite.value = result
  setupPreview()
}

onMounted(async () => {
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

  if (props.thumbnails) {
    await loadThumbnails()
  }
})

onUnmounted(() => {
  cancelled = true
  detachPreview?.()

  if (player) {
    player.destroy()
    player = null
  }

  if (sprite.value) {
    sprite.value.cleanup()
    sprite.value = null
  }
})
</script>

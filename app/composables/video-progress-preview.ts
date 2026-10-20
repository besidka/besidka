import type { ThumbnailSprite } from '~/composables/landing-video-thumbnails'
import type { VideoMarkerPoint } from '#shared/types/video.d'

interface ProgressPreviewOptions {
  containerRef: ShallowRef<HTMLElement | null>
  plyrRef: ShallowRef<HTMLElement | null>
  markerPoints: VideoMarkerPoint[]
  isEnabled: boolean
  getThumbnailSource: () => string
  seekTo: (time: number) => void
  getDuration: () => number
}

const THUMBNAIL_COUNT = 12
const OVERLAY_H_PADDING = 12
const CLICK_DRAG_THRESHOLD = 6
const SNAP_FRACTION = 0.04
const MINIMUM_SNAP_RADIUS = 0.4

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(total / 60)
  const secs = total % 60

  return `${minutes}:${String(secs).padStart(2, '0')}`
}

/**
 * Hover-preview thumbnails and chapter-aware seeking for a Plyr progress bar.
 * Thumbnail generation starts lazily on the first progress-bar interaction so
 * playback never competes with a second download of the same file, and is
 * aborted on dispose. Never gates playback.
 */
export function useVideoProgressPreview(options: ProgressPreviewOptions) {
  const { generate } = useLandingVideoThumbnails()

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

  let progressElement: HTMLElement | null = null
  let detachPreview: (() => void) | null = null
  let detachThumbnailTrigger: (() => void) | null = null
  let hasStartedThumbnails = false
  let isDisposed = false
  let pointerDownX = 0

  const thumbnailsAbortController = new AbortController()

  const overlayStyle = computed(() => {
    return {
      left: `${preview.left}px`,
      top: `${preview.top}px`,
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

  function chapterAt(time: number): string {
    let label = ''

    for (const point of options.markerPoints) {
      if (point.time <= time + 0.001) {
        label = point.label
        continue
      }

      break
    }

    return label
  }

  function onPreviewMove(event: PointerEvent) {
    const data = sprite.value
    const plyrElement = options.plyrRef.value ?? options.containerRef.value

    if (!data || !plyrElement || !progressElement) {
      return
    }

    const bar = progressElement.getBoundingClientRect()
    const box = plyrElement.getBoundingClientRect()
    const ratio = (event.clientX - bar.left) / bar.width
    const fraction = Math.min(1, Math.max(0, ratio))
    const time = fraction * data.duration
    const index = Math.min(data.count - 1, Math.floor(fraction * data.count))
    const column = index % data.columns

    preview.bgX = column * data.tileWidth
    preview.bgY = Math.floor(index / data.columns) * data.tileHeight
    preview.timeLabel = formatClock(time)
    preview.label = chapterAt(time)

    const overlayWidth = data.tileWidth + OVERLAY_H_PADDING
    const left = (event.clientX - box.left) - overlayWidth / 2

    preview.left = Math.min(
      box.width - overlayWidth - 8,
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

  function onProgressPointerDown(event: PointerEvent) {
    pointerDownX = event.clientX
  }

  function onProgressPointerUp(event: PointerEvent) {
    const duration = options.getDuration()

    if (!options.markerPoints.length || !progressElement || !duration) {
      return
    }

    const moved = Math.abs(event.clientX - pointerDownX)

    if (moved >= CLICK_DRAG_THRESHOLD) {
      return
    }

    const bar = progressElement.getBoundingClientRect()
    const ratio = (event.clientX - bar.left) / bar.width
    const fraction = Math.min(1, Math.max(0, ratio))
    const clickedTime = fraction * duration
    const snapRadius = Math.max(MINIMUM_SNAP_RADIUS, duration * SNAP_FRACTION)
    let nearest: VideoMarkerPoint | null = null
    let nearestDistance = Infinity

    for (const point of options.markerPoints) {
      const distance = Math.abs(point.time - clickedTime)

      if (distance < nearestDistance) {
        nearestDistance = distance
        nearest = point
      }
    }

    if (nearest && nearestDistance <= snapRadius) {
      options.seekTo(nearest.time)
    }
  }

  function setupPreview() {
    const container = options.containerRef.value

    if (!sprite.value || !container || detachPreview) {
      return
    }

    progressElement = container.querySelector('.plyr__progress')

    if (!progressElement) {
      return
    }

    progressElement.addEventListener('pointermove', onPreviewMove)
    progressElement.addEventListener('pointerleave', onPreviewLeave)
    progressElement.addEventListener('pointerdown', onProgressPointerDown)
    progressElement.addEventListener('pointerup', onProgressPointerUp)

    detachPreview = () => {
      progressElement?.removeEventListener('pointermove', onPreviewMove)
      progressElement?.removeEventListener('pointerleave', onPreviewLeave)
      progressElement?.removeEventListener(
        'pointerdown',
        onProgressPointerDown,
      )
      progressElement?.removeEventListener('pointerup', onProgressPointerUp)
      progressElement = null
    }
  }

  async function loadThumbnails() {
    const result = await generate(options.getThumbnailSource(), {
      count: THUMBNAIL_COUNT,
      signal: thumbnailsAbortController.signal,
    })

    if (!result) {
      return
    }

    if (isDisposed) {
      result.cleanup()

      return
    }

    sprite.value = result
    setupPreview()
  }

  function startThumbnails() {
    if (!options.isEnabled || hasStartedThumbnails) {
      return
    }

    hasStartedThumbnails = true
    loadThumbnails()
  }

  function setupThumbnailTrigger() {
    const progress = options.containerRef.value
      ?.querySelector('.plyr__progress')

    if (!options.isEnabled || !progress || detachThumbnailTrigger) {
      return
    }

    progress.addEventListener('pointerenter', startThumbnails, { once: true })
    progress.addEventListener('focusin', startThumbnails, { once: true })

    detachThumbnailTrigger = () => {
      progress.removeEventListener('pointerenter', startThumbnails)
      progress.removeEventListener('focusin', startThumbnails)
    }
  }

  function attach() {
    setupPreview()
    setupThumbnailTrigger()
  }

  function dispose() {
    isDisposed = true
    thumbnailsAbortController.abort()
    detachPreview?.()
    detachThumbnailTrigger?.()

    if (sprite.value) {
      sprite.value.cleanup()
      sprite.value = null
    }
  }

  return {
    sprite,
    preview,
    overlayStyle,
    thumbStyle,
    attach,
    dispose,
  }
}

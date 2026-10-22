import type { ThumbnailSprite } from '~/composables/landing-video-thumbnails'
import type { VideoMarkerPoint } from '#shared/types/video.d'

interface VideoTimelineOptions {
  videoRef: ShallowRef<HTMLVideoElement | null>
  markerPoints: VideoMarkerPoint[]
  isThumbnailsEnabled: boolean
  getThumbnailSource: () => string
}

const THUMBNAIL_COUNT = 12
const CLICK_DRAG_THRESHOLD = 6
const SNAP_FRACTION = 0.04
const MINIMUM_SNAP_RADIUS = 0.4
const OPEN_CHAPTER_END_SECONDS = 359999
const VTT_MIME_TYPE = 'text/vtt'
const PREVIEW_EDGE_INSET = 8
const PREVIEW_SHIFT_PROPERTY = '--video-preview-shift'

interface PreviewShiftInput {
  pointerX: number
  sliderLeft: number
  sliderWidth: number
  cardWidth: number
  containerLeft: number
  containerWidth: number
  inset?: number
}

function formatVttTimestamp(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000))
  const hours = Math.floor(totalMilliseconds / 3600000)
  const minutes = Math.floor(totalMilliseconds / 60000) % 60
  const wholeSeconds = Math.floor(totalMilliseconds / 1000) % 60
  const milliseconds = totalMilliseconds % 1000

  return [
    String(hours).padStart(2, '0'),
    String(minutes).padStart(2, '0'),
    `${String(wholeSeconds).padStart(2, '0')}.${
      String(milliseconds).padStart(3, '0')}`,
  ].join(':')
}

function escapeCueText(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function buildVttDocument(
  cues: Array<{ start: number, end: number, text: string }>,
): string {
  const blocks = cues.map((cue) => {
    return `${formatVttTimestamp(cue.start)} --> ${
      formatVttTimestamp(cue.end)}\n${cue.text}`
  })

  return ['WEBVTT', ...blocks].join('\n\n') + '\n'
}

/**
 * Builds a WebVTT chapters document from marker points. The last chapter is
 * open-ended; the player clamps chapter cues to the real media duration.
 */
export function buildChaptersVtt(markerPoints: VideoMarkerPoint[]): string {
  const cues = markerPoints.map((point, index) => {
    const nextPoint = markerPoints[index + 1]

    return {
      start: point.time,
      end: nextPoint ? nextPoint.time : OPEN_CHAPTER_END_SECONDS,
      text: escapeCueText(point.label),
    }
  }).filter((cue) => {
    return cue.end > cue.start
  })

  return buildVttDocument(cues)
}

export function buildThumbnailsVtt(sprite: ThumbnailSprite): string {
  const step = sprite.duration / sprite.count
  const cues = Array.from({ length: sprite.count }, (_value, index) => {
    const column = index % sprite.columns
    const row = Math.floor(index / sprite.columns)
    const x = column * sprite.tileWidth
    const y = row * sprite.tileHeight
    const isLast = index === sprite.count - 1

    return {
      start: index * step,
      end: isLast ? sprite.duration : (index + 1) * step,
      text: `${sprite.url}#xywh=${x},${y},${sprite.tileWidth},${
        sprite.tileHeight}`,
    }
  })

  return buildVttDocument(cues)
}

/**
 * Horizontal shift, in pixels, that keeps the hover preview card inside the
 * player box. The card is positioned centered on the pointer (clamped to the
 * slider); on narrow players the slider is much narrower than the card, so
 * the card is pulled back to `inset` pixels from the player edges instead.
 */
export function computePreviewShift(input: PreviewShiftInput): number {
  const inset = input.inset ?? PREVIEW_EDGE_INSET

  if (input.sliderWidth <= 0 || input.cardWidth <= 0) {
    return 0
  }

  const sliderRight = input.sliderLeft + input.sliderWidth
  const pointerX = Math.min(
    Math.max(input.pointerX, input.sliderLeft),
    sliderRight,
  )
  const centeredLeft = pointerX - input.cardWidth / 2
  const minimumLeft = input.containerLeft + inset
  const maximumLeft = input.containerLeft
    + input.containerWidth
    - input.cardWidth
    - inset
  const clampedLeft = Math.max(minimumLeft, Math.min(centeredLeft, maximumLeft))

  return clampedLeft - centeredLeft
}

function createVttUrl(content: string): string {
  return URL.createObjectURL(new Blob([content], { type: VTT_MIME_TYPE }))
}

/**
 * Chapters, hover thumbnails and chapter-aware seeking for a Video.js time
 * slider. Chapters become a Blob-URL WebVTT track; the thumbnail sprite is
 * generated lazily on the first slider interaction (aborted on dispose) and
 * exposed as a Blob-URL storyboard track. Never gates playback.
 */
export function useVideoTimeline(options: VideoTimelineOptions) {
  const { generate } = useLandingVideoThumbnails()

  const chaptersTrackUrl = shallowRef<string | null>(null)
  const thumbnailsTrackUrl = shallowRef<string | null>(null)

  let sprite: ThumbnailSprite | null = null
  let slider: HTMLElement | null = null
  let hasStartedThumbnails = false
  let isDisposed = false
  let pointerDownX = 0
  let lastPointerX: number | null = null
  let previewResizeObserver: ResizeObserver | null = null
  let snapTimer: ReturnType<typeof setTimeout> | null = null

  const thumbnailsAbortController = new AbortController()

  if (import.meta.client && options.markerPoints.length) {
    chaptersTrackUrl.value = createVttUrl(
      buildChaptersVtt(options.markerPoints),
    )
  }

  function enableMetadataTracks() {
    const video = options.videoRef.value

    if (!video) {
      return
    }

    const tracks = video.querySelectorAll<HTMLTrackElement>(
      'track[kind="chapters"], track[kind="metadata"]',
    )

    for (const trackElement of tracks) {
      if (trackElement.track.mode === 'disabled') {
        trackElement.track.mode = 'hidden'
      }
    }
  }

  watch(
    [options.videoRef, chaptersTrackUrl, thumbnailsTrackUrl],
    enableMetadataTracks,
    { flush: 'post', immediate: true },
  )

  function nearestMarkerTime(clickedTime: number, duration: number) {
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

    if (!nearest || nearestDistance > snapRadius) {
      return null
    }

    return nearest.time
  }

  function updatePreviewShift() {
    if (!slider || lastPointerX === null) {
      return
    }

    const preview = slider.querySelector<HTMLElement>('media-slider-preview')
    const container = slider.closest<HTMLElement>('media-container')

    if (!preview || !container) {
      return
    }

    const sliderRect = slider.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const shift = computePreviewShift({
      pointerX: lastPointerX,
      sliderLeft: sliderRect.left,
      sliderWidth: sliderRect.width,
      cardWidth: preview.offsetWidth,
      containerLeft: containerRect.left,
      containerWidth: containerRect.width,
    })

    slider.style.setProperty(PREVIEW_SHIFT_PROPERTY, `${shift}px`)
  }

  function onSliderPointerMove(event: PointerEvent) {
    lastPointerX = event.clientX
    updatePreviewShift()
  }

  function onSliderPointerDown(event: PointerEvent) {
    pointerDownX = event.clientX
    onSliderPointerMove(event)
  }

  function onSliderPointerUp(event: PointerEvent) {
    const video = options.videoRef.value
    const duration = video?.duration ?? 0

    if (
      !video
      || !slider
      || !options.markerPoints.length
      || !Number.isFinite(duration)
      || duration <= 0
    ) {
      return
    }

    if (Math.abs(event.clientX - pointerDownX) >= CLICK_DRAG_THRESHOLD) {
      return
    }

    const bar = slider.getBoundingClientRect()
    const ratio = (event.clientX - bar.left) / bar.width
    const fraction = Math.min(1, Math.max(0, ratio))
    const target = nearestMarkerTime(fraction * duration, duration)

    if (target === null) {
      return
    }

    if (snapTimer) {
      clearTimeout(snapTimer)
    }

    snapTimer = setTimeout(() => {
      snapTimer = null
      video.currentTime = target
    }, 0)
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

    sprite = result
    thumbnailsTrackUrl.value = createVttUrl(buildThumbnailsVtt(result))
  }

  function startThumbnails() {
    if (!options.isThumbnailsEnabled || hasStartedThumbnails) {
      return
    }

    hasStartedThumbnails = true
    loadThumbnails()
  }

  function detachSlider() {
    if (!slider) {
      return
    }

    slider.removeEventListener('pointerdown', onSliderPointerDown)
    slider.removeEventListener('pointerup', onSliderPointerUp)
    slider.removeEventListener('pointerenter', onSliderPointerMove)
    slider.removeEventListener('pointermove', onSliderPointerMove)
    slider.removeEventListener('pointerenter', startThumbnails)
    slider.removeEventListener('focusin', startThumbnails)
    slider.style.removeProperty(PREVIEW_SHIFT_PROPERTY)
    previewResizeObserver?.disconnect()
    previewResizeObserver = null
    lastPointerX = null
    slider = null
  }

  function observePreviewWidth() {
    const preview = slider?.querySelector<HTMLElement>('media-slider-preview')

    if (!preview || typeof ResizeObserver === 'undefined') {
      return
    }

    previewResizeObserver = new ResizeObserver(updatePreviewShift)
    previewResizeObserver.observe(preview)
  }

  function attach(element: HTMLElement | null) {
    if (isDisposed || !element || element === slider) {
      return
    }

    detachSlider()
    slider = element
    slider.addEventListener('pointerdown', onSliderPointerDown)
    slider.addEventListener('pointerup', onSliderPointerUp)
    slider.addEventListener('pointerenter', onSliderPointerMove)
    slider.addEventListener('pointermove', onSliderPointerMove)
    observePreviewWidth()

    if (options.isThumbnailsEnabled && !hasStartedThumbnails) {
      slider.addEventListener('pointerenter', startThumbnails, { once: true })
      slider.addEventListener('focusin', startThumbnails, { once: true })
    }
  }

  function revokeUrl(url: string | null) {
    if (url) {
      URL.revokeObjectURL(url)
    }
  }

  function dispose() {
    isDisposed = true
    thumbnailsAbortController.abort()
    detachSlider()

    if (snapTimer) {
      clearTimeout(snapTimer)
      snapTimer = null
    }

    revokeUrl(chaptersTrackUrl.value)
    revokeUrl(thumbnailsTrackUrl.value)
    chaptersTrackUrl.value = null
    thumbnailsTrackUrl.value = null
    sprite?.cleanup()
    sprite = null
  }

  tryOnScopeDispose(dispose)

  return {
    chaptersTrackUrl,
    thumbnailsTrackUrl,
    attach,
    dispose,
  }
}

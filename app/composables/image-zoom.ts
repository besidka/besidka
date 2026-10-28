import Panzoom from '@panzoom/panzoom'
import type { PanzoomObject } from '@panzoom/panzoom'

const MIN_SCALE: number = 1
const MAX_SCALE: number = 5
const DOUBLE_TAP_SCALE: number = 2.5
const PINCH_STEP: number = 1
const WHEEL_SENSITIVITY: number = 0.002
const TRACKPAD_PINCH_SENSITIVITY: number = 0.01
const WHEEL_LINE_HEIGHT_PX: number = 16
const ZOOMED_SCALE_TOLERANCE: number = 0.01
const DOUBLE_TAP_MAX_INTERVAL_MS: number = 300
const DOUBLE_TAP_MAX_DISTANCE_PX: number = 25

export interface ZoomPointerEvent {
  pointerId: number
  pointerType: string
  button: number
  clientX: number
  clientY: number
  timeStamp: number
}

export interface ZoomWheelEvent {
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
}

interface TapRecord {
  pointerType: string
  clientX: number
  clientY: number
  timeStamp: number
}

interface DoubleTapOptions {
  maxIntervalMs?: number
  maxDistance?: number
}

function getDistance(
  first: { clientX: number, clientY: number },
  second: { clientX: number, clientY: number },
): number {
  return Math.hypot(
    first.clientX - second.clientX,
    first.clientY - second.clientY,
  )
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function getWheelZoomScale(
  currentScale: number,
  event: ZoomWheelEvent,
): number {
  const deltaPixels = event.deltaMode === 1
    ? event.deltaY * WHEEL_LINE_HEIGHT_PX
    : event.deltaY
  const sensitivity = event.ctrlKey
    ? TRACKPAD_PINCH_SENSITIVITY
    : WHEEL_SENSITIVITY
  const nextScale = currentScale * Math.exp(-deltaPixels * sensitivity)

  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, nextScale))
}

/**
 * Detects two quick, stationary taps of the same pointer type. Gestures that
 * involve a second pointer (pinch) or travel too far (pan) never count.
 */
export function createDoubleTapDetector(options: DoubleTapOptions = {}) {
  const maxIntervalMs = options.maxIntervalMs ?? DOUBLE_TAP_MAX_INTERVAL_MS
  const maxDistance = options.maxDistance ?? DOUBLE_TAP_MAX_DISTANCE_PX
  const activePointerIds = new Set<number>()
  let isGestureCancelled: boolean = false
  let downPoint: ZoomPointerEvent | null = null
  let lastTap: TapRecord | null = null

  function reset() {
    activePointerIds.clear()
    isGestureCancelled = false
    downPoint = null
    lastTap = null
  }

  function onPointerDown(event: ZoomPointerEvent) {
    if (event.pointerType === 'mouse') {
      activePointerIds.clear()
    }

    activePointerIds.add(event.pointerId)

    if (activePointerIds.size > 1) {
      isGestureCancelled = true
      downPoint = null
      lastTap = null

      return
    }

    isGestureCancelled = false
    downPoint = event
  }

  function onPointerCancel(event: ZoomPointerEvent) {
    activePointerIds.delete(event.pointerId)
    downPoint = null
    lastTap = null

    if (activePointerIds.size === 0) {
      isGestureCancelled = false
    }
  }

  function onPointerUp(event: ZoomPointerEvent): boolean {
    activePointerIds.delete(event.pointerId)

    const wasCancelled = isGestureCancelled
    const start = downPoint

    downPoint = null

    if (activePointerIds.size === 0) {
      isGestureCancelled = false
    }

    if (wasCancelled || !start || event.button > 0) {
      return false
    }

    if (getDistance(start, event) > maxDistance) {
      lastTap = null

      return false
    }

    const previousTap = lastTap
    const isDoubleTap = !!previousTap
      && previousTap.pointerType === event.pointerType
      && event.timeStamp - previousTap.timeStamp <= maxIntervalMs
      && getDistance(previousTap, event) <= maxDistance

    if (isDoubleTap) {
      lastTap = null

      return true
    }

    lastTap = {
      pointerType: event.pointerType,
      clientX: event.clientX,
      clientY: event.clientY,
      timeStamp: event.timeStamp,
    }

    return false
  }

  return {
    onPointerDown,
    onPointerUp,
    onPointerCancel,
    reset,
  }
}

/**
 * In-modal image zoom. Native browser zoom is not usable here: the global
 * viewport meta disables it and installed PWAs honour that.
 */
export function useImageZoom(
  surfaceRef: Readonly<ShallowRef<HTMLElement | null>>,
) {
  const doubleTapDetector = createDoubleTapDetector()
  let panzoom: PanzoomObject | null = null
  let boundSurface: HTMLElement | null = null

  function onWheel(event: WheelEvent) {
    event.preventDefault()

    if (!panzoom) {
      return
    }

    panzoom.zoomToPoint(getWheelZoomScale(panzoom.getScale(), event), event)
  }

  function onPointerDown(event: PointerEvent) {
    doubleTapDetector.onPointerDown(event)
  }

  function onPointerCancel(event: PointerEvent) {
    doubleTapDetector.onPointerCancel(event)
  }

  function toggleZoom(point: { clientX: number, clientY: number }) {
    if (!panzoom) {
      return
    }

    const isZoomed = panzoom.getScale() > MIN_SCALE + ZOOMED_SCALE_TOLERANCE

    if (isZoomed) {
      panzoom.reset({ animate: !prefersReducedMotion() })

      return
    }

    panzoom.zoomToPoint(DOUBLE_TAP_SCALE, point)
  }

  function onPointerUp(event: PointerEvent) {
    if (doubleTapDetector.onPointerUp(event)) {
      toggleZoom(event)
    }
  }

  function unbindSurface() {
    if (!boundSurface) {
      return
    }

    boundSurface.removeEventListener('wheel', onWheel)
    boundSurface.removeEventListener('pointerdown', onPointerDown)
    boundSurface.removeEventListener('pointerup', onPointerUp)
    boundSurface.removeEventListener('pointercancel', onPointerCancel)
    boundSurface = null
  }

  function destroy() {
    unbindSurface()
    doubleTapDetector.reset()

    if (!panzoom) {
      return
    }

    panzoom.reset({ animate: false })
    panzoom.resetStyle()
    panzoom.destroy()
    panzoom = null
  }

  function setup() {
    destroy()

    const surface = surfaceRef.value

    if (!surface) {
      return
    }

    panzoom = Panzoom(surface, {
      contain: 'outside',
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
      startScale: MIN_SCALE,
      step: PINCH_STEP,
      panOnlyWhenZoomed: true,
      cursor: 'default',
      touchAction: 'none',
    })

    surface.addEventListener('wheel', onWheel, { passive: false })
    surface.addEventListener('pointerdown', onPointerDown)
    surface.addEventListener('pointerup', onPointerUp)
    surface.addEventListener('pointercancel', onPointerCancel)
    boundSurface = surface
  }

  onBeforeUnmount(destroy)

  return {
    setup,
    destroy,
  }
}

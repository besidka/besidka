const PINCH_SENSITIVITY: number = 0.01
const MAX_PINCH_DELTA: number = 25
const DISCRETE_WHEEL_STEP: number = 0.1
const MOUSE_WHEEL_MIN_DELTA: number = 100
const MOUSE_WHEEL_NOTCH: number = 120

export interface DiagramWheelInput {
  deltaX: number
  deltaY: number
  deltaMode: number
  ctrlKey: boolean
  wheelDeltaY?: number
}

export type DiagramWheelAction
  = | { kind: 'zoom', factor: number }
    | { kind: 'pan', x: number, y: number }

function isDiscreteWheel(event: DiagramWheelInput): boolean {
  if (event.deltaMode !== 0) {
    return true
  }

  if (event.deltaX !== 0 || Math.abs(event.deltaY) < MOUSE_WHEEL_MIN_DELTA) {
    return false
  }

  if (typeof event.wheelDeltaY !== 'number') {
    return Number.isInteger(event.deltaY)
  }

  return event.wheelDeltaY !== 0
    && Math.abs(event.wheelDeltaY) % MOUSE_WHEEL_NOTCH === 0
}

/**
 * Classifies a wheel event for a pannable, zoomable diagram. A trackpad pinch
 * arrives as a burst of small wheel deltas with ctrlKey and zooms smoothly by
 * the delta size; a mouse wheel notch zooms by one fixed step (line-based
 * or notched deltas); every other wheel event is a two-finger swipe and pans
 * by its pixel deltas.
 */
export function getDiagramWheelAction(
  event: DiagramWheelInput,
): DiagramWheelAction {
  if (isDiscreteWheel(event)) {
    const direction = event.deltaY < 0 ? 1 : -1

    return {
      kind: 'zoom',
      factor: Math.exp(direction * DISCRETE_WHEEL_STEP),
    }
  }

  if (event.ctrlKey) {
    const deltaPixels = Math.max(
      -MAX_PINCH_DELTA,
      Math.min(MAX_PINCH_DELTA, event.deltaY),
    )

    return {
      kind: 'zoom',
      factor: Math.exp(-deltaPixels * PINCH_SENSITIVITY),
    }
  }

  return {
    kind: 'pan',
    x: -event.deltaX,
    y: -event.deltaY,
  }
}

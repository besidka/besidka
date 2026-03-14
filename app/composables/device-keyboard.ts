export interface DeviceKeyboardViewportChangedPayload {
  isOpen: boolean
  keyboardHeight: number
  visualViewportHeight: number
  visualViewportOffsetTop: number
  layoutViewportHeight: number
  focusedElementTop: number | null
  focusedElementBottom: number | null
}

interface DeviceKeyboardMetricsInput {
  activeElement?: Element | null
  focusedElementRect?: Pick<DOMRectReadOnly, 'top' | 'bottom'> | null
  layoutViewportHeight: number
  visualViewport?: Pick<VisualViewport, 'height' | 'offsetTop'> | null
}

const MIN_KEYBOARD_HEIGHT: number = 120
const VIEWPORT_SETTLE_TIMEOUT_MS: number = 250

export function createClosedDeviceKeyboardPayload():
DeviceKeyboardViewportChangedPayload {
  return {
    isOpen: false,
    keyboardHeight: 0,
    visualViewportHeight: 0,
    visualViewportOffsetTop: 0,
    layoutViewportHeight: 0,
    focusedElementTop: null,
    focusedElementBottom: null,
  }
}

export function isEditableElement(
  element: Element | null | undefined,
): element is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false
  }

  if (element instanceof HTMLTextAreaElement) {
    return !element.disabled && !element.readOnly
  }

  if (element instanceof HTMLInputElement) {
    return !element.disabled
      && !element.readOnly
      && !['checkbox', 'radio', 'button', 'submit'].includes(element.type)
  }

  return element.isContentEditable
}

export function buildDeviceKeyboardPayload(
  input: DeviceKeyboardMetricsInput,
): DeviceKeyboardViewportChangedPayload {
  const {
    activeElement = null,
    focusedElementRect = null,
    layoutViewportHeight,
    visualViewport = null,
  } = input

  const visualViewportHeight = Math.round(
    visualViewport?.height ?? layoutViewportHeight,
  )
  const visualViewportOffsetTop = Math.round(visualViewport?.offsetTop ?? 0)
  const keyboardHeight = Math.max(
    0,
    Math.round(
      layoutViewportHeight
      - (visualViewportHeight + visualViewportOffsetTop),
    ),
  )
  const activeEditable = isEditableElement(activeElement)
  const isOpen = activeEditable && keyboardHeight > MIN_KEYBOARD_HEIGHT

  return {
    isOpen,
    keyboardHeight,
    visualViewportHeight,
    visualViewportOffsetTop,
    layoutViewportHeight: Math.round(layoutViewportHeight),
    focusedElementTop: focusedElementRect
      ? Math.round(focusedElementRect.top)
      : null,
    focusedElementBottom: focusedElementRect
      ? Math.round(focusedElementRect.bottom)
      : null,
  }
}

export async function waitForDeviceKeyboardViewportSettle(): Promise<void> {
  if (!import.meta.client) {
    return
  }

  const visualViewport = window.visualViewport

  if (!visualViewport) {
    await new Promise((resolve) => {
      setTimeout(resolve, VIEWPORT_SETTLE_TIMEOUT_MS)
    })

    return
  }

  const settledViewport = visualViewport

  await new Promise<void>((resolve) => {
    let isResolved = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    function cleanup() {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      settledViewport.removeEventListener('resize', onResize)
    }

    function finish() {
      if (isResolved) {
        return
      }

      isResolved = true
      cleanup()
      resolve()
    }

    function onResize() {
      requestAnimationFrame(() => {
        requestAnimationFrame(finish)
      })
    }

    settledViewport.addEventListener('resize', onResize, { once: true })

    timeoutId = setTimeout(finish, VIEWPORT_SETTLE_TIMEOUT_MS)
  })
}

export function useDeviceKeyboard() {
  const metrics = useState<DeviceKeyboardViewportChangedPayload>(
    'device-keyboard:metrics',
    createClosedDeviceKeyboardPayload,
  )

  const isKeyboardOpen = computed<boolean>(() => {
    return metrics.value.isOpen
  })
  const keyboardHeight = computed<number>(() => {
    return metrics.value.keyboardHeight
  })

  return {
    metrics,
    isKeyboardOpen,
    keyboardHeight,
  }
}

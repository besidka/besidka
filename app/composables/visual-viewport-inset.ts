const KEYBOARD_MIN_HEIGHT_PX = 120
const PINCH_ZOOM_SCALE_EPSILON = 0.01
const SETTLE_REMEASURE_DELAYS_MS = [50, 150, 300, 500, 800] as const
const TEXT_ENTRY_INPUT_TYPES = new Set<string>([
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
])

function getVisualViewport(): VisualViewport | null {
  return import.meta.client ? window.visualViewport : null
}

function getWindow(): Window | null {
  return import.meta.client ? window : null
}

function getDocument(): Document | null {
  return import.meta.client ? document : null
}

function isTextEntryElement(element: Element | null): boolean {
  if (!element) {
    return false
  }

  if (element instanceof HTMLTextAreaElement) {
    return !element.readOnly && !element.disabled
  }

  if (element instanceof HTMLInputElement) {
    return TEXT_ENTRY_INPUT_TYPES.has(element.type)
      && !element.readOnly
      && !element.disabled
  }

  return element instanceof HTMLElement && element.isContentEditable
}

/**
 * Layout-viewport height hidden below the visual viewport. `offsetTop` counts
 * only the part that is a true visual-viewport pan: when iOS scrolls the
 * window while the keyboard opens, `offsetTop` equals `window.scrollY` and
 * fixed elements do not move with it, so that scroll is subtracted. A scrolled
 * window with an `offsetTop` of 0 never adds height.
 */
function getCoveredHeight(viewport: VisualViewport): number {
  const viewportPan = Math.max(0, viewport.offsetTop - window.scrollY)

  return window.innerHeight - viewport.height - viewportPan
}

/**
 * Tracks how much of the layout viewport the on-screen keyboard covers, as
 * one shared instance for every consumer. Fixed elements stay pinned to the
 * layout viewport, so anything that must sit above the keyboard is lifted by
 * `bottomInset`. Readings are batched per frame and repeated on a settle
 * schedule after every resize or focus change, because WebKit can report a
 * stale `offsetTop` inside the resize handler (WebKit bug 237851). Nothing is
 * reported as covered unless a text field has focus (iOS 26 can leave stale
 * visual viewport values after the keyboard closes) or while the page is
 * pinch-zoomed. Small differences such as a toolbar collapse stay below the
 * keyboard threshold. See docs/chats/ios-keyboard.md.
 */
function useVisualViewportInsetState() {
  const bottomInset = shallowRef<number>(0)
  const viewportHeight = shallowRef<number>(0)

  const isKeyboardOpen = computed<boolean>(() => {
    return bottomInset.value >= KEYBOARD_MIN_HEIGHT_PX
  })

  let pendingFrame: number | null = null
  let settleTimers: ReturnType<typeof setTimeout>[] = []

  function update() {
    if (import.meta.server) {
      return
    }

    const viewport = getVisualViewport()

    if (!viewport) {
      bottomInset.value = 0
      viewportHeight.value = window.innerHeight

      return
    }

    const isPinchZoomed = viewport.scale > 1 + PINCH_ZOOM_SCALE_EPSILON
    const hasTextEntryFocus = isTextEntryElement(document.activeElement)
    const coveredHeight = getCoveredHeight(viewport)

    bottomInset.value = isPinchZoomed || !hasTextEntryFocus
      ? 0
      : Math.max(0, Math.round(coveredHeight))
    viewportHeight.value = Math.round(viewport.height)
  }

  function cancelFrame() {
    if (pendingFrame === null) {
      return
    }

    cancelAnimationFrame(pendingFrame)
    pendingFrame = null
  }

  function scheduleUpdate() {
    if (pendingFrame !== null) {
      return
    }

    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = null
      update()
    })
  }

  function clearSettleTimers() {
    for (const timer of settleTimers) {
      clearTimeout(timer)
    }

    settleTimers = []
  }

  function scheduleSettledUpdates() {
    clearSettleTimers()
    scheduleUpdate()

    settleTimers = SETTLE_REMEASURE_DELAYS_MS.map((delay) => {
      return setTimeout(scheduleUpdate, delay)
    })
  }

  useEventListener(getVisualViewport, 'resize', scheduleSettledUpdates, {
    passive: true,
  })
  useEventListener(getVisualViewport, 'scroll', scheduleUpdate, {
    passive: true,
  })
  useEventListener(getWindow, 'resize', scheduleSettledUpdates, {
    passive: true,
  })
  useEventListener(getDocument, 'focusin', scheduleSettledUpdates)
  useEventListener(getDocument, 'focusout', scheduleSettledUpdates)

  tryOnScopeDispose(() => {
    clearSettleTimers()
    cancelFrame()
  })

  update()

  return {
    bottomInset,
    viewportHeight,
    isKeyboardOpen,
    update,
  }
}

export const useVisualViewportInset = createSharedComposable(
  useVisualViewportInsetState,
)

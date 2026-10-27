const KEYBOARD_MIN_HEIGHT_PX = 120

function getVisualViewport(): VisualViewport | null {
  return import.meta.client ? window.visualViewport : null
}

/**
 * Tracks how much of the layout viewport the on-screen keyboard covers.
 * `dvh` follows browser chrome but not the keyboard, so a bottom sheet needs
 * the visual viewport to stay above it while a field inside is focused.
 * Small differences (toolbar collapse, rounding) are ignored so the sheet
 * never twitches while the user scrolls.
 */
export function useVisualViewportInset() {
  const bottomInset = shallowRef<number>(0)
  const viewportHeight = shallowRef<number>(0)

  const isKeyboardOpen = computed<boolean>(() => {
    return bottomInset.value >= KEYBOARD_MIN_HEIGHT_PX
  })

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

    const coveredHeight = window.innerHeight
      - viewport.height
      - viewport.offsetTop

    bottomInset.value = Math.max(0, Math.round(coveredHeight))
    viewportHeight.value = Math.round(viewport.height)
  }

  useEventListener(getVisualViewport, 'resize', update, {
    passive: true,
  })
  useEventListener(getVisualViewport, 'scroll', update, {
    passive: true,
  })

  update()

  return {
    bottomInset,
    viewportHeight,
    isKeyboardOpen,
    update,
  }
}

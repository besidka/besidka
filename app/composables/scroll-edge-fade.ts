import type { MaybeRefOrGetter, StyleValue } from 'vue'

const SCROLL_EDGE_FADE_SIZE = '1.75rem'
const SCROLL_EDGE_THRESHOLD_PX = 2

type ScrollAxis = 'x' | 'y'

function measureHiddenEdges(element: HTMLElement, axis: ScrollAxis) {
  const offset = axis === 'y' ? element.scrollTop : element.scrollLeft
  const total = axis === 'y' ? element.scrollHeight : element.scrollWidth
  const visible = axis === 'y' ? element.clientHeight : element.clientWidth

  return {
    start: offset > SCROLL_EDGE_THRESHOLD_PX,
    end: total - offset - visible > SCROLL_EDGE_THRESHOLD_PX,
  }
}

/**
 * Fades the edges of a scroll container only while content is hidden past
 * that edge, so an item cut by the container's bounds always reads as "more
 * here" rather than as clipped. It re-measures on scroll, when the container
 * or any of its direct children changes size, and when descendants are added
 * or removed, so a row that appears or disappears updates the fade without a
 * scroll event.
 */
export function useScrollEdgeFade(
  target: MaybeRefOrGetter<HTMLElement | null | undefined>,
  axis: ScrollAxis = 'y',
) {
  const hasHiddenAbove = shallowRef<boolean>(false)
  const hasHiddenBelow = shallowRef<boolean>(false)
  const observedElements = shallowRef<HTMLElement[]>([])

  function collectObservedElements() {
    const element = toValue(target)
    const nextElements: HTMLElement[] = element
      ? [
        element,
        ...Array.from(element.children).filter((child) => {
          return child instanceof HTMLElement
        }),
      ]
      : []
    const isUnchanged = nextElements.length === observedElements.value.length
      && nextElements.every((nextElement, index) => {
        return nextElement === observedElements.value[index]
      })

    if (!isUnchanged) {
      observedElements.value = nextElements
    }
  }

  function update() {
    const element = toValue(target)

    if (!element) {
      hasHiddenAbove.value = false
      hasHiddenBelow.value = false

      return
    }

    const hiddenEdges = measureHiddenEdges(element, axis)

    hasHiddenAbove.value = hiddenEdges.start
    hasHiddenBelow.value = hiddenEdges.end
  }

  useEventListener(() => toValue(target), 'scroll', update, {
    passive: true,
  })
  watch(() => toValue(target), collectObservedElements, {
    immediate: true,
    flush: 'post',
  })
  useResizeObserver(observedElements, update)
  useMutationObserver(() => toValue(target), () => {
    collectObservedElements()
    update()
  }, {
    childList: true,
    subtree: true,
  })

  const fadeStyle = computed<StyleValue>(() => {
    if (!hasHiddenAbove.value && !hasHiddenBelow.value) {
      return {}
    }

    const startStop = hasHiddenAbove.value
      ? `transparent 0, #000 ${SCROLL_EDGE_FADE_SIZE}`
      : '#000 0'
    const endStop = hasHiddenBelow.value
      ? `#000 calc(100% - ${SCROLL_EDGE_FADE_SIZE}), transparent 100%`
      : '#000 100%'
    const direction = axis === 'y' ? 'to bottom' : 'to right'
    const gradient = `linear-gradient(${direction}, ${startStop}, ${endStop})`

    return {
      maskImage: gradient,
      WebkitMaskImage: gradient,
    }
  })

  return {
    fadeStyle,
    hasHiddenAbove,
    hasHiddenBelow,
    update,
  }
}

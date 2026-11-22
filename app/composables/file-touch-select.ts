/**
 * Touch-swipe range selection over the rows or tiles of a file list: touching
 * one and dragging over others selects the range between them. Rows carry
 * `data-file-index`; a project group carries `.js-project-group` with
 * `data-project-group-id`, and a swipe never leaves the group it started in.
 * Shared by the Select tab and the tabs that list files themselves.
 * `touchSwipeHandled` stays true for a moment after a swipe so the click the
 * browser sends afterward is ignored.
 */
export function useFileTouchSelect(options: {
  selectRange: (startIndex: number, endIndex: number) => void
  selectProjectGroupRange?: (
    groupId: string,
    startIndex: number,
    endIndex: number,
  ) => void
}) {
  const isTouchSelecting = shallowRef<boolean>(false)
  const touchStartIndex = shallowRef<number | null>(null)
  const touchedIndices = ref<Set<number>>(new Set())
  const touchGroupId = shallowRef<string | null>(null)
  const touchSwipeHandled = shallowRef<boolean>(false)

  function getFileIndexFromElement(element: Element | null): number | null {
    if (!element) {
      return null
    }

    const fileElement = element.closest('[data-file-index]')

    if (!fileElement) {
      return null
    }

    const index = fileElement.getAttribute('data-file-index')

    return index !== null ? parseInt(index, 10) : null
  }

  function getProjectGroupIdFromElement(
    element: Element | null,
  ): string | null {
    if (!element) {
      return null
    }

    const groupElement = element.closest('.js-project-group')

    return groupElement?.getAttribute('data-project-group-id') ?? null
  }

  function handleTouchStart(event: TouchEvent) {
    const touch = event.touches[0]

    if (!touch) {
      return
    }

    const element = document.elementFromPoint(touch.clientX, touch.clientY)
    const index = getFileIndexFromElement(element)

    if (index !== null) {
      isTouchSelecting.value = true
      touchStartIndex.value = index
      touchGroupId.value = getProjectGroupIdFromElement(element)
      touchedIndices.value = new Set([index])
    }
  }

  function handleTouchMove(event: TouchEvent) {
    if (!isTouchSelecting.value || touchStartIndex.value === null) {
      return
    }

    const touch = event.touches[0]

    if (!touch) {
      return
    }

    const element = document.elementFromPoint(touch.clientX, touch.clientY)
    const index = getFileIndexFromElement(element)

    if (getProjectGroupIdFromElement(element) !== touchGroupId.value) {
      return
    }

    if (index !== null && !touchedIndices.value.has(index)) {
      touchedIndices.value.add(index)
      event.preventDefault()
    }
  }

  function handleTouchEnd() {
    if (!isTouchSelecting.value) {
      return
    }

    if (touchedIndices.value.size > 1) {
      const indices = Array.from(touchedIndices.value).sort((a, b) => a - b)
      const startIndex = indices[0]!
      const endIndex = indices[indices.length - 1]!

      if (touchGroupId.value && options.selectProjectGroupRange) {
        options.selectProjectGroupRange(
          touchGroupId.value,
          startIndex,
          endIndex,
        )
      } else {
        options.selectRange(startIndex, endIndex)
      }

      touchSwipeHandled.value = true
      setTimeout(() => {
        touchSwipeHandled.value = false
      }, 100)
    }

    isTouchSelecting.value = false
    touchStartIndex.value = null
    touchGroupId.value = null
    touchedIndices.value = new Set()
  }

  function attachTouchListeners(element: HTMLElement | null) {
    if (!element) {
      return
    }

    element.addEventListener('touchstart', handleTouchStart, { passive: true })
    element.addEventListener('touchmove', handleTouchMove, { passive: false })
    element.addEventListener('touchend', handleTouchEnd)
  }

  function detachTouchListeners(element: HTMLElement | null) {
    if (!element) {
      return
    }

    element.removeEventListener('touchstart', handleTouchStart)
    element.removeEventListener('touchmove', handleTouchMove)
    element.removeEventListener('touchend', handleTouchEnd)
  }

  return {
    isTouchSelecting,
    touchedIndices,
    touchGroupId,
    touchSwipeHandled,
    attachTouchListeners,
    detachTouchListeners,
  }
}

import type { ShallowRef } from 'vue'

const MOBILE_BREAKPOINT_QUERY = '(max-width: 39.999rem)'
const MOBILE_BOTTOM_RESERVE_PX = 96

export function useDropdownPlacement(
  dropdownRef: Readonly<ShallowRef<HTMLDetailsElement | null>>,
) {
  const isFlippedUp = shallowRef<boolean>(false)

  function getBottomReserve(): number {
    const isMobile = window.matchMedia?.(MOBILE_BREAKPOINT_QUERY)?.matches

    return isMobile ? MOBILE_BOTTOM_RESERVE_PX : 0
  }

  function updatePlacement() {
    const dropdown = dropdownRef.value
    const trigger = dropdown?.querySelector('summary')
    const menu = dropdown?.querySelector<HTMLElement>('.dropdown-content')

    if (!dropdown?.open || !trigger || !menu) {
      return
    }

    const visualViewport = window.visualViewport
    const viewportTop = visualViewport?.offsetTop ?? 0
    const viewportHeight = visualViewport?.height ?? window.innerHeight
    const triggerRect = trigger.getBoundingClientRect()
    const spaceBelow = viewportTop
      + viewportHeight
      - getBottomReserve()
      - triggerRect.bottom
    const spaceAbove = triggerRect.top - viewportTop

    isFlippedUp.value = menu.offsetHeight > spaceBelow
      && spaceAbove > spaceBelow
  }

  return {
    isFlippedUp,
    updatePlacement,
  }
}

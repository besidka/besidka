import type { ShallowRef } from 'vue'

export function useDropdownPlacement(
  dropdownRef: Readonly<ShallowRef<HTMLDetailsElement | null>>,
) {
  const isFlippedUp = shallowRef<boolean>(false)

  function updatePlacement() {
    const dropdown = dropdownRef.value
    const trigger = dropdown?.querySelector('summary')
    const menu = dropdown?.querySelector('.dropdown-content')

    if (!dropdown?.open || !trigger || !menu) {
      return
    }

    const visualViewport = window.visualViewport
    const viewportTop = visualViewport?.offsetTop ?? 0
    const viewportHeight = visualViewport?.height ?? window.innerHeight
    const triggerRect = trigger.getBoundingClientRect()
    const menuHeight = menu.getBoundingClientRect().height
    const spaceBelow = viewportTop + viewportHeight - triggerRect.bottom
    const spaceAbove = triggerRect.top - viewportTop

    isFlippedUp.value = menuHeight > spaceBelow && spaceAbove > spaceBelow
  }

  return {
    isFlippedUp,
    updatePlacement,
  }
}

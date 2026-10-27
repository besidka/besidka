import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDropdownPlacement } from '../../../app/composables/dropdown-placement'

const MENU_HEIGHT = 320
const TRIGGER_HEIGHT = 32
const DESKTOP_VIEWPORT_WIDTH = 1024
const MOBILE_VIEWPORT_WIDTH = 390

const originalVisualViewport = Object.getOwnPropertyDescriptor(
  window,
  'visualViewport',
)
const originalMatchMedia = Object.getOwnPropertyDescriptor(
  window,
  'matchMedia',
)
const originalInnerHeight = Object.getOwnPropertyDescriptor(
  window,
  'innerHeight',
)

function setVisualViewport(
  value: { offsetTop: number, height: number } | null,
) {
  Object.defineProperty(window, 'visualViewport', {
    value,
    configurable: true,
  })
}

function setInnerHeight(value: number) {
  Object.defineProperty(window, 'innerHeight', {
    value,
    configurable: true,
  })
}

function setViewportWidth(width: number) {
  Object.defineProperty(window, 'matchMedia', {
    value: (query: string) => {
      const isMobileQuery = query === '(max-width: 39.999rem)'

      return {
        matches: isMobileQuery && width < 640,
        media: query,
      }
    },
    configurable: true,
  })
}

function restoreDescriptor(
  name: 'visualViewport' | 'matchMedia' | 'innerHeight',
  descriptor: PropertyDescriptor | undefined,
) {
  if (descriptor) {
    Object.defineProperty(window, name, descriptor)

    return
  }

  Reflect.deleteProperty(window, name)
}

function createDropdown() {
  const dropdown = document.createElement('details')
  const trigger = document.createElement('summary')
  const menu = document.createElement('div')

  menu.className = 'dropdown-content'
  Object.defineProperty(menu, 'offsetHeight', {
    value: MENU_HEIGHT,
    configurable: true,
  })
  dropdown.append(trigger, menu)
  document.body.append(dropdown)

  return { dropdown, trigger, menu }
}

function placeTrigger(trigger: HTMLElement, top: number) {
  vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
    top,
    bottom: top + TRIGGER_HEIGHT,
    height: TRIGGER_HEIGHT,
  } as DOMRect)
}

function setup(triggerTop: number) {
  const elements = createDropdown()
  const dropdownRef = shallowRef<HTMLDetailsElement | null>(
    elements.dropdown,
  )
  const placement = useDropdownPlacement(dropdownRef)

  placeTrigger(elements.trigger, triggerTop)

  return { ...elements, ...placement }
}

describe('useDropdownPlacement', () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_VIEWPORT_WIDTH)
    setVisualViewport({ offsetTop: 0, height: 800 })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
    restoreDescriptor('visualViewport', originalVisualViewport)
    restoreDescriptor('matchMedia', originalMatchMedia)
    restoreDescriptor('innerHeight', originalInnerHeight)
  })

  it('stays down while the menu fits below the trigger', () => {
    const { dropdown, isFlippedUp, updatePlacement } = setup(100)

    dropdown.open = true
    updatePlacement()

    expect(isFlippedUp.value).toBe(false)
  })

  it('flips up when the menu would run past the viewport bottom', () => {
    const { dropdown, isFlippedUp, updatePlacement } = setup(700)

    dropdown.open = true
    updatePlacement()

    expect(isFlippedUp.value).toBe(true)
  })

  it('stays down when neither side fits and below has more room', () => {
    setVisualViewport({ offsetTop: 0, height: 300 })

    const { dropdown, isFlippedUp, updatePlacement } = setup(100)

    dropdown.open = true
    updatePlacement()

    expect(isFlippedUp.value).toBe(false)
  })

  it('falls back to innerHeight without a visual viewport', () => {
    setVisualViewport(null)
    setInnerHeight(800)

    const { dropdown, isFlippedUp, updatePlacement } = setup(700)

    dropdown.open = true
    updatePlacement()

    expect(isFlippedUp.value).toBe(true)

    setInnerHeight(1200)
    updatePlacement()

    expect(isFlippedUp.value).toBe(false)
  })

  it('accounts for a non-zero visual viewport offset', () => {
    setVisualViewport({ offsetTop: 200, height: 600 })

    const { dropdown, trigger, isFlippedUp, updatePlacement } = setup(150)

    dropdown.open = true
    updatePlacement()

    expect(isFlippedUp.value).toBe(false)

    setVisualViewport({ offsetTop: 100, height: 400 })
    placeTrigger(trigger, 400)
    updatePlacement()

    expect(isFlippedUp.value).toBe(true)
  })

  it('leaves the state unchanged when the dropdown closes', () => {
    const { dropdown, isFlippedUp, updatePlacement } = setup(700)

    dropdown.open = true
    updatePlacement()

    expect(isFlippedUp.value).toBe(true)

    dropdown.open = false
    setVisualViewport({ offsetTop: 0, height: 3000 })
    updatePlacement()

    expect(isFlippedUp.value).toBe(true)
  })

  it('recomputes on reopen after the page scrolled', () => {
    const { dropdown, trigger, isFlippedUp, updatePlacement } = setup(700)

    dropdown.open = true
    updatePlacement()

    expect(isFlippedUp.value).toBe(true)

    dropdown.open = false
    placeTrigger(trigger, 100)
    dropdown.open = true
    updatePlacement()

    expect(isFlippedUp.value).toBe(false)
  })

  it('reserves the space under the fixed bottom bar on mobile', () => {
    const { dropdown, isFlippedUp, updatePlacement } = setup(430)

    dropdown.open = true
    updatePlacement()

    expect(isFlippedUp.value).toBe(false)

    setViewportWidth(MOBILE_VIEWPORT_WIDTH)
    updatePlacement()

    expect(isFlippedUp.value).toBe(true)
  })

  it('measures the menu with offsetHeight rather than its scaled rect',
    () => {
      const { dropdown, menu, isFlippedUp, updatePlacement } = setup(430)

      vi.spyOn(menu, 'getBoundingClientRect').mockReturnValue({
        height: 100,
      } as DOMRect)
      dropdown.open = true
      updatePlacement()

      expect(isFlippedUp.value).toBe(false)

      Object.defineProperty(menu, 'offsetHeight', {
        value: 400,
        configurable: true,
      })
      updatePlacement()

      expect(isFlippedUp.value).toBe(true)
    })
})

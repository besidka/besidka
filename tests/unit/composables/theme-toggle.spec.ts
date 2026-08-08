import { reactive } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemePreference } from '~/types/favicon.d'
import { useThemeToggle } from '../../../app/composables/theme-toggle'

const mocks = vi.hoisted(() => ({
  isIos: false,
  reloadNuxtApp: vi.fn(),
}))

const colorModeState = reactive<{
  preference: ThemePreference
  value: 'light' | 'dark'
}>({
  preference: 'light',
  value: 'light',
})

mockNuxtImport('useColorMode', () => {
  return () => colorModeState
})

mockNuxtImport('useDevice', () => {
  return () => ({ isIos: mocks.isIos })
})

mockNuxtImport('reloadNuxtApp', () => mocks.reloadNuxtApp)

function getThemeColorMeta() {
  return document.querySelector('meta[name="theme-color"]')
}

function stubMatchMedia(matches: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    return {
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList
  })
}

describe('useThemeToggle', () => {
  beforeEach(() => {
    vi.useRealTimers()
    mocks.isIos = false
    colorModeState.preference = 'light'
    colorModeState.value = 'light'
    mocks.reloadNuxtApp.mockClear()

    document.querySelectorAll('meta[name="theme-color"]').forEach((element) => {
      element.remove()
    })

    stubMatchMedia(false)

    const { pending } = useThemeToggle()

    pending.value = false
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('cycles the preference light -> dark -> system -> light', () => {
    const { currentPreference, toggle } = useThemeToggle()

    expect(currentPreference.value).toBe('light')

    toggle()
    expect(currentPreference.value).toBe('dark')

    toggle()
    expect(currentPreference.value).toBe('system')

    toggle()
    expect(currentPreference.value).toBe('light')
  })

  it('writes the light theme color to a fresh meta tag', () => {
    const { setThemeColorMeta } = useThemeToggle()

    setThemeColorMeta('light')

    expect(getThemeColorMeta()?.getAttribute('content')).toBe('#fde4f1')
  })

  it('writes the dark theme color', () => {
    const { setThemeColorMeta } = useThemeToggle()

    setThemeColorMeta('dark')

    expect(getThemeColorMeta()?.getAttribute('content')).toBe('#4b283c')
  })

  it('substitutes lightForDark when the OS prefers dark but the theme is light', () => {
    stubMatchMedia(true)

    const { setThemeColorMeta } = useThemeToggle()

    setThemeColorMeta('light')

    expect(getThemeColorMeta()?.getAttribute('content')).toBe('#834f68')
  })

  it('collapses duplicate theme-color meta tags into the first one', () => {
    const first = document.createElement('meta')

    first.setAttribute('name', 'theme-color')
    first.setAttribute('media', '(prefers-color-scheme: light)')
    document.head.appendChild(first)

    const second = document.createElement('meta')

    second.setAttribute('name', 'theme-color')
    second.setAttribute('media', '(prefers-color-scheme: dark)')
    document.head.appendChild(second)

    const { setThemeColorMeta } = useThemeToggle()

    setThemeColorMeta('dark')

    const metas = document.querySelectorAll('meta[name="theme-color"]')

    expect(metas).toHaveLength(1)
    expect(metas[0]).toBe(first)
    expect(first.hasAttribute('media')).toBe(false)
    expect(first.getAttribute('content')).toBe('#4b283c')
  })

  it('toggle() reads the resolved theme before it catches up with the new preference', () => {
    const { toggle } = useThemeToggle()

    expect(colorModeState.preference).toBe('light')
    expect(colorModeState.value).toBe('light')

    toggle()

    expect(colorModeState.preference).toBe('dark')
    expect(getThemeColorMeta()?.getAttribute('content')).toBe('#fde4f1')
  })

  it('reloads the standalone app 500ms after toggling on iOS', async () => {
    vi.useFakeTimers()
    mocks.isIos = true

    const { toggle, pending } = useThemeToggle()

    toggle()

    expect(pending.value).toBe(true)
    expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)

    expect(mocks.reloadNuxtApp).toHaveBeenCalledWith({ force: true })
  })

  it('never reloads or flags pending on non-iOS devices', async () => {
    vi.useFakeTimers()
    mocks.isIos = false

    const { toggle, pending } = useThemeToggle()

    toggle()

    expect(pending.value).toBe(false)

    await vi.advanceTimersByTimeAsync(500)

    expect(mocks.reloadNuxtApp).not.toHaveBeenCalled()
  })
})

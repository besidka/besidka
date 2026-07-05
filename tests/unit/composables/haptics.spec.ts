import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useHaptics } from '../../../app/composables/haptics'

const mocks = vi.hoisted(() => ({
  useWebHaptics: vi.fn(),
  isDesktop: false,
}))

vi.mock('web-haptics/vue', () => ({
  useWebHaptics: mocks.useWebHaptics,
}))

mockNuxtImport('useDevice', () => {
  return () => ({ isDesktop: mocks.isDesktop })
})

describe('useHaptics', () => {
  beforeEach(() => {
    mocks.useWebHaptics.mockClear()
    mocks.useWebHaptics.mockImplementation(() => ({
      trigger: vi.fn(),
      cancel: vi.fn(),
      isSupported: false,
    }))
    mocks.isDesktop = false
  })

  it('enables the debug click sound on desktop', () => {
    mocks.isDesktop = true

    useHaptics()

    expect(mocks.useWebHaptics).toHaveBeenCalledWith({ debug: true })
  })

  it('disables the debug click sound off desktop', () => {
    mocks.isDesktop = false

    useHaptics()

    expect(mocks.useWebHaptics).toHaveBeenCalledWith({ debug: false })
  })

  it('returns the haptic trigger functions', () => {
    const haptics = useHaptics()

    expect(typeof haptics.hapticRigid).toBe('function')
    expect(typeof haptics.hapticSoft).toBe('function')
    expect(typeof haptics.haptic).toBe('function')
  })
})

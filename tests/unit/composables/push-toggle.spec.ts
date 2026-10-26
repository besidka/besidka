import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePushToggle } from '../../../app/composables/push-toggle'

const mocks = vi.hoisted(() => ({
  isSupported: true,
  isStateKnown: true,
  permission: 'default' as NotificationPermission,
  isSubscribed: false,
  disable: vi.fn(async () => undefined),
  requestEnable: vi.fn(async () => undefined),
}))

mockNuxtImport('usePushNotifications', () => {
  return () => ({
    isSupported: {
      get value() {
        return mocks.isSupported
      },
    },
    isStateKnown: {
      get value() {
        return mocks.isStateKnown
      },
    },
    permission: {
      get value() {
        return mocks.permission
      },
    },
    isSubscribed: {
      get value() {
        return mocks.isSubscribed
      },
    },
  })
})

mockNuxtImport('useNotificationPrompt', () => {
  return () => ({
    disable: mocks.disable,
    requestEnable: mocks.requestEnable,
  })
})

describe('usePushToggle', () => {
  beforeEach(() => {
    mocks.isSupported = true
    mocks.isStateKnown = true
    mocks.permission = 'default'
    mocks.isSubscribed = false
    mocks.disable.mockReset()
    mocks.disable.mockResolvedValue(undefined)
    mocks.requestEnable.mockReset()
    mocks.requestEnable.mockResolvedValue(undefined)
  })

  it('reports support from the push composable', () => {
    mocks.isSupported = false

    expect(usePushToggle().isSupported.value).toBe(false)
  })

  it('reports whether the push state is known', () => {
    mocks.isStateKnown = false

    expect(usePushToggle().isStateKnown.value).toBe(false)

    mocks.isStateKnown = true

    expect(usePushToggle().isStateKnown.value).toBe(true)
  })

  it('is enabled only when permission is granted and subscribed', () => {
    mocks.permission = 'granted'
    mocks.isSubscribed = true

    expect(usePushToggle().isEnabled.value).toBe(true)

    mocks.isSubscribed = false

    expect(usePushToggle().isEnabled.value).toBe(false)

    mocks.permission = 'default'
    mocks.isSubscribed = true

    expect(usePushToggle().isEnabled.value).toBe(false)
  })

  it('is blocked when the browser denied permission', () => {
    mocks.permission = 'denied'

    expect(usePushToggle().isBlocked.value).toBe(true)
  })

  it('requests enabling through the disclosed prompt when off', async () => {
    const { toggle } = usePushToggle()

    await toggle()

    expect(mocks.requestEnable).toHaveBeenCalledTimes(1)
    expect(mocks.disable).not.toHaveBeenCalled()
  })

  it('disables push when it is enabled', async () => {
    mocks.permission = 'granted'
    mocks.isSubscribed = true

    const { toggle } = usePushToggle()

    await toggle()

    expect(mocks.disable).toHaveBeenCalledTimes(1)
    expect(mocks.requestEnable).not.toHaveBeenCalled()
  })

  it('ignores a second toggle while the first is pending', async () => {
    let finishEnable: () => void = () => undefined

    mocks.requestEnable.mockImplementation(() => {
      return new Promise<undefined>((resolve) => {
        finishEnable = () => resolve(undefined)
      })
    })

    const { toggle, pending } = usePushToggle()
    const firstToggle = toggle()

    expect(pending.value).toBe(true)

    await toggle()

    expect(mocks.requestEnable).toHaveBeenCalledTimes(1)

    finishEnable()
    await firstToggle

    expect(pending.value).toBe(false)
  })

  it('clears pending when the action throws', async () => {
    mocks.requestEnable.mockRejectedValue(new Error('Subscribe failed'))

    const { toggle, pending } = usePushToggle()

    await expect(toggle()).rejects.toThrow('Subscribe failed')
    expect(pending.value).toBe(false)
  })
})

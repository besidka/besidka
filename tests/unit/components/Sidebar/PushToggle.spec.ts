import { mountSuspended, mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarPushToggle from '../../../../app/components/Sidebar/PushToggle.client.vue'

const mocks = vi.hoisted(() => ({
  isSupported: true,
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

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

async function mountPushToggle() {
  return mountSuspended(SidebarPushToggle)
}

describe('Sidebar/PushToggle', () => {
  beforeEach(() => {
    mocks.isSupported = true
    mocks.permission = 'default'
    mocks.isSubscribed = false
    mocks.disable.mockClear()
    mocks.requestEnable.mockClear()
  })

  it('renders nothing when push is unsupported', async () => {
    mocks.isSupported = false

    const wrapper = await mountPushToggle()

    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('shows the enabled state when granted and subscribed', async () => {
    mocks.permission = 'granted'
    mocks.isSubscribed = true

    const wrapper = await mountPushToggle()
    const button = wrapper.get('button')

    expect(button.classes()).toContain('btn-active')
    expect(button.attributes('aria-label'))
      .toBe('Disable push notifications')
    expect(wrapper.get('.iconify').classes())
      .toContain('i-lucide:bell-ring')
  })

  it('shows the disabled state when not granted or not subscribed', async () => {
    const wrapper = await mountPushToggle()
    const button = wrapper.get('button')

    expect(button.classes()).not.toContain('btn-active')
    expect(button.attributes('aria-label'))
      .toBe('Enable push notifications')
    expect(wrapper.get('.iconify').classes())
      .toContain('i-lucide:bell-off')
  })

  it('calls disable (not requestEnable) when clicked while enabled', async () => {
    mocks.permission = 'granted'
    mocks.isSubscribed = true

    const wrapper = await mountPushToggle()

    await wrapper.get('button').trigger('click')

    expect(mocks.disable).toHaveBeenCalledTimes(1)
    expect(mocks.requestEnable).not.toHaveBeenCalled()
  })

  it('calls requestEnable (not disable) when clicked while disabled', async () => {
    const wrapper = await mountPushToggle()

    await wrapper.get('button').trigger('click')

    expect(mocks.requestEnable).toHaveBeenCalledTimes(1)
    expect(mocks.disable).not.toHaveBeenCalled()
  })

  it('guards against a second click while the first is still pending', async () => {
    let resolveRequestEnable: () => void = () => {}

    mocks.requestEnable.mockImplementation(() => {
      return new Promise<void>((resolve) => {
        resolveRequestEnable = resolve
      })
    })

    const wrapper = await mountPushToggle()
    const button = wrapper.get('button')

    button.trigger('click')
    await button.trigger('click')

    expect(mocks.requestEnable).toHaveBeenCalledTimes(1)

    resolveRequestEnable()
    await flushPromises()
  })
})

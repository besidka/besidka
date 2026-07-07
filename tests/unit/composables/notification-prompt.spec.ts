import { beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useNotificationPrompt } from '../../../app/composables/notification-prompt'

const mocks = vi.hoisted(() => ({
  isSupported: true,
  permission: 'default' as NotificationPermission,
  isSubscribed: false,
  subscribe: vi.fn(async () => true),
  refreshState: vi.fn(async () => undefined),
}))

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

// Not vi.hoisted(): its callback runs before regular imports (like vue's
// shallowRef here) are initialized. mockNuxtImport's factory below is only
// invoked lazily when the composable is used inside a test, by which point
// this plain top-level const has already been evaluated.
const userSettingMocks = {
  activeUserId: shallowRef<string | null>(null),
  isLoadingSettings: shallowRef<boolean>(false),
  notificationPromptState: shallowRef<boolean | null>(null),
  setNotificationPromptState: vi.fn(async (value: boolean) => {
    userSettingMocks.notificationPromptState.value = value
  }),
}

mockNuxtImport('usePushNotifications', () => {
  return () => ({
    // Live getters, not a value snapshot: useNotificationPrompt() only
    // registers its 'chat:generation-ready-while-hidden' handler once
    // (matching the real chat.vue layout + NotificationPrompt.client.vue
    // sharing behavior), so later tests exercise the closure from the FIRST
    // call — it must keep reading whatever beforeEach set
    // mocks.isSupported/permission to.
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
    subscribe: mocks.subscribe,
    unsubscribe: vi.fn(),
    refreshState: mocks.refreshState,
  })
})

mockNuxtImport('useUserSetting', () => {
  return () => ({
    activeUserId: userSettingMocks.activeUserId,
    isLoadingSettings: userSettingMocks.isLoadingSettings,
    notificationPromptState: userSettingMocks.notificationPromptState,
    setNotificationPromptState: userSettingMocks.setNotificationPromptState,
  })
})

async function fireGenerationReadyHook() {
  await useNuxtApp().callHook('chat:generation-ready-while-hidden')
}

describe('useNotificationPrompt', () => {
  beforeEach(() => {
    mocks.isSupported = true
    mocks.permission = 'default'
    mocks.isSubscribed = false
    mocks.subscribe.mockClear()
    mocks.refreshState.mockClear()
    userSettingMocks.activeUserId.value = null
    userSettingMocks.isLoadingSettings.value = false
    userSettingMocks.notificationPromptState.value = null
    userSettingMocks.setNotificationPromptState.mockClear()

    useState<boolean>('notification-prompt:reconciled', () => false)
      .value = false

    const { isVisible } = useNotificationPrompt()

    isVisible.value = false
  })

  describe('maybeShowAfterMissedNotification (the generation-ready hook)', () => {
    it('shows the banner the first time the hook fires for a never-asked user', async () => {
      const prompt = useNotificationPrompt()

      expect(prompt.isVisible.value).toBe(false)

      await fireGenerationReadyHook()

      expect(prompt.isVisible.value).toBe(true)
    })

    it('re-shows for a user who previously declined', async () => {
      userSettingMocks.notificationPromptState.value = false

      const prompt = useNotificationPrompt()

      await fireGenerationReadyHook()

      expect(prompt.isVisible.value).toBe(true)
    })

    it('does not show for a user who already enabled notifications', async () => {
      userSettingMocks.notificationPromptState.value = true

      const prompt = useNotificationPrompt()

      await fireGenerationReadyHook()

      expect(prompt.isVisible.value).toBe(false)
    })

    it('does not show when push is unsupported', async () => {
      mocks.isSupported = false

      const prompt = useNotificationPrompt()

      await fireGenerationReadyHook()

      expect(prompt.isVisible.value).toBe(false)
    })

    it('does not show when permission was already decided', async () => {
      mocks.permission = 'granted'

      const prompt = useNotificationPrompt()

      await fireGenerationReadyHook()

      expect(prompt.isVisible.value).toBe(false)
    })
  })

  describe('maybeShowProactively (chat layout onMounted)', () => {
    it('shows immediately for a never-asked user whose settings already loaded', () => {
      userSettingMocks.activeUserId.value = 'user-1'
      userSettingMocks.notificationPromptState.value = null

      const prompt = useNotificationPrompt()

      prompt.maybeShowProactively()

      expect(prompt.isVisible.value).toBe(true)
    })

    it('does not show for a user who already enabled or declined', () => {
      userSettingMocks.activeUserId.value = 'user-1'
      userSettingMocks.notificationPromptState.value = false

      const prompt = useNotificationPrompt()

      prompt.maybeShowProactively()

      expect(prompt.isVisible.value).toBe(false)
    })

    it('waits for settings to finish loading before deciding', async () => {
      userSettingMocks.activeUserId.value = 'user-1'
      userSettingMocks.isLoadingSettings.value = true
      userSettingMocks.notificationPromptState.value = null

      const prompt = useNotificationPrompt()

      prompt.maybeShowProactively()

      expect(prompt.isVisible.value).toBe(false)

      userSettingMocks.notificationPromptState.value = false
      userSettingMocks.isLoadingSettings.value = false
      await nextTick()

      expect(prompt.isVisible.value).toBe(false)
    })

    it('re-shows for a user who enabled on another install', async () => {
      userSettingMocks.activeUserId.value = 'user-1'
      userSettingMocks.notificationPromptState.value = true
      mocks.permission = 'default'

      const prompt = useNotificationPrompt()

      prompt.maybeShowProactively()
      await flushPromises()

      expect(prompt.isVisible.value).toBe(true)
      expect(mocks.subscribe).not.toHaveBeenCalled()
    })

    it('does not re-show when this install already has permission', () => {
      userSettingMocks.activeUserId.value = 'user-1'
      userSettingMocks.notificationPromptState.value = true
      mocks.permission = 'granted'

      const prompt = useNotificationPrompt()

      prompt.maybeShowProactively()

      expect(prompt.isVisible.value).toBe(false)
    })

    it('does not show before the active user id is known', () => {
      userSettingMocks.activeUserId.value = null

      const prompt = useNotificationPrompt()

      prompt.maybeShowProactively()

      expect(prompt.isVisible.value).toBe(false)
    })
  })

  describe('reconcileGrantedSubscription (granted, unsubscribed browser)', () => {
    it('refreshes state and subscribes silently, keeping the banner hidden', async () => {
      userSettingMocks.activeUserId.value = 'user-1'
      userSettingMocks.notificationPromptState.value = true
      mocks.permission = 'granted'
      mocks.isSubscribed = false

      const prompt = useNotificationPrompt()

      prompt.maybeShowProactively()
      await flushPromises()

      expect(mocks.refreshState).toHaveBeenCalledTimes(1)
      expect(mocks.subscribe).toHaveBeenCalledTimes(1)
      expect(prompt.isVisible.value).toBe(false)
    })

    it('does not subscribe again when already subscribed', async () => {
      userSettingMocks.activeUserId.value = 'user-1'
      userSettingMocks.notificationPromptState.value = true
      mocks.permission = 'granted'
      mocks.isSubscribed = true

      const prompt = useNotificationPrompt()

      prompt.maybeShowProactively()
      await flushPromises()

      expect(mocks.refreshState).toHaveBeenCalledTimes(1)
      expect(mocks.subscribe).not.toHaveBeenCalled()
    })

    it('reconciles the subscription only once per session', async () => {
      userSettingMocks.activeUserId.value = 'user-1'
      userSettingMocks.notificationPromptState.value = true
      mocks.permission = 'granted'
      mocks.isSubscribed = false

      const firstPrompt = useNotificationPrompt()

      firstPrompt.maybeShowProactively()

      const secondPrompt = useNotificationPrompt()

      secondPrompt.maybeShowProactively()

      await flushPromises()

      expect(mocks.subscribe).toHaveBeenCalledTimes(1)
    })
  })

  it('subscribes, hides the banner, and records enabled on enable', async () => {
    const prompt = useNotificationPrompt()

    await fireGenerationReadyHook()
    await prompt.enable()

    expect(mocks.subscribe).toHaveBeenCalledTimes(1)
    expect(prompt.isVisible.value).toBe(false)
    expect(userSettingMocks.setNotificationPromptState)
      .toHaveBeenCalledWith(true)
  })

  it('keeps the banner open and does not record state when subscribe fails', async () => {
    mocks.subscribe.mockResolvedValueOnce(false)

    const prompt = useNotificationPrompt()

    await fireGenerationReadyHook()
    await prompt.enable()

    expect(mocks.subscribe).toHaveBeenCalledTimes(1)
    expect(prompt.isVisible.value).toBe(true)
    expect(userSettingMocks.setNotificationPromptState).not
      .toHaveBeenCalled()
  })

  it('dismiss hides the banner and records declined without subscribing', async () => {
    const prompt = useNotificationPrompt()

    await fireGenerationReadyHook()
    prompt.dismiss()

    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(prompt.isVisible.value).toBe(false)
    expect(userSettingMocks.setNotificationPromptState)
      .toHaveBeenCalledWith(false)
  })
})

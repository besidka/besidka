import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useNotificationPrompt } from '../../../app/composables/notification-prompt'

const mocks = vi.hoisted(() => ({
  isSupported: true,
  permission: 'default' as NotificationPermission,
  subscribe: vi.fn(async () => true),
  preferenceStore: new Map<string, string>(),
}))

mockNuxtImport('usePushNotifications', () => {
  return () => ({
    isSupported: { value: mocks.isSupported },
    permission: { value: mocks.permission },
    isSubscribed: { value: false },
    subscribe: mocks.subscribe,
    unsubscribe: vi.fn(),
  })
})

mockNuxtImport('usePreferenceStorage', () => {
  return () => ({
    getItem: (key: string) => mocks.preferenceStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      mocks.preferenceStore.set(key, value)
    },
  })
})

async function fireGenerationReadyHook() {
  await useNuxtApp().callHook('chat:generation-ready-while-hidden')
}

describe('useNotificationPrompt', () => {
  beforeEach(() => {
    mocks.isSupported = true
    mocks.permission = 'default'
    mocks.subscribe.mockClear()
    mocks.preferenceStore.clear()
  })

  it('shows the banner the first time the hook fires', async () => {
    const prompt = useNotificationPrompt()

    expect(prompt.isVisible.value).toBe(false)

    await fireGenerationReadyHook()

    expect(prompt.isVisible.value).toBe(true)
  })

  it('never shows again once it has been shown once', async () => {
    const firstPrompt = useNotificationPrompt()

    await fireGenerationReadyHook()
    firstPrompt.dismiss()

    // Recreates the composable to simulate a fresh chat page mount — the
    // "shown once" state must come from persisted preference storage, not
    // from in-memory closure state that a remount would reset.
    const secondPrompt = useNotificationPrompt()

    await fireGenerationReadyHook()

    expect(secondPrompt.isVisible.value).toBe(false)
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

  it('subscribes and hides the banner on enable', async () => {
    const prompt = useNotificationPrompt()

    await fireGenerationReadyHook()
    await prompt.enable()

    expect(mocks.subscribe).toHaveBeenCalledTimes(1)
    expect(prompt.isVisible.value).toBe(false)
  })

  it('dismiss hides the banner without subscribing', async () => {
    const prompt = useNotificationPrompt()

    await fireGenerationReadyHook()
    prompt.dismiss()

    expect(mocks.subscribe).not.toHaveBeenCalled()
    expect(prompt.isVisible.value).toBe(false)
  })
})

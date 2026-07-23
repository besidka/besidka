import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import ChatLayout from '../../../app/layouts/chat.vue'

const { maybeShowProactivelyMock } = vi.hoisted(() => ({
  maybeShowProactivelyMock: vi.fn(),
}))

mockNuxtImport('useNotificationPrompt', () => {
  return () => ({
    isVisible: { value: false },
    dismiss: vi.fn(),
    enable: vi.fn(),
    maybeShowProactively: maybeShowProactivelyMock,
  })
})

describe('chat layout', () => {
  it('proactively checks the notification prompt on mount', async () => {
    maybeShowProactivelyMock.mockClear()

    const stubs = {
      NuxtPage: true,
    }

    await mountSuspended(ChatLayout, { global: { stubs } })
    await nextTick()

    expect(maybeShowProactivelyMock).toHaveBeenCalledTimes(1)
  })
})

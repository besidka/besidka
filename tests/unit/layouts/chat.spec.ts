import { nextTick } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
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

  it('mounts the legal change notice above the page', async () => {
    const stubs = {
      NuxtPage: true,
      LegalChangeNotice: {
        template: '<div data-testid="legal-change-notice-stub"/>',
      },
    }

    const wrapper = await mountSuspended(ChatLayout, { global: { stubs } })

    await flushPromises()

    expect(
      wrapper.find('[data-testid="legal-change-notice-stub"]').exists(),
    ).toBe(true)
  })
})

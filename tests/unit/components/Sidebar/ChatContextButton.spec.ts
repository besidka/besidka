import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarChatContextButton from '../../../../app/components/Sidebar/ChatContextButton.vue'
import { useSidePanel } from '../../../../app/composables/side-panel'

enableAutoUnmount(afterEach)

const outputsCount = ref<number>(0)
const layout = ref<'docked' | 'overlay' | 'sheet'>('docked')
const refresh = vi.fn()

mockNuxtImport('useSidePanelLayout', () => {
  return () => layout
})

mockNuxtImport('useChatContext', () => {
  return () => ({ outputsCount, refresh })
})

const TRIGGER = '[data-testid="sidebar-chat-context"]'
const BADGE = '[data-testid="sidebar-chat-context-badge"]'

function mountButton() {
  return mountSuspended(SidebarChatContextButton)
}

describe('Sidebar/ChatContextButton', () => {
  beforeEach(() => {
    outputsCount.value = 0
    layout.value = 'docked'
    refresh.mockReset()
    useSidePanel().close()
  })

  afterEach(() => {
    useSidePanel().close()
  })

  it('hides the badge when the chat has no outputs', async () => {
    const wrapper = await mountButton()

    expect(wrapper.find(BADGE).exists()).toBe(false)
  })

  it('shows the number of outputs in the badge', async () => {
    outputsCount.value = 7

    const wrapper = await mountButton()

    expect(wrapper.get(BADGE).text()).toBe('7')
    expect(wrapper.get(BADGE).attributes('aria-hidden')).toBe('true')
  })

  it('caps the badge at 99+', async () => {
    outputsCount.value = 99

    const wrapper = await mountButton()

    expect(wrapper.get(BADGE).text()).toBe('99')

    outputsCount.value = 100
    await nextTick()

    expect(wrapper.get(BADGE).text()).toBe('99+')

    outputsCount.value = 1204
    await nextTick()

    expect(wrapper.get(BADGE).text()).toBe('99+')
  })

  it('labels the button with the outputs count', async () => {
    const wrapper = await mountButton()
    const trigger = wrapper.get(TRIGGER)

    expect(trigger.attributes('aria-label')).toBe('Chat')

    outputsCount.value = 1
    await nextTick()

    expect(trigger.attributes('aria-label')).toBe('Chat, 1 output')

    outputsCount.value = 4
    await nextTick()

    expect(trigger.attributes('aria-label')).toBe('Chat, 4 outputs')
  })

  it.each(['docked', 'overlay'] as const)(
    'uses the panel-right icon in the %s layout',
    async (value) => {
      layout.value = value

      const wrapper = await mountButton()

      expect(wrapper.get(TRIGGER).find('.iconify').classes())
        .toContain('i-lucide:panel-right')
    },
  )

  it('uses the panel-bottom icon where the panel is a bottom sheet',
    async () => {
      layout.value = 'sheet'

      const wrapper = await mountButton()

      expect(wrapper.get(TRIGGER).find('.iconify').classes())
        .toContain('i-lucide:panel-bottom')
    })

  it('follows viewport changes between the sheet and the side layouts',
    async () => {
      const wrapper = await mountButton()
      const icon = () => wrapper.get(TRIGGER).find('.iconify').classes()

      expect(icon()).toContain('i-lucide:panel-right')

      layout.value = 'sheet'
      await nextTick()

      expect(icon()).toContain('i-lucide:panel-bottom')
      expect(icon()).not.toContain('i-lucide:panel-right')

      layout.value = 'overlay'
      await nextTick()

      expect(icon()).toContain('i-lucide:panel-right')
    })

  it('opens the context panel in the side panel on click', async () => {
    const wrapper = await mountButton()
    const sidePanel = useSidePanel()

    expect(sidePanel.isOpen.value).toBe(false)

    await wrapper.get(TRIGGER).trigger('click')

    expect(sidePanel.isOpen.value).toBe(true)
    expect(sidePanel.viewKey.value).toBe('chat-context')
    expect(sidePanel.mode.value).toBe('context')
    expect(sidePanel.title.value).toBe('Chat')
    expect(sidePanel.currentView.value?.component).toBeDefined()
  })

  it('closes the panel when clicked again', async () => {
    const wrapper = await mountButton()
    const sidePanel = useSidePanel()

    await wrapper.get(TRIGGER).trigger('click')
    await wrapper.get(TRIGGER).trigger('click')

    expect(sidePanel.isOpen.value).toBe(false)
  })

  it('replaces another panel view instead of toggling it off', async () => {
    useSidePanel().open({ viewKey: 'other-view', title: 'Other' })

    const wrapper = await mountButton()

    await wrapper.get(TRIGGER).trigger('click')

    expect(useSidePanel().viewKey.value).toBe('chat-context')
  })

  it('carries btn-active and aria-expanded only while the context panel is open',
    async () => {
      const wrapper = await mountButton()
      const trigger = wrapper.get(TRIGGER)

      expect(trigger.classes()).not.toContain('btn-active')
      expect(trigger.attributes('aria-expanded')).toBe('false')

      await trigger.trigger('click')

      expect(trigger.classes()).toContain('btn-active')
      expect(trigger.attributes('aria-expanded')).toBe('true')

      await trigger.trigger('click')

      expect(trigger.classes()).not.toContain('btn-active')
    })

  it('is not active while a detail panel is open', async () => {
    useSidePanel().open({
      viewKey: 'chat-context',
      title: 'Detail',
      mode: 'detail',
    })

    const wrapper = await mountButton()

    expect(wrapper.get(TRIGGER).classes()).not.toContain('btn-active')
  })

  it('refreshes the context when opening but not when closing', async () => {
    const wrapper = await mountButton()

    await wrapper.get(TRIGGER).trigger('click')

    expect(refresh).toHaveBeenCalledTimes(1)

    await wrapper.get(TRIGGER).trigger('click')

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes the context after a generation finishes', async () => {
    await mountButton()

    expect(refresh).not.toHaveBeenCalled()

    await useNuxtApp().callHook('chat:generation-finished')

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('stops listening for finished generations once unmounted', async () => {
    const wrapper = await mountButton()

    wrapper.unmount()
    await useNuxtApp().callHook('chat:generation-finished')

    expect(refresh).not.toHaveBeenCalled()
  })
})

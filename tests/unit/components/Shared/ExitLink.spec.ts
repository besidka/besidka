import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'
import SharedExitLink from '../../../../app/components/Shared/ExitLink.vue'

enableAutoUnmount(afterEach)

const loggedIn = ref<boolean>(false)

mockNuxtImport('useAuth', () => {
  return () => ({ loggedIn })
})

describe('Shared/ExitLink', () => {
  afterEach(() => {
    loggedIn.value = false
  })

  it('points a signed-out viewer to the landing page', async () => {
    const wrapper = await mountSuspended(SharedExitLink)
    const link = wrapper.get('[data-testid="shared-exit-link"]')

    expect(link.attributes('to')).toBe('/')
  })

  it('points a signed-in viewer to a new chat', async () => {
    loggedIn.value = true

    const wrapper = await mountSuspended(SharedExitLink)
    const link = wrapper.get('[data-testid="shared-exit-link"]')

    expect(link.attributes('to')).toBe('/chats/new')
  })

  it('follows the session when it changes after mount', async () => {
    const wrapper = await mountSuspended(SharedExitLink)

    expect(wrapper.get('[data-testid="shared-exit-link"]').attributes('to'))
      .toBe('/')

    loggedIn.value = true
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="shared-exit-link"]').attributes('to'))
      .toBe('/chats/new')
  })

  it('names the control after the app and keeps the label visible', async () => {
    const wrapper = await mountSuspended(SharedExitLink)
    const link = wrapper.get('[data-testid="shared-exit-link"]')

    expect(link.attributes('aria-label')).toBe('Open Besidka')
    expect(link.text()).toContain('Besidka')
  })

  it('collapses to the icon below the sm breakpoint', async () => {
    const wrapper = await mountSuspended(SharedExitLink)
    const link = wrapper.get('[data-testid="shared-exit-link"]')

    expect(link.classes()).toContain('max-sm:btn-square')
    expect(link.find('.max-sm\\:sr-only').exists()).toBe(true)
  })

  it('renders without a tooltip wrapper', async () => {
    const wrapper = await mountSuspended(SharedExitLink)

    expect(wrapper.find('.tooltip').exists()).toBe(false)
  })
})

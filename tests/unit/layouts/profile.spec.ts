import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import ProfileLayout from '../../../app/layouts/profile.vue'

const mocks = vi.hoisted(() => ({
  routePath: '/profile/security',
}))

mockNuxtImport('useAuth', () => {
  return () => ({
    user: ref({
      name: 'Jane Doe',
      email: 'jane@example.com',
      image: null,
    }),
    signOut: vi.fn(),
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({ path: mocks.routePath })
})

async function mountLayout() {
  return await mountSuspended(ProfileLayout, {
    global: {
      stubs: {
        NuxtPage: true,
        SidebarThemeSwitcher: true,
      },
    },
  })
}

describe('profile layout', () => {
  it('lists Security, API Keys, Memory, Preferences, Storage, Connected apps and Labs tabs in that order', async () => {
    mocks.routePath = '/profile/security'

    const wrapper = await mountLayout()
    const tabs = wrapper.findAll('nav[aria-label="Account sections"] a')

    expect(tabs.map(tab => tab.text())).toEqual([
      'Security',
      'API Keys',
      'Memory',
      'Preferences',
      'Storage',
      'Connected apps',
      'Labs',
    ])
    expect(tabs.map(tab => tab.attributes('to'))).toEqual([
      '/profile/security',
      '/profile/keys',
      '/profile/memory',
      '/profile/preferences',
      '/profile/storage',
      '/profile/connected-apps',
      '/profile/labs',
    ])
  })

  it('highlights the Security tab when visiting /profile/security', async () => {
    mocks.routePath = '/profile/security'

    const wrapper = await mountLayout()
    const tabs = wrapper.findAll('nav[aria-label="Account sections"] a')

    expect(tabs[0]?.classes()).toContain('tab-active')
    expect(tabs[1]?.classes()).not.toContain('tab-active')
  })

  it('highlights the API Keys tab when visiting /profile/keys', async () => {
    mocks.routePath = '/profile/keys'

    const wrapper = await mountLayout()
    const tabs = wrapper.findAll('nav[aria-label="Account sections"] a')

    expect(tabs[0]?.classes()).not.toContain('tab-active')
    expect(tabs[1]?.classes()).toContain('tab-active')
  })

  it('highlights the Memory tab when visiting /profile/memory', async () => {
    mocks.routePath = '/profile/memory'

    const wrapper = await mountLayout()
    const tabs = wrapper.findAll('nav[aria-label="Account sections"] a')

    expect(tabs[0]?.classes()).not.toContain('tab-active')
    expect(tabs[1]?.classes()).not.toContain('tab-active')
    expect(tabs[2]?.classes()).toContain('tab-active')
  })

  it('highlights the Preferences tab when visiting /profile/preferences', async () => {
    mocks.routePath = '/profile/preferences'

    const wrapper = await mountLayout()
    const tabs = wrapper.findAll('nav[aria-label="Account sections"] a')

    expect(tabs[0]?.classes()).not.toContain('tab-active')
    expect(tabs[2]?.classes()).not.toContain('tab-active')
    expect(tabs[3]?.classes()).toContain('tab-active')
    expect(tabs[3]?.find('.iconify').classes())
      .toContain('i-lucide:sliders-horizontal')
  })

  it('highlights the Storage tab with its icon when visiting /profile/storage', async () => {
    mocks.routePath = '/profile/storage'

    const wrapper = await mountLayout()
    const tabs = wrapper.findAll('nav[aria-label="Account sections"] a')

    expect(tabs[3]?.classes()).not.toContain('tab-active')
    expect(tabs[4]?.classes()).toContain('tab-active')
    expect(tabs[4]?.find('.iconify').classes())
      .toContain('i-lucide:hard-drive')
  })

  it.each([
    '/profile/email',
    '/profile/password',
  ])('highlights the Security tab when visiting %s', async (path) => {
    mocks.routePath = path

    const wrapper = await mountLayout()
    const tabs = wrapper.findAll('nav[aria-label="Account sections"] a')

    expect(tabs[0]?.classes()).toContain('tab-active')
    expect(tabs[1]?.classes()).not.toContain('tab-active')
  })

  it('does not highlight any tab on an unrelated route', async () => {
    mocks.routePath = '/profile/unknown'

    const wrapper = await mountLayout()
    const tabs = wrapper.findAll('nav[aria-label="Account sections"] a')

    for (const tab of tabs) {
      expect(tab.classes()).not.toContain('tab-active')
    }
  })
})

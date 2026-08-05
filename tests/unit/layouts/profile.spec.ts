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
  it('lists Security and API Keys tabs in that order', async () => {
    mocks.routePath = '/profile/security'

    const wrapper = await mountLayout()
    const tabs = wrapper.findAll('nav[aria-label="Account sections"] a')

    expect(tabs.map(tab => tab.text())).toEqual([
      'Security',
      'API Keys',
    ])
    expect(tabs.map(tab => tab.attributes('to'))).toEqual([
      '/profile/security',
      '/profile/keys',
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
    mocks.routePath = '/profile/settings'

    const wrapper = await mountLayout()
    const tabs = wrapper.findAll('nav[aria-label="Account sections"] a')

    expect(tabs[0]?.classes()).not.toContain('tab-active')
    expect(tabs[1]?.classes()).not.toContain('tab-active')
  })
})

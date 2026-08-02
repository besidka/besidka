import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import ProfileLayout from '../../../app/layouts/profile.vue'

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

describe('profile layout', () => {
  it('lists Account, Security, and API Keys tabs in that order', async () => {
    const wrapper = await mountSuspended(ProfileLayout, {
      global: {
        stubs: {
          NuxtPage: true,
          SidebarThemeSwitcher: true,
        },
      },
    })

    const tabs = wrapper.findAll('nav[aria-label="Account sections"] a')

    expect(tabs.map(tab => tab.text())).toEqual([
      'Account',
      'Security',
      'API Keys',
    ])
    expect(tabs.map(tab => tab.attributes('to'))).toEqual([
      '/profile/settings',
      '/profile/security',
      '/profile/keys',
    ])
  })
})

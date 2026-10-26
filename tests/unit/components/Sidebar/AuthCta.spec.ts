import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarAuthCta from '../../../../app/components/Sidebar/AuthCta.vue'

const mocks = vi.hoisted(() => ({
  routePath: '/chats/new',
}))

mockNuxtImport('useAuth', () => {
  return () => ({
    loggedIn: ref(true),
    signOut: vi.fn(),
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({ path: mocks.routePath })
})

async function mountCta() {
  return await mountSuspended(SidebarAuthCta, {
    global: {
      stubs: {
        LazySidebarSubmenu: {
          template: '<div><slot name="trigger" /><slot /></div>',
        },
        SidebarThemeSwitcher: true,
        LazySidebarPushToggle: true,
      },
    },
  })
}

describe('sidebar auth cta', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      return {
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as MediaQueryList
    })
  })

  it('links the user menu to the preferences page', async () => {
    mocks.routePath = '/chats/new'

    const wrapper = await mountCta()
    const link = wrapper.find('a[to="/profile/preferences"]')

    expect(link.exists()).toBe(true)
    expect(link.attributes('aria-label')).toBe('Preferences')
    expect(link.find('.iconify').classes())
      .toContain('i-lucide:sliders-horizontal')
  })
})

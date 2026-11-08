import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarAuthCta from '../../../../app/components/Sidebar/AuthCta.vue'

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

const mocks = vi.hoisted(() => ({
  routePath: '/chats/new',
  routeParams: {} as Record<string, string>,
}))

mockNuxtImport('useAuth', () => {
  return () => ({
    loggedIn: ref(true),
    signOut: vi.fn(),
  })
})

mockNuxtImport('useRoute', () => {
  return () => ({ path: mocks.routePath, params: mocks.routeParams })
})

mockNuxtImport('usePushToggle', () => {
  return () => ({
    isSupported: ref(true),
    isStateKnown: ref(true),
    isEnabled: ref(false),
    isBlocked: ref(false),
    pending: ref(false),
    toggle: vi.fn(),
  })
})

function setRoute(path: string, params: Record<string, string> = {}) {
  mocks.routePath = path
  mocks.routeParams = params
}

async function mountCta() {
  return await mountSuspended(SidebarAuthCta, {
    global: {
      stubs: {
        LazySidebarSubmenu: {
          template: '<div><slot name="trigger" /><slot /></div>',
        },
        SidebarThemeSwitcher: true,
      },
    },
  })
}

describe('sidebar auth cta', () => {
  beforeEach(() => {
    setRoute('/chats/new')
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

  it('orders the user menu like the profile tabs with sign out at the edge',
    async () => {
      const wrapper = await mountCta()

      await flushPromises()

      const actions = Array.from(
        wrapper.element.querySelectorAll(
          'button[aria-label], sidebar-theme-switcher-stub, a[to]',
        ),
      ).map((element) => {
        return element.getAttribute('to')
          ?? element.getAttribute('aria-label')
          ?? element.tagName.toLowerCase()
      })

      expect(actions).toEqual([
        'Sign out',
        'sidebar-theme-switcher-stub',
        '/profile/security',
        '/profile/keys',
        'Enable push notifications',
      ])
    })

  it('links the profile shortcuts to security and API keys', async () => {
    const wrapper = await mountCta()
    const security = wrapper.find('a[to="/profile/security"]')
    const keys = wrapper.find('a[to="/profile/keys"]')

    expect(security.attributes('aria-label')).toBe('Security')
    expect(security.find('.iconify').classes())
      .toContain('i-lucide:shield-check')
    expect(keys.attributes('aria-label')).toBe('API keys')
    expect(keys.find('.iconify').classes())
      .toContain('i-lucide:key-round')
  })

  it('does not link the user menu to the preferences page', async () => {
    const wrapper = await mountCta()

    expect(wrapper.find('a[to="/profile/preferences"]').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Preferences"]').exists()).toBe(false)
  })

  it('keeps pin sidebar and cookie settings out of the user menu everywhere',
    async () => {
      const paths = [
        `/chats/${CHAT_SLUG}`,
        '/shared/share-slug',
        '/chats/new',
        '/profile/keys',
        '/chats/history',
      ]

      for (const path of paths) {
        setRoute(path, { slug: CHAT_SLUG })

        const wrapper = await mountCta()

        await flushPromises()

        const labels = Array.from(
          wrapper.element.querySelectorAll('[aria-label]'),
        ).map((element) => {
          return element.getAttribute('aria-label')
        })

        expect(labels, path).not.toContain('Pin sidebar')
        expect(labels, path).not.toContain('Unpin sidebar')
        expect(labels, path).not.toContain('Cookie settings')
      }
    })
})

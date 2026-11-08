import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarAuthCta from '../../../../app/components/Sidebar/AuthCta.vue'

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

const mocks = vi.hoisted(() => ({
  routePath: '/chats/new',
  routeParams: {} as Record<string, string>,
  showPinToggle: true,
  sidebarPinned: false,
  setSidebarPinned: vi.fn(),
  expandCookieSettings: vi.fn(),
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

mockNuxtImport('useSidebarPinToggle', () => {
  return () => ({ showPinToggle: ref(mocks.showPinToggle) })
})

mockNuxtImport('useUserSetting', () => {
  return () => ({
    sidebarPinned: ref(mocks.sidebarPinned),
    setSidebarPinned: mocks.setSidebarPinned,
  })
})

mockNuxtImport('useCookieConsentUi', () => {
  return () => ({ expand: mocks.expandCookieSettings })
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

function setChatRoute() {
  setRoute(`/chats/${CHAT_SLUG}`, { slug: CHAT_SLUG })
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
    mocks.showPinToggle = true
    mocks.sidebarPinned = false
    mocks.setSidebarPinned.mockReset()
    mocks.expandCookieSettings.mockReset()
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

  it('adds pin sidebar and cookie settings as the last rows on a chat page',
    async () => {
      setChatRoute()

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
        'Pin sidebar',
        'Cookie settings',
      ])
    })

  it('adds the rows on a shared chat page too', async () => {
    setRoute('/shared/share-slug', { slug: 'share-slug' })

    const wrapper = await mountCta()

    expect(wrapper.find('[data-testid="user-menu-pin-sidebar"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="user-menu-cookie-settings"]').exists())
      .toBe(true)
  })

  it('keeps both rows out of the menu on pages that are not chats',
    async () => {
      for (const path of ['/chats/new', '/profile/keys', '/chats/history']) {
        setRoute(path)

        const wrapper = await mountCta()

        expect(wrapper.find('[data-testid="user-menu-pin-sidebar"]').exists())
          .toBe(false)
        expect(
          wrapper.find('[data-testid="user-menu-cookie-settings"]').exists(),
        ).toBe(false)
      }
    })

  it('does not offer the dev-only test chat the extra rows', async () => {
    setRoute('/chats/test', { slug: 'test' })

    const wrapper = await mountCta()

    expect(wrapper.find('[data-testid="user-menu-pin-sidebar"]').exists())
      .toBe(false)
  })

  it('hides pin sidebar where the pill never hides but keeps cookie settings',
    async () => {
      mocks.showPinToggle = false
      setChatRoute()

      const wrapper = await mountCta()

      expect(wrapper.find('[data-testid="user-menu-pin-sidebar"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="user-menu-cookie-settings"]').exists())
        .toBe(true)
    })

  it('toggles the pinned state from the pin row', async () => {
    setChatRoute()

    const wrapper = await mountCta()
    const pin = wrapper.get('[data-testid="user-menu-pin-sidebar"]')

    expect(pin.attributes('aria-label')).toBe('Pin sidebar')
    expect(pin.find('.iconify').classes()).toContain('i-lucide:pin')

    await pin.trigger('click')

    expect(mocks.setSidebarPinned).toHaveBeenCalledWith(true)
  })

  it('offers to unpin a pinned sidebar', async () => {
    mocks.sidebarPinned = true
    setChatRoute()

    const wrapper = await mountCta()
    const pin = wrapper.get('[data-testid="user-menu-pin-sidebar"]')

    expect(pin.attributes('aria-label')).toBe('Unpin sidebar')
    expect(pin.find('.iconify').classes()).toContain('i-lucide:pin-off')

    await pin.trigger('click')

    expect(mocks.setSidebarPinned).toHaveBeenCalledWith(false)
  })

  it('opens the cookie settings from the cookie row',
    async () => {
      setChatRoute()

      const wrapper = await mountCta()
      const cookies = wrapper.get(
        '[data-testid="user-menu-cookie-settings"]',
      )

      expect(cookies.attributes('aria-label')).toBe('Cookie settings')
      expect(cookies.find('.iconify').classes())
        .toContain('i-lucide:cookie')

      await cookies.trigger('click')

      expect(mocks.expandCookieSettings).toHaveBeenCalledOnce()
    })
})

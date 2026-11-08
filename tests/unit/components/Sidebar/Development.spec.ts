import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SidebarDevelopment from '../../../../app/components/Sidebar/Development.vue'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  layout: 'chat',
  showPinToggle: true,
  sidebarPinned: false,
  setSidebarPinned: vi.fn(),
  expandCookieSettings: vi.fn(),
}))

mockNuxtImport('useLayout', () => {
  return () => ref(mocks.layout)
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

const submenuStub = {
  template: '<div><slot name="trigger" /><slot /></div>',
}

const MORE = '[data-testid="sidebar-more-features"]'
const COOKIES = '[data-testid="cookies-trigger-menu"]'

function mountDevelopment() {
  return mountSuspended(SidebarDevelopment, {
    global: {
      stubs: {
        LazySidebarSubmenu: submenuStub,
        SidebarSubmenu: submenuStub,
      },
    },
  })
}

function findByLabel(
  wrapper: Awaited<ReturnType<typeof mountDevelopment>>,
  label: string,
) {
  return wrapper.find(`[aria-label="${label}"]`)
}

describe('Sidebar/Development more menu', () => {
  beforeEach(() => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
      return {
        matches: false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList
    })
    mocks.layout = 'chat'
    mocks.showPinToggle = true
    mocks.sidebarPinned = false
    mocks.setSidebarPinned.mockReset()
    mocks.expandCookieSettings.mockReset()
  })

  it('renders the more trigger', async () => {
    const wrapper = await mountDevelopment()

    expect(wrapper.get(MORE).attributes('aria-label'))
      .toBe('More Features')
  })

  it('no longer holds the chat actions that moved to the context panel',
    async () => {
      const wrapper = await mountDevelopment()

      for (const testId of [
        'sidebar-branch',
        'sidebar-share',
        'sidebar-memory-exclusion',
        'sidebar-branch-shared',
      ]) {
        expect(wrapper.find(`[data-testid="${testId}"]`).exists())
          .toBe(false)
      }

      for (const label of ['Branch', 'Share']) {
        expect(findByLabel(wrapper, label).exists()).toBe(false)
      }
    })

  it('offers pin sidebar when the pill can hide', async () => {
    const wrapper = await mountDevelopment()
    const pin = findByLabel(wrapper, 'Pin sidebar')

    expect(pin.exists()).toBe(true)

    await pin.trigger('click')

    expect(mocks.setSidebarPinned).toHaveBeenCalledWith(true)
  })

  it('offers to unpin a pinned sidebar', async () => {
    mocks.sidebarPinned = true

    const wrapper = await mountDevelopment()
    const unpin = findByLabel(wrapper, 'Unpin sidebar')

    expect(unpin.exists()).toBe(true)

    await unpin.trigger('click')

    expect(mocks.setSidebarPinned).toHaveBeenCalledWith(false)
  })

  it('hides pin sidebar where the pill never hides', async () => {
    mocks.showPinToggle = false

    const wrapper = await mountDevelopment()

    expect(findByLabel(wrapper, 'Pin sidebar').exists()).toBe(false)
    expect(findByLabel(wrapper, 'Unpin sidebar').exists()).toBe(false)
  })

  it('offers cookie settings in the chat layout', async () => {
    const wrapper = await mountDevelopment()
    const cookies = wrapper.get(COOKIES)

    expect(cookies.attributes('aria-label')).toBe('Cookie settings')

    await cookies.trigger('click')

    expect(mocks.expandCookieSettings).toHaveBeenCalledOnce()
  })

  it('leaves cookie settings out of other layouts', async () => {
    mocks.layout = 'default'

    const wrapper = await mountDevelopment()

    expect(wrapper.find(COOKIES).exists()).toBe(false)
  })
})

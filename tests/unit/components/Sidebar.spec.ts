import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../../../app/components/Sidebar.client.vue'
import { useSearchModal } from '../../../app/composables/search-modal'

enableAutoUnmount(afterEach)

const loggedIn = ref<boolean>(true)

mockNuxtImport('useAuth', () => {
  return () => ({ loggedIn })
})

function mountSidebar() {
  return mountSuspended(Sidebar, {
    global: {
      stubs: {
        SidebarAuthCta: true,
        LazySidebarNewChat: true,
        LazySidebarDevelopment: true,
      },
    },
  })
}

function stubMatchMedia() {
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
}

describe('Sidebar.client', () => {
  beforeEach(() => {
    loggedIn.value = true
    useSearchModal().isModalOpen.value = false
    stubMatchMedia()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders the search trigger with a search icon when logged in', async () => {
    const wrapper = await mountSidebar()
    const trigger = wrapper.get('[data-testid="sidebar-search-trigger"]')

    expect(trigger.attributes('aria-label')).toBe('Search')
    expect(trigger.find('.iconify').classes()).toContain('i-lucide:search')
  })

  it('hides the search trigger when logged out', async () => {
    loggedIn.value = false

    const wrapper = await mountSidebar()

    expect(wrapper.find('[data-testid="sidebar-search-trigger"]').exists())
      .toBe(false)
  })

  it('opens the shared search-modal state when clicked', async () => {
    const wrapper = await mountSidebar()
    const { isModalOpen } = useSearchModal()

    expect(isModalOpen.value).toBe(false)

    await wrapper.get('[data-testid="sidebar-search-trigger"]')
      .trigger('click')

    expect(isModalOpen.value).toBe(true)
  })

  it('carries btn-active on the search trigger while the modal is open', async () => {
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountSidebar()
    const trigger = wrapper.get('[data-testid="sidebar-search-trigger"]')

    expect(trigger.classes()).toContain('btn-active')
  })

  it('does not carry btn-active on the search trigger while the modal is closed', async () => {
    const wrapper = await mountSidebar()
    const trigger = wrapper.get('[data-testid="sidebar-search-trigger"]')

    expect(trigger.classes()).not.toContain('btn-active')
  })

  it('omits sidebar-hoverable from the root element while the modal is open', async () => {
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountSidebar()

    expect(wrapper.get('[data-testid="sidebar"]').classes())
      .not.toContain('sidebar-hoverable')
  })

  it('does not render a history icon trigger anymore', async () => {
    const wrapper = await mountSidebar()
    const iconClasses = wrapper.findAll('.iconify')
      .flatMap(icon => icon.classes())

    expect(iconClasses).not.toContain('i-lucide:history')
  })

  it('renders the home button independently of auth state', async () => {
    loggedIn.value = false

    const wrapper = await mountSidebar()
    const iconClasses = wrapper.findAll('.iconify')
      .flatMap(icon => icon.classes())

    expect(iconClasses).toContain('i-lucide:home')
  })
})

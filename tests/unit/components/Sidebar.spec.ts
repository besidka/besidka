import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../../../app/components/Sidebar.client.vue'
import { useSearchModal } from '../../../app/composables/search-modal'
import { useSidePanel } from '../../../app/composables/side-panel'

enableAutoUnmount(afterEach)

const loggedIn = ref<boolean>(true)
const sidebarElementWidth = ref<number>(0)
const isChatPage = ref<boolean>(false)

mockNuxtImport('useAuth', () => {
  return () => ({ loggedIn })
})

mockNuxtImport('useChatRoute', () => {
  return () => ({ isChatPage })
})

mockNuxtImport('useElementSize', () => {
  return () => ({ width: sidebarElementWidth, height: ref<number>(0) })
})

function mountSidebar() {
  return mountSuspended(Sidebar, {
    global: {
      stubs: {
        SidebarAuthCta: true,
        LazySidebarNewChat: true,
        LazySidebarDevelopment: true,
        SidebarChatContextButton: true,
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

function stubViewport(viewportWidth: number) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => {
    const [, amount, unit] = /min-width:\s*([\d.]+)(rem|px)/.exec(query) ?? []
    const minWidth = Number(amount) * (unit === 'rem' ? 16 : 1)

    return {
      matches: viewportWidth >= minWidth,
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

describe('Sidebar.client slot 5', () => {
  beforeEach(() => {
    loggedIn.value = true
    isChatPage.value = false
    stubMatchMedia()
  })

  afterEach(() => {
    isChatPage.value = false
    vi.restoreAllMocks()
  })

  it('shows the more menu outside chat pages', async () => {
    const wrapper = await mountSidebar()

    expect(wrapper.find('[data-testid="sidebar-more-features"]').exists())
      .toBe(true)
    expect(wrapper.find('sidebar-chat-context-button-stub').exists())
      .toBe(false)
  })

  it('swaps the more menu for the chat context button on chat pages',
    async () => {
      isChatPage.value = true

      const wrapper = await mountSidebar()

      expect(wrapper.find('sidebar-chat-context-button-stub').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="sidebar-more-features"]').exists())
        .toBe(false)
    })

  it('follows navigation between a chat page and another page', async () => {
    const wrapper = await mountSidebar()

    isChatPage.value = true
    await nextTick()

    expect(wrapper.find('sidebar-chat-context-button-stub').exists())
      .toBe(true)

    isChatPage.value = false
    await nextTick()

    expect(wrapper.find('[data-testid="sidebar-more-features"]').exists())
      .toBe(true)
    expect(wrapper.find('sidebar-chat-context-button-stub').exists())
      .toBe(false)
  })

  it('keeps search and home beside either slot 5', async () => {
    isChatPage.value = true

    const wrapper = await mountSidebar()

    expect(wrapper.find('[data-testid="sidebar-search-trigger"]').exists())
      .toBe(true)
    expect(wrapper.findAll('.iconify').flatMap((icon) => {
      return icon.classes()
    })).toContain('i-lucide:home')
  })
})

describe('Sidebar.client docked on the side panel seam', () => {
  const sidePanelView = { viewKey: 'test-view', title: 'Test panel' }

  beforeEach(() => {
    loggedIn.value = true
    sidebarElementWidth.value = 56
    useSearchModal().isModalOpen.value = false
    useSidePanel().close()
    stubViewport(1440)
  })

  afterEach(() => {
    useSidePanel().close()
    sidebarElementWidth.value = 0
    vi.restoreAllMocks()
  })

  it('docks on the seam while the panel is open, docked and not full width', async () => {
    useSidePanel().open(sidePanelView)

    const wrapper = await mountSidebar()
    const root = wrapper.get('[data-testid="sidebar"]')

    expect(root.attributes('data-docked')).toBe('true')
    expect(root.attributes('style')).toContain(
      'right: calc(var(--side-panel-width, 0px) - 28px)',
    )
    expect(root.classes()).not.toContain('sidebar-hoverable')
  })

  it('follows the panel opening and closing', async () => {
    const wrapper = await mountSidebar()
    const root = wrapper.get('[data-testid="sidebar"]')

    expect(root.attributes('data-docked')).toBeUndefined()
    expect(root.classes()).toContain('sidebar-hoverable')

    useSidePanel().open(sidePanelView)
    await nextTick()

    expect(root.attributes('data-docked')).toBe('true')
    expect(root.classes()).not.toContain('sidebar-hoverable')

    useSidePanel().close()
    await nextTick()

    expect(root.attributes('data-docked')).toBeUndefined()
    expect(root.attributes('style') ?? '').not.toContain('right:')
  })

  it('leaves the seam while the panel is collapsed and returns with it', async () => {
    useSidePanel().open(sidePanelView)

    const wrapper = await mountSidebar()
    const root = wrapper.get('[data-testid="sidebar"]')

    useSidePanel().collapse()
    await nextTick()

    expect(root.attributes('data-docked')).toBeUndefined()
    expect(root.attributes('style') ?? '').not.toContain('right:')

    useSidePanel().expand()
    await nextTick()

    expect(root.attributes('data-docked')).toBe('true')
  })

  it('has no inline right offset while the panel is closed', async () => {
    const wrapper = await mountSidebar()
    const root = wrapper.get('[data-testid="sidebar"]')

    expect(root.attributes('data-docked')).toBeUndefined()
    expect(root.attributes('style') ?? '').not.toContain('right:')
  })

  it('does not dock in the overlay layout', async () => {
    stubViewport(900)
    useSidePanel().open(sidePanelView)

    const wrapper = await mountSidebar()
    const root = wrapper.get('[data-testid="sidebar"]')

    expect(root.attributes('data-docked')).toBeUndefined()
    expect(root.attributes('style') ?? '').not.toContain('right:')
  })

  it('does not dock in the sheet layout', async () => {
    stubViewport(600)
    useSidePanel().open(sidePanelView)

    const wrapper = await mountSidebar()
    const root = wrapper.get('[data-testid="sidebar"]')

    expect(root.attributes('data-docked')).toBeUndefined()
    expect(root.attributes('style') ?? '').not.toContain('right:')
  })

  it('returns to its normal place at full width', async () => {
    useSidePanel().open(sidePanelView)
    useSidePanel().toggleFullWidth()

    const wrapper = await mountSidebar()
    const root = wrapper.get('[data-testid="sidebar"]')

    expect(root.attributes('data-docked')).toBeUndefined()
    expect(root.attributes('style') ?? '').not.toContain('right:')
  })

  it('adds a ring to the pill only while docked', async () => {
    const wrapper = await mountSidebar()

    expect(wrapper.find('.ring-1').exists()).toBe(false)

    useSidePanel().open(sidePanelView)
    await nextTick()

    expect(wrapper.find('.ring-1').exists()).toBe(true)
  })
})

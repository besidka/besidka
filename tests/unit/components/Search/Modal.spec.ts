import { nextTick, reactive, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemePreference } from '~/types/favicon.d'
import SearchModal from '../../../../app/components/Search/Modal.client.vue'
import { useSearchModal } from '../../../../app/composables/search-modal'
import { useFilesModalHandoff } from '../../../../app/composables/files-modal-handoff'
import {
  createHistoryChat,
  createHistoryResponse,
} from '../../../setup/helpers/history-fixtures'

const mocks = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  navigateToMock: vi.fn(),
  toggleThemeMock: vi.fn(),
}))

const loggedIn = ref<boolean>(true)
const currentPreference = ref<ThemePreference>('light')
const mockRoute = reactive<{ name: string | undefined, path: string }>({
  name: 'chats-new',
  path: '/chats/new',
})

mockNuxtImport('$fetch', () => mocks.fetchMock)
mockNuxtImport('navigateTo', () => mocks.navigateToMock)

mockNuxtImport('useAuth', () => {
  return () => ({ loggedIn })
})

mockNuxtImport('useRoute', () => {
  return () => mockRoute
})

mockNuxtImport('useThemeToggle', () => {
  return () => ({
    currentPreference,
    toggle: mocks.toggleThemeMock,
  })
})

enableAutoUnmount(afterEach)

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

function mountModal() {
  return mountSuspended(SearchModal, { attachTo: document.body })
}

async function waitForDebouncedSearch() {
  await new Promise((resolve) => {
    setTimeout(resolve, 250)
  })
  await nextTick()
}

async function waitForRecentChatsFetch() {
  await new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
  await nextTick()
}

let showModalSpy: ReturnType<typeof vi.spyOn>
let closeSpy: ReturnType<typeof vi.spyOn>

describe('Search/Modal.client', () => {
  beforeEach(() => {
    loggedIn.value = true
    currentPreference.value = 'light'
    mockRoute.name = 'chats-new'
    mockRoute.path = '/chats/new'

    mocks.fetchMock.mockReset()
    mocks.navigateToMock.mockReset().mockResolvedValue(undefined)
    mocks.toggleThemeMock.mockReset()

    useSearchModal().isModalOpen.value = false
    useFilesModalHandoff().clearPendingOpen()

    stubMatchMedia()

    showModalSpy = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(() => {})
    closeSpy = vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not call showModal while the modal is closed', async () => {
    await mountModal()

    expect(showModalSpy).not.toHaveBeenCalled()
  })

  it('opens the dialog and focuses the search input when isModalOpen becomes true', async () => {
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()
    await nextTick()
    await nextTick()

    expect(showModalSpy).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(wrapper.find('input').element)
  })

  it('sets role=listbox, an aria-label, and the js-search-modal class', async () => {
    const wrapper = await mountModal()

    expect(wrapper.find('[data-testid="search-modal-results"]')
      .attributes('role')).toBe('listbox')
    expect(wrapper.find('dialog').attributes('aria-label')).toBe('Search')
    expect(wrapper.find('dialog').classes()).toContain('js-search-modal')
  })

  it('syncs isModalOpen to false and resets local state on native dialog close (B1)', async () => {
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()

    await wrapper.find('input').setValue('report')
    await nextTick()

    await wrapper.find('dialog').trigger('close')

    expect(useSearchModal().isModalOpen.value).toBe(false)
    expect((wrapper.find('input').element as HTMLInputElement).value)
      .toBe('')
  })

  it('renders the six documented command rows in order for an empty query', async () => {
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()
    await nextTick()

    const ids = wrapper.findAll('[role="option"]')
      .map(option => option.attributes('id'))

    expect(ids).toEqual([
      'search-option-new-chat',
      'search-option-history',
      'search-option-attachments',
      'search-option-theme',
      'search-option-security',
      'search-option-keys',
    ])
  })

  it('marks section headings as aria-hidden', async () => {
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()
    await nextTick()

    const headingTexts = wrapper.findAll('[aria-hidden="true"]')
      .map(heading => heading.text())

    expect(headingTexts).toEqual(expect.arrayContaining(['Chat', 'Settings']))
  })

  it('closes the modal before navigating to New Chat (B6)', async () => {
    useSearchModal().isModalOpen.value = true

    let isModalOpenDuringNavigate: boolean | null = null

    mocks.navigateToMock.mockImplementation(() => {
      isModalOpenDuringNavigate = useSearchModal().isModalOpen.value

      return Promise.resolve()
    })

    const wrapper = await mountModal()

    await wrapper.find('#search-option-new-chat').trigger('click')

    expect(isModalOpenDuringNavigate).toBe(false)
    expect(mocks.navigateToMock).toHaveBeenCalledWith('/chats/new')
    expect(closeSpy).toHaveBeenCalled()
  })

  it('calls toggle() for the theme row without closing the modal', async () => {
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()

    await wrapper.find('#search-option-theme').trigger('click')

    expect(mocks.toggleThemeMock).toHaveBeenCalledTimes(1)
    expect(useSearchModal().isModalOpen.value).toBe(true)
  })

  it('shows the theme icon matching the current preference', async () => {
    currentPreference.value = 'dark'
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()
    await nextTick()

    const themeIcon = wrapper.find('#search-option-theme .iconify')

    expect(themeIcon.classes()).toContain('i-lucide:moon')
  })

  it('requests the files-modal handoff without navigating while already on a chat route', async () => {
    mockRoute.name = 'chats-slug'
    mockRoute.path = '/chats/abc123'
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()

    await wrapper.find('#search-option-attachments').trigger('click')

    expect(useFilesModalHandoff().pendingOpen.value).toEqual({
      tab: 'select',
      source: 'all',
      targetPath: '/chats/abc123',
    })
    expect(mocks.navigateToMock).not.toHaveBeenCalled()
    expect(useSearchModal().isModalOpen.value).toBe(false)
  })

  it('navigates to /chats/new when requesting attachments off a chat route', async () => {
    mockRoute.name = 'profile-security'
    mockRoute.path = '/profile/security'
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()

    await wrapper.find('#search-option-attachments').trigger('click')

    expect(mocks.navigateToMock).toHaveBeenCalledWith('/chats/new')
    expect(useFilesModalHandoff().pendingOpen.value).toEqual({
      tab: 'select',
      source: 'all',
      targetPath: '/chats/new',
    })
  })

  it('clears a pending files-modal request when navigating away from chat routes', async () => {
    mockRoute.name = 'chats-slug'
    mockRoute.path = '/chats/abc123'
    useFilesModalHandoff().requestOpen('select', '/chats/abc123', 'all')

    await mountModal()

    mockRoute.name = 'profile-security'
    mockRoute.path = '/profile/security'
    await nextTick()

    expect(useFilesModalHandoff().pendingOpen.value).toBeNull()
  })

  it('keeps a pending files-modal request when the route path matches the target exactly', async () => {
    mockRoute.name = 'chats-new'
    mockRoute.path = '/chats/new'
    useFilesModalHandoff().requestOpen('select', '/chats/abc123', 'all')

    await mountModal()

    mockRoute.name = 'chats-slug'
    mockRoute.path = '/chats/abc123'
    await nextTick()

    expect(useFilesModalHandoff().pendingOpen.value).toEqual({
      tab: 'select',
      source: 'all',
      targetPath: '/chats/abc123',
    })
  })

  it('clears a stale attachments request when the route changes to a different chat than the target path (regression)', async () => {
    mockRoute.name = 'profile-security'
    mockRoute.path = '/profile/security'
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()

    await wrapper.find('#search-option-attachments').trigger('click')

    expect(useFilesModalHandoff().pendingOpen.value).toEqual({
      tab: 'select',
      source: 'all',
      targetPath: '/chats/new',
    })

    mockRoute.name = 'chats-slug'
    mockRoute.path = '/chats/abc123'
    await nextTick()

    expect(useFilesModalHandoff().pendingOpen.value).toBeNull()
  })

  it('does not query the API or show typed results for a 1-character query', async () => {
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()

    await wrapper.find('input').setValue('a')
    await waitForDebouncedSearch()

    expect(mocks.fetchMock).not.toHaveBeenCalledWith(
      '/api/v1/chats/history',
      { query: { search: 'a', limit: 5 } },
    )
    expect(wrapper.find('[data-testid="search-result-row"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="search-command-row"]').exists())
      .toBe(true)
  })

  it('runs "Find in chats" on Enter before the debounced fetch resolves', async () => {
    useSearchModal().isModalOpen.value = true
    mocks.fetchMock.mockResolvedValue(createHistoryResponse({
      chats: [createHistoryChat({ id: 'chat-1', slug: 'chat-1' })],
    }))

    const wrapper = await mountModal()

    await wrapper.find('input').setValue('report')
    await wrapper.find('input').trigger('keydown', { key: 'Enter' })

    expect(mocks.navigateToMock).toHaveBeenCalledWith({
      path: '/chats/history',
      query: { search: 'report' },
    })
  })

  it('shows fetched chat results after the debounce elapses', async () => {
    useSearchModal().isModalOpen.value = true
    mocks.fetchMock.mockResolvedValue(createHistoryResponse({
      chats: [createHistoryChat({
        id: 'chat-1',
        slug: 'chat-1',
        title: 'Growth plan',
      })],
    }))

    const wrapper = await mountModal()

    await wrapper.find('input').setValue('growth')
    await waitForDebouncedSearch()

    expect(mocks.fetchMock).toHaveBeenCalledWith('/api/v1/chats/history', {
      query: { search: 'growth', limit: 5 },
    })

    const resultRow = wrapper.find('[data-testid="search-result-row"]')

    expect(resultRow.exists()).toBe(true)
    expect(resultRow.text()).toContain('Growth plan')
  })

  it('navigates to the selected chat and closes the modal first', async () => {
    useSearchModal().isModalOpen.value = true
    mocks.fetchMock.mockResolvedValue(createHistoryResponse({
      chats: [createHistoryChat({
        id: 'chat-1',
        slug: 'chat-1',
        title: 'Growth plan',
      })],
    }))

    const wrapper = await mountModal()

    await wrapper.find('input').setValue('growth')
    await waitForDebouncedSearch()

    await wrapper.find('[data-testid="search-result-row"]').trigger('click')

    expect(mocks.navigateToMock).toHaveBeenCalledWith('/chats/chat-1')
    expect(useSearchModal().isModalOpen.value).toBe(false)
  })

  it('omits the Chats heading when the search returns no results', async () => {
    useSearchModal().isModalOpen.value = true
    mocks.fetchMock.mockResolvedValue(createHistoryResponse())

    const wrapper = await mountModal()

    await wrapper.find('input').setValue('nothing')
    await waitForDebouncedSearch()

    expect(wrapper.find('[data-testid="search-result-row"]').exists())
      .toBe(false)

    const headingTexts = wrapper.findAll('[aria-hidden="true"]')
      .map(heading => heading.text().trim())
      .filter(Boolean)

    expect(headingTexts).toEqual(['Actions'])
  })

  it('lists pinned chats before regular chats, capped at 5, without re-sorting', async () => {
    useSearchModal().isModalOpen.value = true

    const pinned = [
      createHistoryChat({ id: 'p1', slug: 'p1' }),
      createHistoryChat({ id: 'p2', slug: 'p2' }),
    ]
    const chats = [
      createHistoryChat({ id: 'c1', slug: 'c1' }),
      createHistoryChat({ id: 'c2', slug: 'c2' }),
      createHistoryChat({ id: 'c3', slug: 'c3' }),
      createHistoryChat({ id: 'c4', slug: 'c4' }),
    ]

    mocks.fetchMock.mockResolvedValue(createHistoryResponse({ pinned, chats }))

    const wrapper = await mountModal()

    await wrapper.find('input').setValue('chat')
    await waitForDebouncedSearch()

    const ids = wrapper.findAll('[role="option"]')
      .map(option => option.attributes('id'))
      .filter((id): id is string => !!id?.startsWith('search-option-chat-'))

    expect(ids).toEqual([
      'search-option-chat-p1',
      'search-option-chat-p2',
      'search-option-chat-c1',
      'search-option-chat-c2',
      'search-option-chat-c3',
    ])
  })

  it('moves the active option with ArrowDown/ArrowUp and updates aria-activedescendant', async () => {
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()
    await nextTick()

    expect(wrapper.find('input').attributes('aria-activedescendant'))
      .toBe('search-option-new-chat')

    await wrapper.find('input').trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(wrapper.find('input').attributes('aria-activedescendant'))
      .toBe('search-option-history')

    await wrapper.find('input').trigger('keydown', { key: 'ArrowUp' })
    await nextTick()
    expect(wrapper.find('input').attributes('aria-activedescendant'))
      .toBe('search-option-new-chat')
  })

  it('wraps around to the last option when pressing ArrowUp at the top', async () => {
    useSearchModal().isModalOpen.value = true

    const wrapper = await mountModal()
    await nextTick()

    await wrapper.find('input').trigger('keydown', { key: 'ArrowUp' })

    expect(wrapper.find('input').attributes('aria-activedescendant'))
      .toBe('search-option-keys')
  })

  it('opens the modal on Cmd+K when logged in and no dialog is open', async () => {
    await mountModal()

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
    }))

    expect(useSearchModal().isModalOpen.value).toBe(true)
  })

  it('ignores Cmd+K when logged out', async () => {
    loggedIn.value = false

    await mountModal()

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
    }))

    expect(useSearchModal().isModalOpen.value).toBe(false)
  })

  it('ignores Cmd+K when a dialog is already open', async () => {
    const wrapper = await mountModal()

    wrapper.find('dialog').element.setAttribute('open', '')

    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
    }))

    expect(useSearchModal().isModalOpen.value).toBe(false)
  })

  describe('recent chats (empty-query preview)', () => {
    it('fetches recent chats with limit 3 when the modal opens with an empty query', async () => {
      useSearchModal().isModalOpen.value = true
      mocks.fetchMock.mockResolvedValue(createHistoryResponse())

      await mountModal()
      await waitForRecentChatsFetch()

      expect(mocks.fetchMock).toHaveBeenCalledWith('/api/v1/chats/history', {
        query: { limit: 3 },
      })
    })

    it('merges pinned and non-pinned chats strictly by activityAt desc, capped at 3, without hoisting an older pinned chat', async () => {
      useSearchModal().isModalOpen.value = true

      const pinnedButOlder = createHistoryChat({
        id: 'pinned-older',
        slug: 'pinned-older',
        pinnedAt: '2026-03-01T00:00:00.000Z',
        activityAt: '2026-03-01T00:00:00.000Z',
      })
      const chatNewest = createHistoryChat({
        id: 'chat-newest',
        slug: 'chat-newest',
        activityAt: '2026-03-11T00:00:00.000Z',
      })
      const chatMiddle = createHistoryChat({
        id: 'chat-middle',
        slug: 'chat-middle',
        activityAt: '2026-03-08T00:00:00.000Z',
      })
      const chatExcluded = createHistoryChat({
        id: 'chat-excluded',
        slug: 'chat-excluded',
        activityAt: '2026-02-01T00:00:00.000Z',
      })

      mocks.fetchMock.mockResolvedValue(createHistoryResponse({
        pinned: [pinnedButOlder],
        chats: [chatNewest, chatMiddle, chatExcluded],
      }))

      const wrapper = await mountModal()
      await waitForRecentChatsFetch()

      const ids = wrapper.findAll('[role="option"]')
        .map(option => option.attributes('id'))
        .filter((id): id is string => !!id?.startsWith('search-option-recent-'))

      expect(ids).toHaveLength(3)
      expect(ids).toEqual([
        'search-option-recent-chat-newest',
        'search-option-recent-chat-middle',
        'search-option-recent-pinned-older',
      ])
      expect(ids[0]).not.toBe('search-option-recent-pinned-older')
    })

    it('shows a pin badge in place for a recent chat that is pinned, without reordering it', async () => {
      useSearchModal().isModalOpen.value = true

      const pinnedButOlder = createHistoryChat({
        id: 'pinned-older',
        slug: 'pinned-older',
        pinnedAt: '2026-03-01T00:00:00.000Z',
        activityAt: '2026-03-01T00:00:00.000Z',
      })
      const chatNewest = createHistoryChat({
        id: 'chat-newest',
        slug: 'chat-newest',
        activityAt: '2026-03-11T00:00:00.000Z',
      })

      mocks.fetchMock.mockResolvedValue(createHistoryResponse({
        pinned: [pinnedButOlder],
        chats: [chatNewest],
      }))

      const wrapper = await mountModal()
      await waitForRecentChatsFetch()

      const pinnedRow = wrapper.find('#search-option-recent-pinned-older')

      expect(pinnedRow.find('[data-testid="chat-pinned-badge"]').exists())
        .toBe(true)
    })

    it('places the Recent group before New Chat in keyboard index order', async () => {
      useSearchModal().isModalOpen.value = true
      mocks.fetchMock.mockResolvedValue(createHistoryResponse({
        chats: [createHistoryChat({ id: 'recent-1', slug: 'recent-1' })],
      }))

      const wrapper = await mountModal()
      await waitForRecentChatsFetch()

      const ids = wrapper.findAll('[role="option"]')
        .map(option => option.attributes('id'))

      expect(ids[0]).toBe('search-option-recent-recent-1')
      expect(ids.indexOf('search-option-recent-recent-1'))
        .toBeLessThan(ids.indexOf('search-option-new-chat'))
    })

    it('clears recentChats when the dialog is closed (resetState)', async () => {
      useSearchModal().isModalOpen.value = true
      mocks.fetchMock.mockResolvedValue(createHistoryResponse({
        chats: [createHistoryChat({ id: 'recent-1', slug: 'recent-1' })],
      }))

      const wrapper = await mountModal()
      await waitForRecentChatsFetch()

      expect(wrapper.find('#search-option-recent-recent-1').exists()).toBe(true)

      await wrapper.find('dialog').trigger('close')

      expect(wrapper.find('#search-option-recent-recent-1').exists()).toBe(false)
    })
  })
})

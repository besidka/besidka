import { nextTick, reactive, ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HistoryPage from '../../../../../app/pages/chats/history/index.vue'

const mocks = vi.hoisted(() => ({
  useHistory: vi.fn(),
}))

mockNuxtImport('useHistory', () => mocks.useHistory)

const mockRoute = reactive<{ query: Record<string, unknown> }>({
  query: {},
})

mockNuxtImport('useRoute', () => {
  return () => mockRoute
})

enableAutoUnmount(afterEach)

function createHistoryState() {
  return {
    chats: ref([]),
    pinned: ref([]),
    search: ref(''),
    isLoading: ref(false),
    isLoadingInitial: ref(false),
    isSearching: ref(false),
    hasCachedData: ref(true),
    hasMore: ref(false),
    selectedIds: ref(new Set<string>()),
    isSelectionMode: ref(false),
    selectedCount: ref(0),
    prime: vi.fn(),
    hydrateAndRefresh: vi.fn(),
    loadMore: vi.fn(),
    togglePin: vi.fn(),
    handleSelect: vi.fn(),
    enterSelectionMode: vi.fn(),
    deselectAll: vi.fn(),
    deleteSelected: vi.fn(),
    renameChat: vi.fn(),
    deleteChat: vi.fn(),
    cancelSharing: vi.fn(),
    moveChatToProject: vi.fn(),
    moveSelectedToProject: vi.fn(),
  }
}

function mountHistoryPage() {
  return mountSuspended(HistoryPage, {
    shallow: true,
  })
}

describe('pages/chats/history/index', () => {
  let historyState: ReturnType<typeof createHistoryState>

  beforeEach(() => {
    mockRoute.query = {}
    historyState = createHistoryState()
    mocks.useHistory.mockReturnValue(historyState)
  })

  it('prefills search from the initial route query on mount', async () => {
    mockRoute.query = { search: 'growth plan' }

    await mountHistoryPage()

    expect(historyState.search.value).toBe('growth plan')
  })

  it('leaves search untouched when the route query has no search param', async () => {
    historyState.search.value = 'existing draft'

    await mountHistoryPage()

    expect(historyState.search.value).toBe('existing draft')
  })

  it('reactively refills search when route.query.search changes after mount', async () => {
    await mountHistoryPage()

    expect(historyState.search.value).toBe('')

    mockRoute.query = { search: 'follow up' }
    await nextTick()

    expect(historyState.search.value).toBe('follow up')
  })
})

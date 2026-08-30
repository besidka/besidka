<template>
  <Teleport to="body">
    <dialog
      ref="modal"
      data-testid="search-modal"
      class="js-search-modal modal modal-bottom sm:modal-middle"
      aria-label="Search"
      @close="onDialogClosed"
    >
      <div
        ref="panel"
        tabindex="-1"
        class="modal-box max-w-lg max-h-[80vh] flex flex-col gap-3"
      >
        <div class="shrink-0">
          <UiSearchInput
            ref="searchInputRef"
            v-model="query"
            class="input-sm"
            :is-searching="isSearching"
            :show-keyboard-hint="false"
            placeholder="Search chats and actions..."
            @keydown="onSearchKeydown"
          />
        </div>

        <div
          ref="list"
          role="listbox"
          aria-label="Search results and actions"
          data-testid="search-modal-results"
          class="flex-1 min-h-0 overflow-y-auto -mx-1.5 px-1.5"
        >
          <template
            v-for="group in groups"
            :key="group.id"
          >
            <div
              v-if="group.heading"
              aria-hidden="true"
              class="px-3 pt-3 pb-1 text-xs font-semibold uppercase opacity-50"
            >
              {{ group.heading }}
            </div>

            <template
              v-for="item in group.items"
              :key="item.id"
            >
              <SearchResultRow
                v-if="item.chat"
                :id="item.id"
                role="option"
                :aria-selected="item.index === activeIndex"
                :chat="item.chat"
                :active="item.index === activeIndex"
                @mousemove="activeIndex = item.index"
                @select="item.run()"
              />
              <div
                v-else
                :id="item.id"
                role="option"
                :aria-selected="item.index === activeIndex"
                data-testid="search-command-row"
                class="flex items-center gap-2.5 rounded-box px-3 py-2 cursor-pointer transition-colors"
                :class="item.index === activeIndex
                  ? 'bg-base-content/10'
                  : 'hover:bg-base-content/5'"
                @click="item.run()"
                @mousemove="activeIndex = item.index"
              >
                <Icon
                  v-if="item.iconName"
                  :name="item.iconName"
                  size="16"
                  class="shrink-0 opacity-70"
                />
                <span class="truncate text-sm">
                  {{ item.label }}
                </span>
              </div>
            </template>
          </template>
        </div>
      </div>
      <form
        method="dialog"
        class="modal-backdrop"
      >
        <button>Close</button>
      </form>
    </dialog>
  </Teleport>
</template>

<script setup lang="ts">
import type { HistoryChat } from '#shared/types/history.d'
import { MIN_SEARCH_LENGTH } from '#shared/utils/search'

interface SearchInputInstance {
  inputRef: HTMLInputElement | null
}

interface SearchModalEntry {
  id: string
  iconName?: string
  label?: string
  chat?: HistoryChat
  run: () => void
}

interface SearchModalItem extends SearchModalEntry {
  index: number
}

interface SearchModalGroup<Item = SearchModalItem> {
  id: string
  heading: string | null
  items: Item[]
}

const RESULTS_LIMIT = 5
const SEARCH_DEBOUNCE_MS = 180

const route = useRoute()
const { loggedIn } = useAuth()
const { isModalOpen, openSearchModal, closeSearchModal } = useSearchModal()
const { currentPreference, toggle } = useThemeToggle()
const {
  pendingOpen: pendingFilesModalOpen,
  requestOpen: requestFilesModalOpen,
  clearPendingOpen: clearPendingFilesModalOpen,
} = useFilesModalHandoff()

const modal = useTemplateRef<HTMLDialogElement>('modal')
const panel = useTemplateRef<HTMLDivElement>('panel')
const list = useTemplateRef<HTMLElement>('list')
const searchInputRef = shallowRef<SearchInputInstance | null>(null)

const RECENT_CHATS_LIMIT = 3

const query = shallowRef<string>('')
const results = shallowRef<HistoryChat[]>([])
const recentChats = shallowRef<HistoryChat[]>([])
const isSearching = shallowRef<boolean>(false)
const activeIndex = shallowRef<number>(0)

let requestId = 0
let recentChatsRequestId = 0

const trimmedQuery = computed<string>(() => query.value.trim())

const hasSearchQuery = computed<boolean>(() => {
  return trimmedQuery.value.length >= MIN_SEARCH_LENGTH
})

const themeIconName = computed<string>(() => {
  if (currentPreference.value === 'light') {
    return 'lucide:sun'
  }

  if (currentPreference.value === 'dark') {
    return 'lucide:moon'
  }

  return 'lucide:sun-moon'
})

function dismiss() {
  closeSearchModal()
  modal.value?.close()
}

async function goTo(path: string) {
  dismiss()

  await navigateTo(path)
}

function toggleTheme() {
  toggle()
}

async function openAttachments() {
  dismiss()

  const isOnChatPage = route.name === 'chats-slug' || route.name === 'chats-new'
  const targetPath = isOnChatPage ? route.path : '/chats/new'

  requestFilesModalOpen('select', targetPath, 'all')

  if (isOnChatPage) {
    return
  }

  await navigateTo(targetPath)
}

async function findInChats() {
  const search = trimmedQuery.value

  dismiss()

  await navigateTo({ path: '/chats/history', query: { search } })
}

function buildCommandGroups(): SearchModalGroup<SearchModalEntry>[] {
  const commandGroups: SearchModalGroup<SearchModalEntry>[] = []

  if (recentChats.value.length) {
    commandGroups.push({
      id: 'recent',
      heading: 'Recent',
      items: recentChats.value.map((chat) => {
        return {
          id: `search-option-recent-${chat.id}`,
          chat,
          run: () => goTo(`/chats/${chat.slug}`),
        }
      }),
    })
  }

  commandGroups.push(
    {
      id: 'chat',
      heading: 'Chat',
      items: [
        {
          id: 'search-option-history',
          iconName: 'lucide:history',
          label: 'Manage Chat History',
          run: () => goTo('/chats/history'),
        },
        {
          id: 'search-option-attachments',
          iconName: 'lucide:paperclip',
          label: 'View All Uploaded Attachments',
          run: openAttachments,
        },
      ],
    },
    {
      id: 'settings',
      heading: 'Settings',
      items: [
        {
          id: 'search-option-theme',
          iconName: themeIconName.value,
          label: 'Toggle Theme',
          run: toggleTheme,
        },
        {
          id: 'search-option-security',
          iconName: 'lucide:shield-check',
          label: 'Security',
          run: () => goTo('/profile/security'),
        },
        {
          id: 'search-option-keys',
          iconName: 'lucide:key-round',
          label: 'API Keys',
          run: () => goTo('/profile/keys'),
        },
      ],
    },
  )

  return commandGroups
}

function buildResultGroups(): SearchModalGroup<SearchModalEntry>[] {
  const resultGroups: SearchModalGroup<SearchModalEntry>[] = []

  if (results.value.length) {
    resultGroups.push({
      id: 'chats',
      heading: 'Chats',
      items: results.value.map((chat) => {
        return {
          id: `search-option-chat-${chat.id}`,
          chat,
          run: () => goTo(`/chats/${chat.slug}`),
        }
      }),
    })
  }

  resultGroups.push({
    id: 'actions',
    heading: 'Actions',
    items: [
      {
        id: 'search-option-find-in-chats',
        iconName: 'lucide:search',
        label: `Find "${trimmedQuery.value}" in chats`,
        run: findInChats,
      },
    ],
  })

  return resultGroups
}

const groups = computed<SearchModalGroup[]>(() => {
  const rawGroups = hasSearchQuery.value
    ? buildResultGroups()
    : buildCommandGroups()
  const indexedGroups: SearchModalGroup[] = []

  let index = 0

  for (const group of rawGroups) {
    const items: SearchModalItem[] = []

    for (const entry of group.items) {
      items.push({ ...entry, index })
      index += 1
    }

    indexedGroups.push({ ...group, items })
  }

  return indexedGroups
})

const items = computed<SearchModalItem[]>(() => {
  return groups.value.flatMap((group) => {
    return group.items
  })
})

const activeDescendantId = computed<string | null>(() => {
  return items.value[activeIndex.value]?.id ?? null
})

function syncActiveDescendant() {
  const input = searchInputRef.value?.inputRef

  if (!input) {
    return
  }

  if (!activeDescendantId.value) {
    input.removeAttribute('aria-activedescendant')

    return
  }

  input.setAttribute('aria-activedescendant', activeDescendantId.value)
}

async function scrollActiveIntoView() {
  await nextTick()

  const activeId = activeDescendantId.value

  if (!activeId) {
    return
  }

  const element = list.value?.querySelector<HTMLElement>(`[id="${activeId}"]`)

  element?.scrollIntoView?.({ block: 'nearest' })
}

function moveActive(step: number) {
  const total = items.value.length

  if (!total) {
    return
  }

  activeIndex.value = (activeIndex.value + step + total) % total
  scrollActiveIntoView()
}

function runActive() {
  const item = items.value[activeIndex.value]

  if (!item) {
    return
  }

  item.run()
}

function onSearchKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveActive(1)

    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveActive(-1)

    return
  }

  if (event.key === 'Enter') {
    event.preventDefault()
    runActive()
  }
}

const runSearch = useDebounceFn(async () => {
  const search = trimmedQuery.value

  if (search.length < MIN_SEARCH_LENGTH) {
    return
  }

  requestId += 1

  const currentRequestId = requestId

  try {
    const response = await $fetch('/api/v1/chats/history', {
      query: {
        search,
        limit: RESULTS_LIMIT,
      },
    })

    if (currentRequestId !== requestId) {
      return
    }

    results.value = [
      ...response.pinned,
      ...response.chats,
    ].slice(0, RESULTS_LIMIT)
  } catch {
    if (currentRequestId !== requestId) {
      return
    }

    results.value = []
  }

  isSearching.value = false
}, SEARCH_DEBOUNCE_MS)

async function fetchRecentChats() {
  recentChatsRequestId += 1

  const currentRecentChatsRequestId = recentChatsRequestId

  try {
    const response = await $fetch('/api/v1/chats/history', {
      query: { limit: RECENT_CHATS_LIMIT },
    })

    if (currentRecentChatsRequestId !== recentChatsRequestId) {
      return
    }

    recentChats.value = [
      ...response.pinned,
      ...response.chats,
    ].sort((a, b) => {
      return new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime()
    }).slice(0, RECENT_CHATS_LIMIT)
  } catch {
    if (currentRecentChatsRequestId !== recentChatsRequestId) {
      return
    }
  }
}

function resetState() {
  requestId += 1
  query.value = ''
  results.value = []
  isSearching.value = false
  activeIndex.value = 0
}

function onDialogClosed() {
  closeSearchModal()
  resetState()
}

function isCoarsePointer(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}

async function focusSearchInput() {
  await nextTick()

  if (isCoarsePointer()) {
    panel.value?.focus()

    return
  }

  searchInputRef.value?.inputRef?.focus()
  syncActiveDescendant()
}

watch(trimmedQuery, (search) => {
  if (search.length < MIN_SEARCH_LENGTH) {
    requestId += 1
    results.value = []
    isSearching.value = false

    return
  }

  isSearching.value = true
  runSearch()
})

watch([hasSearchQuery, results], () => {
  activeIndex.value = 0
})

watch(loggedIn, (isLoggedIn) => {
  if (isLoggedIn) {
    return
  }

  recentChatsRequestId += 1
  recentChats.value = []
})

watch(activeDescendantId, () => {
  syncActiveDescendant()
}, { flush: 'post' })

let hasOpenedDialog = false

watch([isModalOpen, modal], ([open, dialog]) => {
  if (!dialog) {
    return
  }

  if (!open) {
    hasOpenedDialog = false
    dialog.close()

    return
  }

  if (hasOpenedDialog) {
    return
  }

  hasOpenedDialog = true
  dialog.showModal()
  focusSearchInput()

  if (!hasSearchQuery.value) {
    setTimeout(() => {
      fetchRecentChats()
    })
  }
}, { immediate: true, flush: 'post' })

watch(() => route.path, (routePath) => {
  if (!pendingFilesModalOpen.value) {
    return
  }

  if (routePath === pendingFilesModalOpen.value.targetPath) {
    return
  }

  clearPendingFilesModalOpen()
})

function onGlobalKeydown(event: KeyboardEvent) {
  if (!loggedIn.value) {
    return
  }

  if (document.querySelector('dialog[open]')) {
    return
  }

  if (!(event.metaKey || event.ctrlKey)) {
    return
  }

  if (event.key?.toLowerCase() !== 'k') {
    return
  }

  event.preventDefault()
  openSearchModal()
}

onMounted(() => {
  document.addEventListener('keydown', onGlobalKeydown)
  syncActiveDescendant()
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onGlobalKeydown)
  requestId += 1
  recentChatsRequestId += 1
})
</script>

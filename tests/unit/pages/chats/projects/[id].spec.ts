import { defineComponent, h, shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectMemoryCardResponse } from '#shared/types/project-memory.d'
import * as messagesComposable from '../../../../../app/composables/messages'
import ProjectPage from '../../../../../app/pages/chats/projects/[id].vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refreshMemoryCard: vi.fn(),
  confirm: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)

mockNuxtImport('useConfirm', () => mocks.confirm)

mockNuxtImport('useIntersectionObserver', () => vi.fn())

enableAutoUnmount(afterEach)

const memoryCard = shallowRef<ProjectMemoryCardResponse | null>(null)

mockNuxtImport('useFetch', () => {
  return vi.fn(async (url: unknown) => {
    if (typeof url === 'function' || String(url).includes('/memory')) {
      return { data: memoryCard, refresh: mocks.refreshMemoryCard }
    }

    return {
      data: shallowRef({
        memoryEnabled: true,
        memoryExtractionEnabled: true,
      }),
      refresh: vi.fn(),
    }
  })
})

mockNuxtImport('useProjectChats', () => {
  return vi.fn(() => ({
    project: shallowRef({
      id: 'project-1',
      name: 'Project',
      memoryStatus: 'ready',
      pinnedAt: null,
      archivedAt: null,
      instructions: null,
    }),
    pinned: shallowRef([]),
    chats: shallowRef([]),
    hasMore: shallowRef(false),
    hasCachedData: shallowRef(true),
    isLoadingInitial: shallowRef(false),
    isLoadingMore: shallowRef(false),
    prime: vi.fn(),
    hydrateAndRefresh: vi.fn(),
    loadMore: vi.fn(),
    removeChat: vi.fn(),
    renameChat: vi.fn(),
    moveChat: vi.fn(),
    setChatShared: vi.fn(),
    togglePin: vi.fn(),
    updateProject: vi.fn(),
  }))
})

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function createCard(
  overrides: Partial<ProjectMemoryCardResponse> = {},
): ProjectMemoryCardResponse {
  return {
    projectId: 'project-1',
    memoryStatus: 'ready',
    memoryUpdatedAt: null,
    memoryDirtyAt: null,
    memoryProvider: null,
    memoryModel: null,
    memoryError: null,
    usesEntries: true,
    useAccountMemory: true,
    legacyMemory: null,
    total: 1,
    limits: {} as ProjectMemoryCardResponse['limits'],
    groups: [],
    ...overrides,
  }
}

const MemoryCardStub = defineComponent({
  name: 'ProjectsMemoryCard',
  props: ['card', 'isSavingAccountMemory', 'projectId'],
  emits: ['update-account-memory', 'toggle', 'refresh', 'changed'],
  setup(props, { emit }) {
    return () => h('div', {
      'data-testid': 'memory-card-stub',
      'data-use-account-memory': String(props.card?.useAccountMemory),
      'data-total': String(props.card?.total),
      'data-saving': String(props.isSavingAccountMemory),
    }, [
      h('button', {
        'data-testid': 'emit-account-off',
        'onClick': () => emit('update-account-memory', false),
      }),
      h('button', {
        'data-testid': 'emit-toggle',
        'onClick': () => emit('toggle'),
      }),
    ])
  },
})

async function mountPage() {
  const wrapper = await mountSuspended(ProjectPage, {
    route: '/chats/projects/project-1',
    global: {
      stubs: {
        HistoryPageShell: { template: '<div><slot /></div>' },
        ProjectsMemoryCard: MemoryCardStub,
        ProjectsInstructionsCard: true,
        ProjectsKnowledgePanel: true,
        HistoryChatSections: true,
        HistoryRenameModal: true,
        ProjectsNameModal: true,
        LazyProjectsProjectPicker: true,
        ProjectsActionsDropdown: true,
        NuxtLink: true,
        Icon: true,
      },
    },
  })

  await flushPromises()

  return wrapper
}

function readCard(wrapper: Awaited<ReturnType<typeof mountPage>>) {
  const stub = wrapper.get('[data-testid="memory-card-stub"]')

  return {
    useAccountMemory: stub.attributes('data-use-account-memory'),
    total: stub.attributes('data-total'),
    saving: stub.attributes('data-saving'),
  }
}

describe('chats/projects/[id] page account memory', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.refreshMemoryCard.mockReset()
    memoryCard.value = createCard()
    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === '/api/v1/projects/project-1') {
        return { id: 'project-1', name: 'Project', instructions: null }
      }

      return createCard()
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('updates the toggle optimistically and sends the PATCH', async () => {
    const pending = createDeferred<ProjectMemoryCardResponse>()

    mocks.fetch.mockImplementation(async (url: string) => {
      return url.endsWith('/memory') ? await pending.promise : {}
    })

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="emit-account-off"]').trigger('click')

    expect(readCard(wrapper)).toMatchObject({
      useAccountMemory: 'false',
      saving: 'true',
    })
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/projects/project-1/memory',
      { method: 'PATCH', body: { useAccountMemory: false } },
    )

    pending.resolve(createCard({ useAccountMemory: false }))
    await flushPromises()

    expect(readCard(wrapper).saving).toBe('false')
  })

  it('replaces the card with the server response on success', async () => {
    mocks.fetch.mockImplementation(async (url: string) => {
      return url.endsWith('/memory')
        ? createCard({ useAccountMemory: false, total: 7 })
        : {}
    })

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="emit-account-off"]').trigger('click')
    await flushPromises()

    expect(readCard(wrapper)).toMatchObject({
      useAccountMemory: 'false',
      total: '7',
      saving: 'false',
    })
  })

  it('reverts the toggle and shows an error toast on failure', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')

    mocks.fetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/memory')) {
        throw new Error('Network down')
      }

      return {}
    })

    const wrapper = await mountPage()

    await wrapper.get('[data-testid="emit-account-off"]').trigger('click')
    await flushPromises()

    expect(readCard(wrapper)).toMatchObject({
      useAccountMemory: 'true',
      saving: 'false',
    })
    expect(useErrorMessage).toHaveBeenCalledTimes(1)
  })

  it('ignores an earlier response that lands after a newer request',
    async () => {
      const accountSave = createDeferred<ProjectMemoryCardResponse>()
      const toggle = createDeferred<ProjectMemoryCardResponse>()

      mocks.fetch.mockImplementation(
        async (url: string, options?: { body?: Record<string, unknown> }) => {
          if (!url.endsWith('/memory')) {
            return {}
          }

          return 'useAccountMemory' in (options?.body ?? {})
            ? await accountSave.promise
            : await toggle.promise
        },
      )

      const wrapper = await mountPage()

      await wrapper.get('[data-testid="emit-account-off"]').trigger('click')
      await wrapper.get('[data-testid="emit-toggle"]').trigger('click')

      toggle.resolve(createCard({
        memoryStatus: 'disabled',
        useAccountMemory: true,
        total: 9,
      }))
      await flushPromises()

      expect(readCard(wrapper)).toMatchObject({ total: '9' })

      accountSave.resolve(createCard({ useAccountMemory: false, total: 1 }))
      await flushPromises()

      expect(readCard(wrapper)).toMatchObject({
        total: '9',
        useAccountMemory: 'true',
        saving: 'false',
      })
    })

  it('does not revert over a newer card when an earlier save fails',
    async () => {
      const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
      const accountSave = createDeferred<ProjectMemoryCardResponse>()
      const toggle = createDeferred<ProjectMemoryCardResponse>()

      mocks.fetch.mockImplementation(
        async (url: string, options?: { body?: Record<string, unknown> }) => {
          if (!url.endsWith('/memory')) {
            return {}
          }

          return 'useAccountMemory' in (options?.body ?? {})
            ? await accountSave.promise
            : await toggle.promise
        },
      )

      const wrapper = await mountPage()

      await wrapper.get('[data-testid="emit-account-off"]').trigger('click')
      await wrapper.get('[data-testid="emit-toggle"]').trigger('click')

      toggle.resolve(createCard({
        memoryStatus: 'disabled',
        useAccountMemory: false,
        total: 4,
      }))
      await flushPromises()

      accountSave.reject(new Error('Network down'))
      await flushPromises()

      expect(readCard(wrapper)).toMatchObject({
        total: '4',
        useAccountMemory: 'false',
      })
      expect(useErrorMessage).toHaveBeenCalledTimes(1)
    })
})

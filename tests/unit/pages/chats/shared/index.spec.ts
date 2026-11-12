import { computed, reactive, ref } from 'vue'
import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SharedArtifactSummary } from '../../../../../shared/utils/artifacts'
import SharedPage from '../../../../../app/pages/chats/shared/index.vue'

const mocks = vi.hoisted(() => ({
  useSharedChats: vi.fn(),
  useSharedArtifacts: vi.fn(),
  confirm: vi.fn(),
  routerPush: vi.fn(),
}))

const shareActive = ref<boolean>(true)
const mockRoute = reactive<{ path: string, query: Record<string, unknown> }>({
  path: '/chats/shared',
  query: {},
})

mockNuxtImport('useSharedChats', () => mocks.useSharedChats)
mockNuxtImport('useSharedArtifacts', () => mocks.useSharedArtifacts)
mockNuxtImport('useConfirm', () => mocks.confirm)

mockNuxtImport('useRoute', () => {
  return () => mockRoute
})

mockNuxtImport('useRouter', (original) => {
  return () => {
    return new Proxy(original(), {
      get(target, property) {
        return property === 'push'
          ? mocks.routerPush
          : Reflect.get(target, property)
      },
    })
  }
})

mockNuxtImport('useFeature', () => {
  return () => computed(() => {
    return {
      enabled: shareActive.value,
      active: shareActive.value,
      variant: null,
    }
  })
})

mockComponent('ChatArtifactShareModal', () => {
  return {
    props: ['artifactId', 'title', 'currentVersion', 'open'],
    template: '<div data-testid="share-modal-stub" :data-id="artifactId" />',
  }
})

enableAutoUnmount(afterEach)

function createSharedArtifact(
  overrides: Partial<SharedArtifactSummary> = {},
): SharedArtifactSummary {
  return {
    id: 'ArtifactPublicId01',
    title: 'Photosynthesis quiz',
    kind: 'html',
    currentVersion: 2,
    updatedAt: '2026-11-09T08:00:00.000Z',
    activeShareCount: 2,
    nearestExpiresAt: null,
    hasPermanentLink: true,
    ...overrides,
  }
}

function createChatsState() {
  return {
    chats: ref([]),
    isLoading: ref<boolean>(false),
    isLoadingInitial: ref<boolean>(false),
    hasCachedData: ref<boolean>(true),
    hasMore: ref<boolean>(false),
    selectedIds: ref(new Set<string>()),
    isSelectionMode: ref<boolean>(false),
    selectedCount: ref<number>(0),
    prime: vi.fn(),
    hydrateAndRefresh: vi.fn(),
    loadMore: vi.fn(),
    handleSelect: vi.fn(),
    enterSelectionMode: vi.fn(),
    deselectAll: vi.fn(),
    cancelSharing: vi.fn(),
    cancelSharingSelected: vi.fn(),
  }
}

function createArtifactsState() {
  return {
    items: ref<SharedArtifactSummary[]>([]),
    total: ref<number>(0),
    hasMore: ref<boolean>(false),
    hasError: ref<boolean>(false),
    hasLoaded: ref<boolean>(true),
    isInitialLoad: ref<boolean>(false),
    errorMessage: ref<string>(''),
    isLoadingMore: ref<boolean>(false),
    busyIds: ref(new Set<string>()),
    refresh: vi.fn(),
    loadMore: vi.fn(),
    copyLink: vi.fn(),
    revokeAll: vi.fn().mockResolvedValue(true),
  }
}

function mountPage() {
  return mountSuspended(SharedPage, {
    global: {
      stubs: {
        HistoryPageShell: {
          template: `
            <div>
              <p data-testid="subtitle"><slot name="subtitle" /></p>
              <slot name="toolbar" />
              <slot />
            </div>
          `,
        },
        HistoryActionsToolbar: {
          template: '<div data-testid="chats-toolbar" />',
        },
        HistoryChatSections: {
          template: '<div data-testid="chats-sections" />',
        },
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
        UiLocalDate: true,
      },
    },
  })
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('pages/chats/shared/index', () => {
  let chats: ReturnType<typeof createChatsState>
  let artifacts: ReturnType<typeof createArtifactsState>

  beforeEach(() => {
    shareActive.value = true
    mockRoute.query = {}
    chats = createChatsState()
    artifacts = createArtifactsState()
    mocks.useSharedChats.mockReturnValue(chats)
    mocks.useSharedArtifacts.mockReturnValue(artifacts)
    mocks.confirm.mockReset().mockResolvedValue({ label: 'Revoke all', index: 0 })
    mocks.routerPush.mockReset().mockResolvedValue(undefined)
  })

  it('shows the Chats and Artifacts box tabs when sharing is on',
    async () => {
      const wrapper = await mountPage()
      const tabs = wrapper.get(testId('shared-tab-filter'))

      expect(tabs.attributes('role')).toBe('tablist')
      expect(tabs.classes()).toContain('tabs-box')
      expect(tabs.findAll('input').map((tab) => {
        return tab.attributes('aria-label')
      })).toEqual(['Chats', 'Artifacts'])
      expect(wrapper.get(testId('subtitle')).text())
        .toBe('Chats and artifacts you\'ve shared with a public link')
      expect(wrapper.find(testId('chats-sections')).exists()).toBe(true)
      expect(wrapper.find(testId('shared-artifacts-list')).exists())
        .toBe(false)
    })

  it('shows no tabs and the chats subtitle when sharing is off',
    async () => {
      shareActive.value = false
      mockRoute.query = { tab: 'artifacts' }

      const wrapper = await mountPage()

      expect(wrapper.find(testId('shared-tab-filter')).exists()).toBe(false)
      expect(wrapper.get(testId('subtitle')).text())
        .toBe('Chats you\'ve shared with a public link')
      expect(wrapper.find(testId('chats-sections')).exists()).toBe(true)
    })

  it('keeps the chats list on an unknown tab value', async () => {
    mockRoute.query = { tab: 'projects' }

    const wrapper = await mountPage()

    expect(wrapper.find(testId('chats-sections')).exists()).toBe(true)
    expect(mocks.useSharedArtifacts.mock.calls[0]?.[0].enabled.value)
      .toBe(false)
  })

  it('opens the Artifacts tab from the URL and loads artifacts', async () => {
    mockRoute.query = { tab: 'artifacts' }
    artifacts.items.value = [
      createSharedArtifact(),
      createSharedArtifact({
        id: 'ArtifactPublicId02',
        title: 'Cell diagram',
        kind: 'mermaid',
        activeShareCount: 1,
        nearestExpiresAt: '2026-11-20T08:00:00.000Z',
        hasPermanentLink: false,
      }),
    ]

    const wrapper = await mountPage()
    const rows = wrapper.findAll(testId('shared-artifact-row'))

    expect(mocks.useSharedArtifacts.mock.calls[0]?.[0].enabled.value)
      .toBe(true)
    expect(wrapper.find(testId('chats-sections')).exists()).toBe(false)
    expect(rows).toHaveLength(2)
    expect(rows[0]?.get(testId('shared-artifact-row-kind')).text())
      .toBe('HTML')
    expect(rows[0]?.get(testId('shared-artifact-row-links')).text())
      .toBe('2 active links')
    expect(rows[0]?.get(testId('shared-artifact-row-expiry')).text())
      .toBe('No expiry')
    expect(rows[1]?.get(testId('shared-artifact-row-links')).text())
      .toBe('1 active link')
    expect(rows[1]?.get(testId('shared-artifact-row-expiry')).text())
      .toContain('Next expiry')
  })

  it('pushes the tab into the URL and drops it for Chats', async () => {
    const wrapper = await mountPage()

    await wrapper.get(testId('shared-tab-artifacts')).trigger('change')

    expect(mocks.routerPush).toHaveBeenCalledWith({
      path: '/chats/shared',
      query: { tab: 'artifacts' },
    })

    mockRoute.query = { tab: 'artifacts' }
    mocks.routerPush.mockClear()

    const artifactsWrapper = await mountPage()

    await artifactsWrapper.get(testId('shared-tab-chats')).trigger('change')

    expect(mocks.routerPush).toHaveBeenCalledWith({
      path: '/chats/shared',
      query: {},
    })
  })

  it('shows the empty state and the error state', async () => {
    mockRoute.query = { tab: 'artifacts' }

    const emptyWrapper = await mountPage()

    expect(emptyWrapper.find(testId('shared-artifacts-empty')).exists())
      .toBe(true)

    artifacts.hasError.value = true
    artifacts.errorMessage.value = 'Boom'

    const errorWrapper = await mountPage()

    expect(errorWrapper.get(testId('shared-artifacts-error')).text())
      .toContain('Boom')

    await errorWrapper.get(testId('shared-artifacts-retry')).trigger('click')

    expect(artifacts.refresh).toHaveBeenCalledTimes(1)
  })

  it('loads more artifacts', async () => {
    mockRoute.query = { tab: 'artifacts' }
    artifacts.items.value = [createSharedArtifact()]
    artifacts.hasMore.value = true

    const wrapper = await mountPage()

    await wrapper.get(testId('shared-artifacts-load-more')).trigger('click')

    expect(artifacts.loadMore).toHaveBeenCalledTimes(1)
  })

  it('copies a link and opens the share modal from the row actions',
    async () => {
      mockRoute.query = { tab: 'artifacts' }

      const artifact = createSharedArtifact()

      artifacts.items.value = [artifact]

      const wrapper = await mountPage()

      await wrapper.get(testId('shared-artifact-action-copy'))
        .trigger('click')

      expect(artifacts.copyLink).toHaveBeenCalledWith(artifact)

      await wrapper.get(testId('shared-artifact-action-manage'))
        .trigger('click')
      await flushPromises()

      expect(wrapper.get(testId('share-modal-stub')).attributes('data-id'))
        .toBe(artifact.id)
    })

  it('revokes every link after a confirmation', async () => {
    mockRoute.query = { tab: 'artifacts' }

    const artifact = createSharedArtifact()

    artifacts.items.value = [artifact]

    const wrapper = await mountPage()

    await wrapper.get(testId('shared-artifact-action-revoke'))
      .trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    expect(artifacts.revokeAll).toHaveBeenCalledWith(artifact)
  })

  it('does not revoke when the confirmation is declined', async () => {
    mockRoute.query = { tab: 'artifacts' }
    mocks.confirm.mockResolvedValue(false)
    artifacts.items.value = [createSharedArtifact()]

    const wrapper = await mountPage()

    await wrapper.get(testId('shared-artifact-action-revoke'))
      .trigger('click')
    await flushPromises()

    expect(artifacts.revokeAll).not.toHaveBeenCalled()
  })
})

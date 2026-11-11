import { computed, nextTick, reactive, ref } from 'vue'
import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactSummary } from '../../../../../shared/utils/artifacts'
import ArtifactsPage from '../../../../../app/pages/chats/artifacts/index.vue'
import { useArtifactPanel } from '../../../../../app/composables/artifacts'
import { useSidePanel } from '../../../../../app/composables/side-panel'

const mocks = vi.hoisted(() => ({
  useArtifactLibrary: vi.fn(),
  useArtifactLibraryFilters: vi.fn(),
  navigateTo: vi.fn(),
  confirm: vi.fn(),
  loadArtifactDetail: vi.fn(),
  loadArtifactVersion: vi.fn(),
  downloadArtifactFile: vi.fn(),
  routerReplace: vi.fn(),
  errorMessage: vi.fn(),
  successMessage: vi.fn(),
  warningMessage: vi.fn(),
}))

const artifactsActive = ref<boolean>(true)
const shareActive = ref<boolean>(true)
const mockRoute = reactive<{ path: string, query: Record<string, unknown> }>({
  path: '/chats/artifacts',
  query: {},
})

mockNuxtImport('useArtifactLibrary', () => mocks.useArtifactLibrary)
mockNuxtImport(
  'useArtifactLibraryFilters',
  () => mocks.useArtifactLibraryFilters,
)
mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('loadArtifactDetail', () => mocks.loadArtifactDetail)
mockNuxtImport('loadArtifactVersion', () => mocks.loadArtifactVersion)
mockNuxtImport('downloadArtifactFile', () => mocks.downloadArtifactFile)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)
mockNuxtImport('useSuccessMessage', () => mocks.successMessage)
mockNuxtImport('useWarningMessage', () => mocks.warningMessage)

mockNuxtImport('useRoute', () => {
  return () => mockRoute
})

mockNuxtImport('useRouter', (original) => {
  return () => {
    return new Proxy(original(), {
      get(target, property) {
        return property === 'replace'
          ? mocks.routerReplace
          : Reflect.get(target, property)
      },
    })
  }
})

mockNuxtImport('useFeature', () => {
  return (key: string) => computed(() => {
    const active = key === 'artifacts.share'
      ? shareActive.value
      : artifactsActive.value

    return { enabled: active, active, variant: null }
  })
})

mockComponent('ChatArtifactShareModal', () => {
  return {
    props: ['artifactId', 'title', 'currentVersion', 'open'],
    template: '<div data-testid="share-modal-stub" :data-id="artifactId" />',
  }
})

enableAutoUnmount(afterEach)

const ARTIFACT_ID = 'ArtifactPublicId01'

function createArtifact(
  overrides: Partial<ArtifactSummary> = {},
): ArtifactSummary {
  return {
    id: ARTIFACT_ID,
    title: 'Photosynthesis quiz',
    kind: 'html',
    currentVersion: 2,
    versionCount: 2,
    updatedAt: '2026-11-09T08:00:00.000Z',
    originChatSlug: 'chat-slug',
    originChatTitle: 'Biology help',
    createdVia: 'chat',
    activeShareCount: 0,
    takenDown: false,
    ...overrides,
  }
}

function createLibraryState() {
  return {
    items: ref<ArtifactSummary[]>([]),
    total: ref<number>(0),
    usedBytes: ref<number>(0),
    kindCounts: ref<Record<string, number> | null>(null),
    hasMore: ref<boolean>(false),
    hasError: ref<boolean>(false),
    hasLoaded: ref<boolean>(true),
    errorMessage: ref<string>(''),
    isInitialLoad: ref<boolean>(false),
    isRefreshing: ref<boolean>(false),
    isSkeletonVisible: ref<boolean>(false),
    isLoadingMore: ref<boolean>(false),
    isDeleting: ref<boolean>(false),
    selectedIds: ref(new Set<string>()),
    selectedCount: ref<number>(0),
    isSelectionMode: ref<boolean>(false),
    refresh: vi.fn(),
    refreshItem: vi.fn(),
    loadMore: vi.fn(),
    deleteArtifacts: vi.fn().mockResolvedValue({
      deletedIds: [],
      heldIds: [],
    }),
    handleSelect: vi.fn(),
    enterSelectionMode: vi.fn(),
    deselectAll: vi.fn(),
  }
}

function createFiltersState() {
  return {
    search: ref<string>(''),
    appliedQuery: ref<string>(''),
    appliedKind: ref<string>('all'),
    setKind: vi.fn().mockResolvedValue(undefined),
    clearFilters: vi.fn().mockResolvedValue(undefined),
  }
}

function mountPage() {
  return mountSuspended(ArtifactsPage, {
    global: {
      stubs: {
        HistoryPageShell: {
          template: `
            <div>
              <slot name="toolbar" />
              <slot />
            </div>
          `,
        },
        UiSearchInput: true,
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

describe('pages/chats/artifacts/index', () => {
  let library: ReturnType<typeof createLibraryState>
  let filters: ReturnType<typeof createFiltersState>

  beforeEach(() => {
    artifactsActive.value = true
    shareActive.value = true
    mockRoute.query = {}
    library = createLibraryState()
    filters = createFiltersState()
    mocks.useArtifactLibrary.mockReturnValue(library)
    mocks.useArtifactLibraryFilters.mockReturnValue(filters)
    mocks.navigateTo.mockReset().mockResolvedValue(undefined)
    mocks.confirm.mockReset().mockResolvedValue({ label: 'Delete', index: 0 })
    mocks.loadArtifactDetail.mockReset()
    mocks.loadArtifactVersion.mockReset()
    mocks.downloadArtifactFile.mockReset()
    mocks.routerReplace.mockReset().mockResolvedValue(undefined)
    mocks.errorMessage.mockReset()
    mocks.successMessage.mockReset()
    mocks.warningMessage.mockReset()
    useSidePanel().close()
    useArtifactPanel().state.value = null
  })

  it('redirects to the chat history when the artifacts feature is off',
    async () => {
      artifactsActive.value = false

      await mountPage()

      expect(mocks.navigateTo).toHaveBeenCalledWith(
        '/chats/history',
        { replace: true },
      )
    })

  it('does not redirect with the feature on', async () => {
    await mountPage()

    expect(mocks.navigateTo).not.toHaveBeenCalled()
  })

  it('passes the URL filters to the library', async () => {
    filters.appliedQuery.value = 'quiz'
    filters.appliedKind.value = 'svg'

    await mountPage()

    expect(mocks.useArtifactLibrary).toHaveBeenCalledWith({
      query: filters.appliedQuery,
      kind: filters.appliedKind,
    })
  })

  it('shows the skeleton rows while the first load runs', async () => {
    library.hasLoaded.value = false
    library.isInitialLoad.value = true
    library.isSkeletonVisible.value = true

    const wrapper = await mountPage()

    expect(wrapper.find(testId('artifact-library-skeleton')).exists())
      .toBe(true)
    expect(wrapper.find(testId('artifact-library-empty')).exists())
      .toBe(false)
    expect(wrapper.find(testId('artifact-library-usage')).exists())
      .toBe(false)
  })

  it('renders nothing but the shell before the first response', async () => {
    library.hasLoaded.value = false
    library.isInitialLoad.value = true

    const wrapper = await mountPage()

    expect(wrapper.find(testId('artifact-library-skeleton')).exists())
      .toBe(false)
    expect(wrapper.find(testId('artifact-library-empty')).exists())
      .toBe(false)
  })

  it('shows the empty state with a New chat button', async () => {
    const wrapper = await mountPage()
    const empty = wrapper.get(testId('artifact-library-empty'))

    expect(empty.text()).toContain('No artifacts yet')
    expect(empty.text())
      .toContain('Ask for a quiz, a diagram or a small app in any chat')
    expect(empty.get('a').attributes('href')).toBe('/chats/new')
    expect(empty.get('a').text()).toBe('New chat')
  })

  it('shows the no-results state with Clear when a search matches nothing',
    async () => {
      filters.appliedQuery.value = 'zzz'

      const wrapper = await mountPage()

      expect(wrapper.get(testId('artifact-library-no-results')).text())
        .toContain('Nothing matches "zzz"')
      expect(wrapper.find(testId('artifact-library-empty')).exists())
        .toBe(false)

      await wrapper.get(testId('artifact-library-clear')).trigger('click')

      expect(filters.clearFilters).toHaveBeenCalledTimes(1)
    })

  it('names the kind in the no-results state of a kind filter', async () => {
    filters.appliedKind.value = 'mermaid'

    const wrapper = await mountPage()

    expect(wrapper.get(testId('artifact-library-no-results')).text())
      .toContain('No Mermaid artifacts')
  })

  it('shows the error with Retry and no list', async () => {
    library.hasError.value = true
    library.errorMessage.value = 'Service down'

    const wrapper = await mountPage()
    const error = wrapper.get(testId('artifact-library-error'))

    expect(error.classes()).toEqual(
      expect.arrayContaining(['alert', 'alert-error', 'alert-soft']),
    )
    expect(error.text()).toContain('Service down')

    await wrapper.get(testId('artifact-library-retry')).trigger('click')

    expect(library.refresh).toHaveBeenCalledTimes(1)
    expect(wrapper.find(testId('artifact-library-empty')).exists()).toBe(false)
  })

  it('shows no empty state while more artifacts remain to load', async () => {
    library.items.value = []
    library.hasMore.value = true

    const wrapper = await mountPage()

    expect(wrapper.find(testId('artifact-library-empty')).exists()).toBe(false)
    expect(wrapper.find(testId('artifact-library-no-results')).exists())
      .toBe(false)
    expect(wrapper.find(testId('artifact-library-load-more')).exists())
      .toBe(true)
  })

  it('disables Load more while a delete runs', async () => {
    library.items.value = [createArtifact()]
    library.hasMore.value = true
    library.isDeleting.value = true

    const wrapper = await mountPage()

    expect(wrapper.get(testId('artifact-library-load-more'))
      .attributes('disabled')).toBeDefined()
  })

  it('lists the artifacts, the quota line and Load more', async () => {
    library.items.value = [
      createArtifact(),
      createArtifact({ id: 'ArtifactPublicId02', title: 'Cell diagram' }),
    ]
    library.usedBytes.value = 3 * 1024 * 1024
    library.hasMore.value = true

    const wrapper = await mountPage()

    expect(wrapper.findAll(testId('artifact-row'))).toHaveLength(2)
    expect(wrapper.get(testId('artifact-library-usage')).text())
      .toBe('Using 3.0 MB of 25.0 MB')

    await wrapper.get(testId('artifact-library-load-more')).trigger('click')

    expect(library.loadMore).toHaveBeenCalledTimes(1)
  })

  describe('kind filter', () => {
    function setCounts(overrides: Record<string, number>) {
      library.kindCounts.value = {
        html: 0,
        react: 0,
        svg: 0,
        mermaid: 0,
        markdown: 0,
        ...overrides,
      }
    }

    it('shows no chips before the counts are known', async () => {
      const wrapper = await mountPage()

      expect(wrapper.find(testId('artifact-library-kind-filter')).exists())
        .toBe(false)
    })

    it('shows no chips for an empty library', async () => {
      setCounts({})

      const wrapper = await mountPage()

      expect(wrapper.find(testId('artifact-library-kind-filter')).exists())
        .toBe(false)
    })

    it('hides the whole row when the user has a single kind', async () => {
      setCounts({ mermaid: 1 })

      const wrapper = await mountPage()

      expect(wrapper.find(testId('artifact-library-kind-filter')).exists())
        .toBe(false)
      expect(wrapper.find(testId('artifact-library-kind-all')).exists())
        .toBe(false)
    })

    it('shows All and the kinds the user has with their counts', async () => {
      setCounts({ html: 3, mermaid: 1 })

      const wrapper = await mountPage()

      expect(wrapper.findAll(
        `${testId('artifact-library-kind-filter')} button`,
      ).map(button => button.attributes('data-testid'))).toEqual([
        'artifact-library-kind-all',
        'artifact-library-kind-html',
        'artifact-library-kind-mermaid',
      ])
      expect(wrapper.get(testId('artifact-library-kind-all-count')).text())
        .toBe('4')
      expect(wrapper.get(testId('artifact-library-kind-html-count')).text())
        .toBe('3')
      expect(wrapper.get(testId('artifact-library-kind-mermaid-count')).text())
        .toBe('1')
    })

    it('applies a kind filter from the chips', async () => {
      setCounts({ html: 3, react: 2 })

      const wrapper = await mountPage()

      const react = wrapper.get(testId('artifact-library-kind-react'))

      expect(react.attributes('aria-pressed')).toBe('false')
      expect(wrapper.get(testId('artifact-library-kind-all'))
        .attributes('aria-pressed')).toBe('true')

      await react.trigger('click')

      expect(filters.setKind).toHaveBeenCalledWith('react')
    })

    it('falls back to All when the active kind is gone', async () => {
      setCounts({ html: 3, react: 2 })
      filters.appliedKind.value = 'mermaid'

      await mountPage()

      expect(filters.setKind).toHaveBeenCalledWith('all', { replace: true })
    })

    it('keeps an active kind that still has artifacts', async () => {
      setCounts({ html: 3, mermaid: 2 })
      filters.appliedKind.value = 'mermaid'

      await mountPage()

      expect(filters.setKind).not.toHaveBeenCalled()
    })
  })

  it('opens an artifact in the side panel as the owner', async () => {
    library.items.value = [createArtifact()]

    const wrapper = await mountPage()

    await wrapper.get(testId('artifact-row-open')).trigger('click')

    expect(useArtifactPanel().state.value).toMatchObject({
      artifactId: ARTIFACT_ID,
      version: 2,
      kind: 'html',
      title: 'Photosynthesis quiz',
      source: 'owner',
    })
    expect(useArtifactPanel().isOpen.value).toBe(true)
  })

  it('opens the share modal for the chosen artifact', async () => {
    library.items.value = [createArtifact()]

    const wrapper = await mountPage()

    expect(wrapper.find(testId('share-modal-stub')).exists()).toBe(false)

    await wrapper.get(testId('artifact-action-share')).trigger('click')
    await flushPromises()

    expect(wrapper.get(testId('share-modal-stub')).attributes('data-id'))
      .toBe(ARTIFACT_ID)
  })

  it('hides Share without the share feature', async () => {
    shareActive.value = false
    library.items.value = [createArtifact()]

    const wrapper = await mountPage()

    expect(wrapper.find(testId('artifact-action-share')).exists()).toBe(false)
  })

  it('downloads the current version through the source file helper',
    async () => {
      library.items.value = [createArtifact()]
      mocks.loadArtifactVersion.mockResolvedValue({
        ok: true,
        value: {
          artifactId: ARTIFACT_ID,
          version: 2,
          kind: 'svg',
          title: 'Diagram',
          content: '<svg/>',
          sizeBytes: 6,
          createdAt: '2026-11-09T08:00:00.000Z',
        },
      })

      const wrapper = await mountPage()

      await wrapper.get(testId('artifact-action-download')).trigger('click')
      await nextTick()

      expect(mocks.loadArtifactVersion).toHaveBeenCalledWith({
        artifactId: ARTIFACT_ID,
        version: 2,
        source: 'owner',
      })
      expect(mocks.downloadArtifactFile).toHaveBeenCalledTimes(1)
      expect(mocks.downloadArtifactFile.mock.calls[0]?.[0]).toMatchObject({
        fileName: 'Diagram.svg',
      })
    })

  it('does not download when the version cannot be loaded', async () => {
    library.items.value = [createArtifact()]
    mocks.loadArtifactVersion.mockResolvedValue({
      ok: false,
      status: 404,
      message: 'Artifact unavailable',
    })

    const wrapper = await mountPage()

    await wrapper.get(testId('artifact-action-download')).trigger('click')
    await nextTick()

    expect(mocks.downloadArtifactFile).not.toHaveBeenCalled()
    expect(mocks.errorMessage).toHaveBeenCalledWith(
      'This artifact is not available',
    )
  })

  describe('delete', () => {
    it('confirms before deleting one artifact and reports the result',
      async () => {
        library.items.value = [createArtifact()]
        library.deleteArtifacts.mockResolvedValue({
          deletedIds: [ARTIFACT_ID],
          heldIds: [],
        })

        const wrapper = await mountPage()

        await wrapper.get(testId('artifact-action-delete')).trigger('click')
        await nextTick()

        expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
          text: 'Delete "Photosynthesis quiz"?',
          alert: true,
          actions: ['Delete'],
          subtitle: expect.stringContaining('This cannot be undone.'),
        }))
        expect(library.deleteArtifacts).toHaveBeenCalledWith([ARTIFACT_ID])
        expect(mocks.successMessage).toHaveBeenCalledWith('Artifact deleted')
      })

    it('does not delete when the confirmation is declined', async () => {
      library.items.value = [createArtifact()]
      mocks.confirm.mockResolvedValue(null)

      const wrapper = await mountPage()

      await wrapper.get(testId('artifact-action-delete')).trigger('click')
      await nextTick()

      expect(library.deleteArtifacts).not.toHaveBeenCalled()
    })

    it('uses the documented confirmation text for a bulk delete',
      async () => {
        library.items.value = [
          createArtifact(),
          createArtifact({ id: 'ArtifactPublicId02' }),
          createArtifact({ id: 'ArtifactPublicId03' }),
        ]
        library.isSelectionMode.value = true
        library.selectedCount.value = 3
        library.selectedIds.value = new Set([
          ARTIFACT_ID,
          'ArtifactPublicId02',
          'ArtifactPublicId03',
        ])
        library.deleteArtifacts.mockResolvedValue({
          deletedIds: [ARTIFACT_ID, 'ArtifactPublicId02'],
          heldIds: ['ArtifactPublicId03'],
        })

        const wrapper = await mountPage()

        await wrapper.get(testId('bulk-delete')).trigger('click')
        await nextTick()

        expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
          text: 'Delete 3 artifacts?',
          subtitle: 'Deletes 3 artifacts, their versions and share links. '
            + 'Viewers\' saved progress is deleted too. '
            + 'This cannot be undone.',
        }))
        expect(library.deleteArtifacts).toHaveBeenCalledWith([
          ARTIFACT_ID,
          'ArtifactPublicId02',
          'ArtifactPublicId03',
        ])
        expect(mocks.successMessage)
          .toHaveBeenCalledWith('2 artifacts deleted')
        expect(mocks.warningMessage).toHaveBeenCalledWith(
          'One artifact could not be deleted',
          expect.any(String),
        )
      })

    it('closes the panel when the open artifact was deleted', async () => {
      library.items.value = [createArtifact()]
      library.deleteArtifacts.mockResolvedValue({
        deletedIds: [ARTIFACT_ID],
        heldIds: [],
      })
      useArtifactPanel().open({
        artifactId: ARTIFACT_ID,
        version: 2,
        kind: 'html',
        title: 'Photosynthesis quiz',
        source: 'owner',
      })

      const wrapper = await mountPage()

      await wrapper.get(testId('artifact-action-delete')).trigger('click')
      await nextTick()

      expect(useArtifactPanel().isOpen.value).toBe(false)
    })
  })

  describe('deep link', () => {
    it('opens the linked artifact in the panel and drops the parameter',
      async () => {
        mockRoute.query = { artifact: ARTIFACT_ID }
        mocks.loadArtifactDetail.mockResolvedValue({
          ok: true,
          value: createArtifact({ title: 'From the connected app' }),
        })

        const wrapper = await mountPage()

        await nextTick()
        await nextTick()

        expect(mocks.loadArtifactDetail)
          .toHaveBeenCalledWith(ARTIFACT_ID, { notify: false })
        expect(useArtifactPanel().state.value).toMatchObject({
          artifactId: ARTIFACT_ID,
          version: 2,
          title: 'From the connected app',
          source: 'owner',
        })
        expect(mocks.routerReplace).toHaveBeenCalledWith({
          path: '/chats/artifacts',
          query: {},
        })
        expect(wrapper.find(testId('artifact-library-notice')).exists())
          .toBe(false)
      })

    it('shows a dismissible warning for an unknown or foreign id',
      async () => {
        mockRoute.query = { artifact: ARTIFACT_ID }
        mocks.loadArtifactDetail.mockResolvedValue({
          ok: false,
          status: 404,
          message: 'Artifact unavailable',
        })

        const wrapper = await mountPage()

        await nextTick()
        await nextTick()

        const notice = wrapper.get(testId('artifact-library-notice'))

        expect(notice.classes()).toEqual(
          expect.arrayContaining(['alert-warning', 'alert-soft']),
        )
        expect(notice.text()).toContain('This artifact is not available')
        expect(useArtifactPanel().isOpen.value).toBe(false)

        await wrapper.get(testId('artifact-library-notice-dismiss'))
          .trigger('click')

        expect(wrapper.find(testId('artifact-library-notice')).exists())
          .toBe(false)
      })

    it('rejects a malformed id without a request', async () => {
      mockRoute.query = { artifact: 'x' }

      const wrapper = await mountPage()

      await nextTick()
      await nextTick()

      expect(mocks.loadArtifactDetail).not.toHaveBeenCalled()
      expect(wrapper.get(testId('artifact-library-notice')).text())
        .toContain('This artifact is not available')
    })

    it('says so when the linked artifact was removed after a report',
      async () => {
        mockRoute.query = { artifact: ARTIFACT_ID }
        mocks.loadArtifactDetail.mockResolvedValue({
          ok: true,
          value: createArtifact({ takenDown: true }),
        })

        const wrapper = await mountPage()

        await nextTick()
        await nextTick()

        expect(wrapper.get(testId('artifact-library-notice')).text())
          .toContain('removed after a report')
        expect(useArtifactPanel().isOpen.value).toBe(false)
      })
  })
})

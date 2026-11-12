import { computed, ref } from 'vue'
import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentLibraryItem } from '../../../../../shared/utils/documents'
import DocumentsPage from '../../../../../app/pages/chats/documents/index.vue'
import { useSidePanel } from '../../../../../app/composables/side-panel'

const mocks = vi.hoisted(() => ({
  useDocumentLibrary: vi.fn(),
  useDocumentLibraryFilters: vi.fn(),
  navigateTo: vi.fn(),
  confirm: vi.fn(),
  renameOpen: vi.fn(),
  renameClose: vi.fn(),
}))

const documentsActive = ref<boolean>(true)

mockNuxtImport('useDocumentLibrary', () => mocks.useDocumentLibrary)
mockNuxtImport(
  'useDocumentLibraryFilters',
  () => mocks.useDocumentLibraryFilters,
)
mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('useConfirm', () => mocks.confirm)

mockNuxtImport('useFeature', () => {
  return () => computed(() => {
    return {
      enabled: documentsActive.value,
      active: documentsActive.value,
      variant: null,
    }
  })
})

mockComponent('ChatInputFilesModalSelectRenameModal', () => {
  return {
    name: 'ChatInputFilesModalSelectRenameModal',
    emits: ['submit'],
    setup(_props: unknown, { expose }: { expose: (api: object) => void }) {
      expose({ open: mocks.renameOpen, close: mocks.renameClose })

      return () => null
    },
  }
})

enableAutoUnmount(afterEach)

function createItem(
  overrides: Partial<DocumentLibraryItem> = {},
): DocumentLibraryItem {
  return {
    id: 'doc-1',
    format: 'pdf',
    title: 'Quarterly report',
    source: 'chat',
    fileId: 'file-1',
    fileName: 'Quarterly report.pdf',
    storageKey: 'quarterly-report.pdf',
    size: 2048,
    stats: { pages: 3, slides: null, sheets: null, cells: null, images: 0 },
    originChatSlug: 'chat-slug',
    originChatTitle: 'Planning chat',
    createdAt: '2026-11-09T08:00:00.000Z',
    ...overrides,
  }
}

function createLibraryState() {
  return {
    items: ref<DocumentLibraryItem[]>([]),
    total: ref<number>(0),
    formatCounts: ref<Record<string, number> | null>(null),
    sourceCounts: ref<Record<string, number> | null>(null),
    hasMore: ref<boolean>(false),
    hasError: ref<boolean>(false),
    hasLoaded: ref<boolean>(true),
    errorMessage: ref<string>(''),
    isInitialLoad: ref<boolean>(false),
    isRefreshing: ref<boolean>(false),
    isSkeletonVisible: ref<boolean>(false),
    isLoadingMore: ref<boolean>(false),
    isMutating: ref<boolean>(false),
    refresh: vi.fn(),
    loadMore: vi.fn(),
    deleteDocument: vi.fn().mockResolvedValue(true),
    renameDocument: vi.fn().mockResolvedValue(true),
  }
}

function createFiltersState() {
  return {
    search: ref<string>(''),
    appliedQuery: ref<string>(''),
    appliedFormat: ref<string>('all'),
    appliedSource: ref<string>('all'),
    setFormat: vi.fn().mockResolvedValue(undefined),
    setSource: vi.fn().mockResolvedValue(undefined),
    clearFilters: vi.fn().mockResolvedValue(undefined),
  }
}

function mountPage() {
  return mountSuspended(DocumentsPage, {
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

describe('pages/chats/documents/index', () => {
  let library: ReturnType<typeof createLibraryState>
  let filters: ReturnType<typeof createFiltersState>

  beforeEach(() => {
    documentsActive.value = true
    library = createLibraryState()
    filters = createFiltersState()
    mocks.useDocumentLibrary.mockReturnValue(library)
    mocks.useDocumentLibraryFilters.mockReturnValue(filters)
    mocks.navigateTo.mockReset().mockResolvedValue(undefined)
    mocks.confirm.mockReset().mockResolvedValue({ label: 'Delete', index: 0 })
    mocks.renameOpen.mockReset()
    mocks.renameClose.mockReset()
    useSidePanel().close()
  })

  afterEach(() => {
    useSidePanel().close()
  })

  it('redirects to the chat history when the documents feature is off',
    async () => {
      documentsActive.value = false

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
    await mountPage()

    expect(mocks.useDocumentLibrary).toHaveBeenCalledWith({
      query: filters.appliedQuery,
      format: filters.appliedFormat,
      source: filters.appliedSource,
    })
  })

  it('shows skeleton rows while the first load runs', async () => {
    library.hasLoaded.value = false
    library.isInitialLoad.value = true
    library.isSkeletonVisible.value = true

    const wrapper = await mountPage()
    const skeleton = wrapper.get(testId('document-library-skeleton'))

    expect(skeleton.html()).toContain('skeleton skeleton--default')
    expect(wrapper.find(testId('document-library-empty')).exists())
      .toBe(false)
  })

  it('shows the empty state with a New chat button', async () => {
    const wrapper = await mountPage()
    const empty = wrapper.get(testId('document-library-empty'))

    expect(empty.text()).toContain('No documents yet')
    expect(empty.get('a').attributes('href')).toBe('/chats/new')
  })

  it('shows the no-results state and clears the filters', async () => {
    filters.appliedQuery.value = 'zzz'

    const wrapper = await mountPage()

    expect(wrapper.get(testId('document-library-no-results')).text())
      .toContain('Nothing matches "zzz"')
    expect(wrapper.find(testId('document-library-empty')).exists())
      .toBe(false)

    await wrapper.get(testId('document-library-clear')).trigger('click')

    expect(filters.clearFilters).toHaveBeenCalledTimes(1)
  })

  it('shows the error with Retry and no list', async () => {
    library.hasError.value = true
    library.errorMessage.value = 'Service down'

    const wrapper = await mountPage()
    const error = wrapper.get(testId('document-library-error'))

    expect(error.classes()).toEqual(
      expect.arrayContaining(['alert', 'alert-error', 'alert-soft']),
    )
    expect(error.text()).toContain('Service down')

    await wrapper.get(testId('document-library-retry')).trigger('click')

    expect(library.refresh).toHaveBeenCalledTimes(1)
    expect(wrapper.find(testId('document-library-empty')).exists())
      .toBe(false)
  })

  it('lists a row per document and loads more', async () => {
    library.items.value = [
      createItem(),
      createItem({ id: 'doc-2', title: 'Launch deck', format: 'pptx' }),
    ]
    library.hasMore.value = true

    const wrapper = await mountPage()

    expect(wrapper.findAll(testId('document-row'))).toHaveLength(2)

    await wrapper.get(testId('document-library-load-more')).trigger('click')

    expect(library.loadMore).toHaveBeenCalledTimes(1)
  })

  it('shows format and source filters with their counts', async () => {
    library.items.value = [createItem()]
    library.formatCounts.value = { pdf: 2, docx: 1, pptx: 0, xlsx: 0 }
    library.sourceCounts.value = { chat: 2, mcp: 1 }

    const wrapper = await mountPage()

    expect(wrapper.get(testId('document-library-format-all-count')).text())
      .toBe('3')
    expect(wrapper.get(testId('document-library-format-docx')).text())
      .toContain('Word')
    expect(wrapper.get(testId('document-library-source-mcp')).text())
      .toContain('Connected app')
  })

  it('hides a filter row with a single value', async () => {
    library.items.value = [createItem()]
    library.formatCounts.value = { pdf: 3, docx: 0, pptx: 0, xlsx: 0 }
    library.sourceCounts.value = { chat: 3, mcp: 0 }

    const wrapper = await mountPage()

    expect(wrapper.find(testId('document-library-format-filter')).exists())
      .toBe(false)
    expect(wrapper.find(testId('document-library-source-filter')).exists())
      .toBe(false)
  })

  it('applies a chosen format and source', async () => {
    library.items.value = [createItem()]
    library.formatCounts.value = { pdf: 2, docx: 1, pptx: 0, xlsx: 0 }
    library.sourceCounts.value = { chat: 2, mcp: 1 }

    const wrapper = await mountPage()

    await wrapper.get(testId('document-library-format-docx'))
      .trigger('click')
    await wrapper.get(testId('document-library-source-mcp'))
      .trigger('click')

    expect(filters.setFormat).toHaveBeenCalledWith('docx')
    expect(filters.setSource).toHaveBeenCalledWith('mcp')
  })

  it('falls back to All when the applied format has no documents left',
    async () => {
      filters.appliedFormat.value = 'pptx'
      library.formatCounts.value = { pdf: 2, docx: 1, pptx: 0, xlsx: 0 }

      await mountPage()

      expect(filters.setFormat).toHaveBeenCalledWith(
        'all',
        { replace: true },
      )
    })

  it('opens the document preview in the side panel', async () => {
    library.items.value = [createItem()]

    const wrapper = await mountPage()

    await wrapper.get(testId('document-row-open')).trigger('click')

    const panel = useSidePanel()

    expect(panel.viewKey.value).toBe('document:doc-1')
    expect(panel.title.value).toBe('Quarterly report')
    expect(panel.currentView.value?.props).toEqual({
      documentId: 'doc-1',
      format: 'pdf',
      title: 'Quarterly report',
      viewUrl: '/files/quarterly-report.pdf',
      downloadUrl: '/files/quarterly-report.pdf?download=1',
    })
  })

  it('opens the rename dialog with the file name and renames the file',
    async () => {
      const item = createItem()

      library.items.value = [item]

      const wrapper = await mountPage()

      await wrapper.get(testId('document-action-rename')).trigger('click')

      expect(mocks.renameOpen).toHaveBeenCalledWith({
        id: 'file-1',
        name: 'Quarterly report.pdf',
      })

      const modal = wrapper.findComponent({
        name: 'ChatInputFilesModalSelectRenameModal',
      })

      modal.vm.$emit('submit', 'file-1', 'Board report.pdf')
      await vi.waitFor(() => {
        expect(library.renameDocument)
          .toHaveBeenCalledWith(item, 'Board report.pdf')
      })
      await vi.waitFor(() => {
        expect(mocks.renameClose).toHaveBeenCalledTimes(1)
      })
    })

  it('deletes after a confirmation and closes its open preview',
    async () => {
      const item = createItem()

      library.items.value = [item]

      const wrapper = await mountPage()

      await wrapper.get(testId('document-row-open')).trigger('click')

      expect(useSidePanel().isOpen.value).toBe(true)

      await wrapper.get(testId('document-action-delete')).trigger('click')
      await vi.waitFor(() => {
        expect(library.deleteDocument).toHaveBeenCalledWith(item)
      })

      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Delete "Quarterly report"?',
        alert: true,
        actions: ['Delete'],
      }))
      await vi.waitFor(() => {
        expect(useSidePanel().isOpen.value).toBe(false)
      })
    })

  it('keeps the document when the confirmation is declined', async () => {
    mocks.confirm.mockResolvedValue(false)
    library.items.value = [createItem()]

    const wrapper = await mountPage()

    await wrapper.get(testId('document-action-delete')).trigger('click')
    await vi.waitFor(() => {
      expect(mocks.confirm).toHaveBeenCalledTimes(1)
    })

    expect(library.deleteDocument).not.toHaveBeenCalled()
  })

  it('keeps an unrelated preview open after a delete', async () => {
    const item = createItem()
    const other = createItem({ id: 'doc-2', title: 'Other' })

    library.items.value = [item, other]

    const wrapper = await mountPage()

    await wrapper.findAll(testId('document-row-open'))[1]!.trigger('click')
    await wrapper.findAll(testId('document-action-delete'))[0]!
      .trigger('click')
    await vi.waitFor(() => {
      expect(library.deleteDocument).toHaveBeenCalledWith(item)
    })

    expect(useSidePanel().viewKey.value).toBe('document:doc-2')
  })
})

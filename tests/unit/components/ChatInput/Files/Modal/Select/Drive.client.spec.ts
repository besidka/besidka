import { computed, reactive, ref, shallowRef } from 'vue'
import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileManagerFile } from '../../../../../../../app/types/file-manager'
import {
  FILE_MANAGER_DIALOG_KEY,
} from '../../../../../../../app/utils/file-manager-dialog'
import Drive from '../../../../../../../app/components/ChatInput/Files/Modal/Select/Drive.client.vue'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetchFiles: vi.fn(),
  loadMore: vi.fn(),
  handleSelect: vi.fn(),
  selectRange: vi.fn(),
  toggleSelectAll: vi.fn(),
  deselectAll: vi.fn(),
  renameFile: vi.fn(),
  deleteFile: vi.fn(),
  deleteSelected: vi.fn(),
  getSelectedForAttach: vi.fn(),
  resetFileManager: vi.fn(),
  refreshConnection: vi.fn(),
  pickMore: vi.fn(),
  refreshCopies: vi.fn(),
  libraryOptions: null as null | {
    getFileName: (fileId: string) => string
    isAttached: (fileId: string) => boolean
    onReplaceAttached: (previousId: string, file: unknown) => void
    onChanged: () => Promise<void>
    onConnectionIssue: () => void
  },
  confirm: vi.fn(),
  navigateTo: vi.fn(),
  warning: vi.fn(),
  closeDialog: vi.fn(),
  callHook: vi.fn(),
}))

const connectionResponse = shallowRef<unknown>(null)
const connectionStatus = shallowRef<string>('pending')
const files = ref<FileManagerFile[]>([])
const selectedIds = ref(new Set<string>())
const search = shallowRef<string>('')
const source = shallowRef<string>('upload')
const isLoading = shallowRef<boolean>(false)
const hasMore = shallowRef<boolean>(false)
const isBusy = shallowRef<boolean>(false)
const isPicking = shallowRef<boolean>(false)
const isImporting = shallowRef<boolean>(false)
const isRefreshing = shallowRef<boolean>(false)
const pagination = reactive({ offset: 0, limit: 20, total: 0 })

mockNuxtImport('useGoogleConnection', () => () => ({
  data: connectionResponse,
  status: connectionStatus,
  refresh: mocks.refreshConnection,
}))
const connectorsActive = shallowRef<boolean>(false)

mockNuxtImport('useFeature', () => () => computed(() => ({
  enabled: connectorsActive.value,
  active: connectorsActive.value,
  variant: null,
})))
mockNuxtImport('useLazyFetch', () => () => ({ data: shallowRef(null) }))
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('useWarningMessage', () => mocks.warning)
mockNuxtImport('useGoogleDriveLibrary', () => {
  return (options: NonNullable<typeof mocks.libraryOptions>) => {
    mocks.libraryOptions = options

    return {
      isPicking,
      isImporting,
      isRefreshing,
      isBusy,
      pickMore: mocks.pickMore,
      refreshCopies: mocks.refreshCopies,
    }
  }
})
mockNuxtImport('useFileManager', () => () => ({
  files,
  selectedIds,
  isLoading,
  isDeletingSelected: shallowRef(false),
  search,
  source,
  pagination,
  hasMore,
  loadedFiles: computed(() => files.value),
  selectedCount: computed(() => selectedIds.value.size),
  hasSelection: computed(() => selectedIds.value.size > 0),
  allSelected: computed(() => false),
  fetchFiles: mocks.fetchFiles,
  loadMore: mocks.loadMore,
  handleSelect: mocks.handleSelect,
  selectRange: mocks.selectRange,
  toggleSelectAll: mocks.toggleSelectAll,
  deselectAll: mocks.deselectAll,
  renameFile: mocks.renameFile,
  deleteFile: mocks.deleteFile,
  deleteSelected: mocks.deleteSelected,
  getSelectedForAttach: mocks.getSelectedForAttach,
  reset: mocks.resetFileManager,
}))

const fileViewProps = {
  files: null,
  selectedIds: null,
  isTouchSelecting: null,
  touchedIndices: null,
  allSelected: null,
  hasSelection: null,
  unsupportedReasons: null,
  unsupportedCaptions: null,
  textNotes: null,
  refreshable: Boolean,
}
const fileViewEmits = [
  'file-click',
  'refresh',
  'rename',
  'delete',
  'toggle-select-all',
]

mockComponent('ChatInputFilesModalSelectListView', async () => {
  const { defineComponent, h } = await import('vue')

  return defineComponent({
    name: 'ListViewStub',
    props: fileViewProps,
    emits: fileViewEmits,
    setup(_props, { expose }) {
      const containerRef = ref<HTMLElement | null>(null)

      expose({ containerRef })

      return () => h('div', { ref: containerRef, class: 'js-list-stub' })
    },
  })
})
mockComponent('ChatInputFilesModalSelectGridView', async () => {
  const { defineComponent, h } = await import('vue')

  return defineComponent({
    name: 'GridViewStub',
    props: fileViewProps,
    emits: fileViewEmits,
    setup(_props, { expose }) {
      const containerRef = ref<HTMLElement | null>(null)

      expose({ containerRef })

      return () => h('div', { ref: containerRef, class: 'js-grid-stub' })
    },
  })
})
mockComponent('ChatInputFilesModalSelectListSkeleton', async () => {
  const { defineComponent, h } = await import('vue')

  return defineComponent({
    name: 'ListSkeletonStub',
    setup: () => () => h('div'),
  })
})
mockComponent('ChatInputFilesModalSelectGridSkeleton', async () => {
  const { defineComponent, h } = await import('vue')

  return defineComponent({
    name: 'GridSkeletonStub',
    setup: () => () => h('div'),
  })
})
mockComponent('ChatInputFilesModalSelectActionsToolbar', async () => {
  const { defineComponent, h } = await import('vue')

  return defineComponent({
    name: 'ToolbarStub',
    props: {
      selectedCount: Number,
      maxFiles: Number,
      visible: Boolean,
      isDeleting: Boolean,
      isRefreshing: Boolean,
      refreshable: Boolean,
    },
    emits: ['deselect', 'delete', 'attach', 'refresh'],
    setup: () => () => h('div'),
  })
})
mockComponent('ChatInputFilesModalSelectRenameModal', async () => {
  const { defineComponent, h } = await import('vue')

  return defineComponent({
    name: 'RenameModalStub',
    emits: ['submit'],
    setup(_props, { expose }) {
      expose({ open: () => undefined, close: () => undefined })

      return () => h('div')
    },
  })
})

function copy(overrides: Partial<FileManagerFile> = {}): FileManagerFile {
  return {
    id: 'copy-1',
    storageKey: 'copy-1.md',
    name: 'Plan.md',
    size: 12,
    type: 'text/markdown',
    source: 'upload',
    createdAt: '2026-11-20T10:00:00.000Z',
    externalSource: 'google',
    externalId: '1DriveDriveDriveDriveDrive01',
    ...overrides,
  } as FileManagerFile
}

function connect(status: 'active' | 'needs_reauth' = 'active') {
  connectionResponse.value = {
    connection: { status, clientMode: 'besidka', capabilities: [] },
    canConnect: true,
  }
  connectionStatus.value = 'success'
}

async function mountDrive(props: Record<string, unknown> = {}) {
  const wrapper = await mountSuspended(Drive, {
    props: {
      attachedIds: new Set<string>(),
      search: '',
      viewMode: 'list',
      ...props,
    },
    global: {
      provide: {
        [FILE_MANAGER_DIALOG_KEY as symbol]: {
          close: mocks.closeDialog,
          suspend: vi.fn(),
          resume: vi.fn(),
        },
      },
    },
  })

  await flushPromises()

  return wrapper
}

function findListView(wrapper: Awaited<ReturnType<typeof mountDrive>>) {
  return wrapper.findComponent({ name: 'ListViewStub' })
}

function findGridView(wrapper: Awaited<ReturnType<typeof mountDrive>>) {
  return wrapper.findComponent({ name: 'GridViewStub' })
}

function findToolbar(wrapper: Awaited<ReturnType<typeof mountDrive>>) {
  return wrapper.findComponent({ name: 'ToolbarStub' })
}

describe('ChatInput/Files/Modal/Select/Drive', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((mock) => {
      if (typeof mock === 'function') {
        mock.mockReset()
      }
    })
    mocks.libraryOptions = null
    connectorsActive.value = false
    connectionResponse.value = null
    connectionStatus.value = 'pending'
    files.value = []
    selectedIds.value = new Set()
    search.value = ''
    source.value = 'upload'
    isLoading.value = false
    hasMore.value = false
    isBusy.value = false
    isPicking.value = false
    isImporting.value = false
    isRefreshing.value = false
    pagination.total = 0
    mocks.fetchFiles.mockResolvedValue(true)
    mocks.getSelectedForAttach.mockReturnValue([])
    mocks.deleteFile.mockResolvedValue(true)
    mocks.deleteSelected.mockResolvedValue(true)
    mocks.confirm.mockResolvedValue({ confirmed: true })
  })

  describe('states', () => {
    it('shows a skeleton while the connection is loading', async () => {
      const wrapper = await mountDrive()

      expect(wrapper.find('[data-testid="files-drive-status"]').exists())
        .toBe(false)
      expect(wrapper.findComponent({ name: 'GridSkeletonStub' }).exists())
        .toBe(true)
    })

    it('asks a user who is not connected to open the API Keys page',
      async () => {
        connectionResponse.value = { connection: null, canConnect: true }
        connectionStatus.value = 'success'

        const wrapper = await mountDrive()
        const status = wrapper.get('[data-testid="files-drive-status"]')

        expect(status.attributes('data-state')).toBe('not-connected')
        expect(status.text()).toContain(
          'Connect Google Drive on the API Keys page to pick files from it.',
        )

        await wrapper.get('[data-testid="files-drive-connect"]')
          .trigger('click')

        expect(wrapper.get('[data-testid="files-drive-connect"]').text())
          .toBe('Open API Keys')
        expect(mocks.closeDialog).toHaveBeenCalledOnce()
        expect(mocks.navigateTo).toHaveBeenCalledWith(
          '/profile/keys?tab=google',
        )
        expect(wrapper.find('[data-testid="files-drive-pick"]').exists())
          .toBe(false)
      })

    it('opens the Google Drive panel on the Connectors page when it exists',
      async () => {
        connectorsActive.value = true
        connectionResponse.value = { connection: null, canConnect: true }
        connectionStatus.value = 'success'

        const wrapper = await mountDrive()
        const status = wrapper.get('[data-testid="files-drive-status"]')

        expect(status.text()).toContain(
          'Connect Google Drive on the Connectors page to pick files from it.',
        )

        await wrapper.get('[data-testid="files-drive-connect"]')
          .trigger('click')

        expect(wrapper.get('[data-testid="files-drive-connect"]').text())
          .toBe('Open Connectors')
        expect(mocks.closeDialog).toHaveBeenCalledOnce()
        expect(mocks.navigateTo)
          .toHaveBeenCalledWith('/chats/connectors?panel=google-drive')
      })

    it('offers a reconnect when Google no longer accepts the connection',
      async () => {
        connect('needs_reauth')

        const wrapper = await mountDrive()
        const status = wrapper.get('[data-testid="files-drive-status"]')

        expect(status.attributes('data-state')).toBe('reauthorize')
        expect(status.text()).toContain(
          'Google no longer accepts the connection. Reconnect Google Drive '
          + 'on the API Keys page.',
        )
        expect(wrapper.get('[data-testid="files-drive-connect"]').text())
          .toBe('Reconnect')
      })

    it('lets the user retry when the connection could not be checked',
      async () => {
        connectionStatus.value = 'error'

        const wrapper = await mountDrive()

        expect(wrapper.get('[data-testid="files-drive-status"]').text())
          .toContain('The Google Drive connection could not be checked.')

        await wrapper.get('[data-testid="files-drive-retry"]')
          .trigger('click')

        expect(mocks.refreshConnection).toHaveBeenCalledOnce()
      })

    it('explains an empty connected tab and offers the picker', async () => {
      connect()

      const wrapper = await mountDrive()
      const empty = wrapper.get('[data-testid="files-drive-empty"]')

      expect(empty.text()).toContain('No Google Drive files yet')
      expect(empty.text()).toContain(
        'Pick files in Google Drive and Besidka saves a copy here, ready '
        + 'to attach to a message.',
      )

      await wrapper.get('[data-testid="files-drive-pick"]').trigger('click')

      expect(mocks.pickMore).toHaveBeenCalledOnce()
      expect(wrapper.findAll('[data-testid="files-drive-pick"]'))
        .toHaveLength(1)
    })

    it('says nothing matched a search instead of offering the picker',
      async () => {
        connect()

        const wrapper = await mountDrive({ search: 'budget' })
        const empty = wrapper.get('[data-testid="files-drive-empty"]')

        expect(empty.text()).toContain('No files found')
        expect(empty.find('[data-testid="files-drive-pick"]').exists())
          .toBe(false)
        expect(wrapper.findAll('[data-testid="files-drive-pick"]'))
          .toHaveLength(1)
      })

    it('shows a skeleton for the first page of copies', async () => {
      connect()
      isLoading.value = true

      const wrapper = await mountDrive({ viewMode: 'list' })

      expect(wrapper.findComponent({ name: 'ListSkeletonStub' }).exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="files-drive-empty"]').exists())
        .toBe(false)
    })
  })

  describe('the list', () => {
    it('lists the source google and follows the search', async () => {
      connect()

      const wrapper = await mountDrive({ search: 'plan' })

      expect(source.value).toBe('google')
      expect(search.value).toBe('plan')

      await wrapper.setProps({ search: 'budget' })

      expect(search.value).toBe('budget')
    })

    it('renders the copies as a list with the refresh action', async () => {
      connect()
      files.value = [copy(), copy({ id: 'copy-2', name: 'Budget.csv' })]

      const wrapper = await mountDrive({ viewMode: 'list' })
      const view = findListView(wrapper)

      expect(view.exists()).toBe(true)
      expect(view.props('files')).toHaveLength(2)
      expect(view.props('refreshable')).toBe(true)
      expect(findGridView(wrapper).exists()).toBe(false)
      expect(wrapper.get('[data-testid="files-drive-pick"]').text())
        .toBe('Pick from Google Drive')
    })

    it('renders the copies as a grid when the grid view is chosen',
      async () => {
        connect()
        files.value = [copy()]

        const wrapper = await mountDrive({ viewMode: 'grid' })

        expect(findGridView(wrapper).props('refreshable')).toBe(true)
        expect(findListView(wrapper).exists()).toBe(false)
      })

    it('loads more copies from the footer', async () => {
      connect()
      files.value = [copy()]
      hasMore.value = true
      pagination.total = 30

      const wrapper = await mountDrive()

      expect(wrapper.text()).toContain('1 / 30')

      await wrapper.get('[data-testid="files-drive-load-more"]')
        .trigger('click')

      expect(mocks.loadMore).toHaveBeenCalledOnce()
    })

    it('shows the busy label on the pick button', async () => {
      connect()
      files.value = [copy()]
      isBusy.value = true
      isImporting.value = true

      const wrapper = await mountDrive()
      const button = wrapper.get('[data-testid="files-drive-pick"]')

      expect(button.text()).toBe('Copying')
      expect(button.attributes('disabled')).toBeDefined()
    })
  })

  describe('pick more and refresh', () => {
    it('calls the picker once from the top button', async () => {
      connect()
      files.value = [copy()]

      const wrapper = await mountDrive()

      await wrapper.get('[data-testid="files-drive-pick"]').trigger('click')

      expect(mocks.pickMore).toHaveBeenCalledOnce()
    })

    it('reloads the first page and tells the modal after a change',
      async () => {
        connect()

        const wrapper = await mountDrive()

        await mocks.libraryOptions!.onChanged()

        expect(mocks.fetchFiles).toHaveBeenCalledWith(true)
        expect(wrapper.emitted('changed')).toHaveLength(1)
      })

    it('checks the connection again when the library reports an issue',
      async () => {
        connect()
        await mountDrive()

        mocks.libraryOptions!.onConnectionIssue()

        expect(mocks.refreshConnection).toHaveBeenCalledOnce()
      })

    it('names a file the library asks about, shortened', async () => {
      connect()
      files.value = [copy({ name: `${'A'.repeat(60)}.md` })]
      await mountDrive()

      expect(mocks.libraryOptions!.getFileName('copy-1').length)
        .toBeLessThan(40)
      expect(mocks.libraryOptions!.getFileName('missing')).toBe('A file')
    })

    it('refreshes one copy from its row action', async () => {
      connect()
      files.value = [copy()]

      const wrapper = await mountDrive()

      findListView(wrapper).vm.$emit('refresh', files.value[0])

      expect(mocks.refreshCopies).toHaveBeenCalledWith(['copy-1'])
    })

    it('refreshes the selection from the footer', async () => {
      connect()
      files.value = [copy(), copy({ id: 'copy-2' })]
      selectedIds.value = new Set(['copy-1', 'copy-2'])

      const wrapper = await mountDrive()
      const toolbar = findToolbar(wrapper)

      expect(toolbar.props('refreshable')).toBe(true)
      expect(toolbar.props('visible')).toBe(true)

      toolbar.vm.$emit('refresh')

      expect(mocks.refreshCopies).toHaveBeenCalledWith(['copy-1', 'copy-2'])
    })
  })

  describe('touch-swipe selection', () => {
    function touchEvent(type: string) {
      const event = new Event(type, { cancelable: true })

      Object.defineProperty(event, 'touches', {
        value: [{ clientX: 1, clientY: 1 }],
      })

      return event
    }

    function createRow(index: number): HTMLElement {
      const row = document.createElement('div')

      row.setAttribute('data-file-index', String(index))

      return row
    }

    it('selects the swiped range in the list view', async () => {
      connect()
      files.value = [copy(), copy({ id: 'copy-2' }), copy({ id: 'copy-3' })]

      const wrapper = await mountDrive({ viewMode: 'list' })
      const container = wrapper.get('.js-list-stub').element

      document.elementFromPoint = () => createRow(0)
      container.dispatchEvent(touchEvent('touchstart'))
      document.elementFromPoint = () => createRow(2)
      container.dispatchEvent(touchEvent('touchmove'))
      container.dispatchEvent(touchEvent('touchend'))

      expect(mocks.selectRange).toHaveBeenCalledWith(0, 2)
    })

    it('selects the swiped range in the grid view', async () => {
      connect()
      files.value = [copy(), copy({ id: 'copy-2' })]

      const wrapper = await mountDrive({ viewMode: 'grid' })
      const container = wrapper.get('.js-grid-stub').element

      document.elementFromPoint = () => createRow(0)
      container.dispatchEvent(touchEvent('touchstart'))
      document.elementFromPoint = () => createRow(1)
      container.dispatchEvent(touchEvent('touchmove'))
      container.dispatchEvent(touchEvent('touchend'))

      expect(mocks.selectRange).toHaveBeenCalledWith(0, 1)
    })

    it('ignores the click that follows a swipe', async () => {
      connect()
      files.value = [copy(), copy({ id: 'copy-2' })]

      const wrapper = await mountDrive({ viewMode: 'list' })
      const container = wrapper.get('.js-list-stub').element

      document.elementFromPoint = () => createRow(0)
      container.dispatchEvent(touchEvent('touchstart'))
      document.elementFromPoint = () => createRow(1)
      container.dispatchEvent(touchEvent('touchmove'))
      container.dispatchEvent(touchEvent('touchend'))
      findListView(wrapper).vm.$emit(
        'file-click',
        new MouseEvent('click'),
        files.value[1],
        1,
      )

      expect(mocks.handleSelect).not.toHaveBeenCalled()
    })

    it('stops listening when the tab goes away', async () => {
      connect()
      files.value = [copy(), copy({ id: 'copy-2' })]

      const wrapper = await mountDrive({ viewMode: 'list' })
      const container = wrapper.get('.js-list-stub').element

      wrapper.unmount()
      document.elementFromPoint = () => createRow(0)
      container.dispatchEvent(touchEvent('touchstart'))
      document.elementFromPoint = () => createRow(1)
      container.dispatchEvent(touchEvent('touchmove'))
      container.dispatchEvent(touchEvent('touchend'))

      expect(mocks.selectRange).not.toHaveBeenCalled()
    })
  })

  describe('refreshing an attached copy', () => {
    it('asks the host to swap the attachment and knows what is attached',
      async () => {
        connect()

        const wrapper = await mountDrive({
          attachedIds: new Set(['copy-1']),
        })
        const newFile = { id: 'copy-9', storageKey: 'copy-9.md' }

        expect(mocks.libraryOptions!.isAttached('copy-1')).toBe(true)
        expect(mocks.libraryOptions!.isAttached('copy-2')).toBe(false)

        mocks.libraryOptions!.onReplaceAttached('copy-1', newFile)

        expect(wrapper.emitted('replace')?.[0]).toEqual(['copy-1', newFile])
      })
  })

  describe('attach', () => {
    it('attaches the selected copies like files from the Select tab',
      async () => {
        connect()

        const selected = [copy(), copy({ id: 'copy-2', name: 'B.md' })]

        files.value = selected
        selectedIds.value = new Set(['copy-1', 'copy-2'])
        mocks.getSelectedForAttach.mockReturnValue(selected)

        const wrapper = await mountDrive()

        findToolbar(wrapper).vm.$emit('attach')

        expect(wrapper.emitted('attach')?.[0]).toEqual([selected])
      })

    it('keeps a copy the model cannot read out of the attachment',
      async () => {
        connect()

        const image = copy({ id: 'image-1', type: 'image/png', name: 'a.png' })
        const text = copy()

        files.value = [image, text]
        selectedIds.value = new Set(['image-1', 'copy-1'])
        mocks.getSelectedForAttach.mockReturnValue([image, text])

        const wrapper = await mountDrive({
          canAttachMediaType: (mediaType: string) => {
            return !mediaType.startsWith('image/')
          },
        })

        findToolbar(wrapper).vm.$emit('attach')

        expect(wrapper.emitted('attach')?.[0]).toEqual([[text]])
        expect(mocks.warning).toHaveBeenCalled()
      })

    it('attaches nothing when every selected copy is refused', async () => {
      connect()

      const image = copy({ id: 'image-1', type: 'image/png', name: 'a.png' })

      files.value = [image]
      selectedIds.value = new Set(['image-1'])
      mocks.getSelectedForAttach.mockReturnValue([image])

      const wrapper = await mountDrive({
        canAttachMediaType: () => false,
      })

      findToolbar(wrapper).vm.$emit('attach')

      expect(wrapper.emitted('attach')).toBeUndefined()
    })

    it('selects a copy on click and detaches an attached one on deselect',
      async () => {
        connect()
        files.value = [copy()]

        const wrapper = await mountDrive({
          attachedIds: new Set(['copy-1']),
        })
        const view = findListView(wrapper)
        const event = new MouseEvent('click')

        selectedIds.value = new Set(['copy-1'])
        view.vm.$emit('file-click', event, files.value[0], 0)

        expect(wrapper.emitted('detach')?.[0]).toEqual([['copy-1']])
        expect(mocks.handleSelect).toHaveBeenCalledWith('copy-1', 0, false)
      })

    it('selects an attached copy once the list has loaded', async () => {
      connect()

      await mountDrive({ attachedIds: new Set(['copy-1']) })

      files.value = [copy()]
      await flushPromises()

      expect(selectedIds.value.has('copy-1')).toBe(true)
    })

    it('drops the selection of a copy that is no longer attached',
      async () => {
        connect()

        const wrapper = await mountDrive({ attachedIds: new Set(['copy-1']) })

        files.value = [copy()]
        await flushPromises()
        await wrapper.setProps({ attachedIds: new Set<string>() })
        await flushPromises()

        expect(selectedIds.value.has('copy-1')).toBe(false)
      })

    it('does not select a copy the model cannot read, and says why',
      async () => {
        connect()

        const image = copy({ id: 'image-1', type: 'image/png', name: 'a.png' })

        files.value = [image]

        const wrapper = await mountDrive({
          canAttachMediaType: () => false,
        })

        findListView(wrapper).vm.$emit(
          'file-click',
          new MouseEvent('click'),
          image,
          0,
        )

        expect(mocks.handleSelect).not.toHaveBeenCalled()
        expect(mocks.warning).toHaveBeenCalled()
      })

    it('detaches every attached selected copy on Deselect', async () => {
      connect()
      files.value = [copy(), copy({ id: 'copy-2' })]
      selectedIds.value = new Set(['copy-1', 'copy-2'])

      const wrapper = await mountDrive({ attachedIds: new Set(['copy-2']) })

      findToolbar(wrapper).vm.$emit('deselect')

      expect(wrapper.emitted('detach')?.[0]).toEqual([['copy-2']])
      expect(mocks.deselectAll).toHaveBeenCalledOnce()
    })
  })

  describe('remove', () => {
    it('confirms with the Drive original left alone and deletes one copy',
      async () => {
        connect()
        files.value = [copy()]

        const wrapper = await mountDrive()

        findListView(wrapper).vm.$emit('delete', files.value[0])
        await flushPromises()

        expect(mocks.confirm).toHaveBeenCalledWith({
          text: 'Delete "Plan.md" from Besidka? '
            + 'The original in Google Drive is not deleted.',
          alert: true,
          actions: ['Confirm'],
        })
        expect(mocks.deleteFile).toHaveBeenCalledWith('copy-1')
        expect(wrapper.emitted('changed')).toHaveLength(1)
      })

    it('deletes nothing when the confirmation is declined', async () => {
      connect()
      files.value = [copy()]
      mocks.confirm.mockResolvedValue(null)

      const wrapper = await mountDrive()

      findListView(wrapper).vm.$emit('delete', files.value[0])
      await flushPromises()

      expect(mocks.deleteFile).not.toHaveBeenCalled()
      expect(wrapper.emitted('changed')).toBeUndefined()
    })

    it('does not report a change when the delete failed', async () => {
      connect()
      files.value = [copy()]
      mocks.deleteFile.mockResolvedValue(false)

      const wrapper = await mountDrive()

      findListView(wrapper).vm.$emit('delete', files.value[0])
      await flushPromises()

      expect(wrapper.emitted('changed')).toBeUndefined()
    })

    it('confirms and deletes the selection through the bulk route',
      async () => {
        connect()
        files.value = [copy(), copy({ id: 'copy-2' })]
        selectedIds.value = new Set(['copy-1', 'copy-2'])

        const wrapper = await mountDrive()

        findToolbar(wrapper).vm.$emit('delete')
        await flushPromises()

        expect(mocks.confirm).toHaveBeenCalledWith({
          text: 'Delete 2 files from Besidka? '
            + 'The originals in Google Drive are not deleted.',
          alert: true,
          actions: ['Confirm'],
        })
        expect(mocks.deleteSelected).toHaveBeenCalledOnce()
        expect(wrapper.emitted('changed')).toHaveLength(1)
      })

    it('renames a copy and reports the change', async () => {
      connect()
      files.value = [copy()]
      mocks.renameFile.mockResolvedValue(true)

      const wrapper = await mountDrive()
      const renameModal = wrapper.findComponent({ name: 'RenameModalStub' })

      renameModal.vm.$emit('submit', 'copy-1', 'New name.md')
      await flushPromises()

      expect(mocks.renameFile).toHaveBeenCalledWith('copy-1', 'New name.md')
      expect(wrapper.emitted('changed')).toHaveLength(1)
    })
  })

  it('stops the file manager requests when it goes away', async () => {
    connect()

    const wrapper = await mountDrive()

    wrapper.unmount()

    expect(mocks.resetFileManager).toHaveBeenCalledOnce()
  })
})

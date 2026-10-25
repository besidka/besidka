import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { computed, defineComponent, h, shallowRef } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeItem, KnowledgeMode } from '../../../../../shared/types/project-knowledge.d'
import type { KnowledgeModelContext } from '../../../../../app/types/knowledge-ui.d'
import type {
  KnowledgeUploadEntry,
  KnowledgeUploadPhase,
} from '../../../../../app/types/project-knowledge.d'
import Panel from '../../../../../app/components/Projects/Knowledge/Panel.vue'
import {
  createKnowledgeItem,
  createKnowledgeModelContext,
  sumKnowledgeTotals,
} from '../../../../setup/helpers/knowledge-ui-fixtures'

const mocks = vi.hoisted(() => ({
  state: {} as Record<string, any>,
  modelContext: { value: null as unknown },
  storage: {} as Record<string, any>,
  refreshStorage: vi.fn(),
  confirm: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  fetch: vi.fn(),
  hydrate: vi.fn(),
  supportsDirectoryPicker: vi.fn(),
  readDirectoryHandleEntries: vi.fn(),
  saveKnowledgeDirectoryHandle: vi.fn(),
  loadKnowledgeDirectoryHandle: vi.fn(),
}))

mockNuxtImport('useProjectKnowledge', () => () => mocks.state.knowledge)
mockNuxtImport('useKnowledgeUpload', () => () => mocks.state.upload)
mockNuxtImport('useKnowledgeModelContext', () => () => {
  return computed(() => mocks.modelContext.value)
})
mockNuxtImport('useSelectedModelInfo', () => () => ({
  selection: computed(() => mocks.state.selection.value),
}))
mockNuxtImport('useLazyFetch', () => () => ({
  data: mocks.storage.data,
  refresh: mocks.refreshStorage,
}))
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useInfoMessage', () => mocks.info)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('hydrateGatewayCatalog', () => mocks.hydrate)
mockNuxtImport('supportsDirectoryPicker', () => {
  return mocks.supportsDirectoryPicker
})
mockNuxtImport('readDirectoryHandleEntries', () => {
  return mocks.readDirectoryHandleEntries
})
mockNuxtImport('saveKnowledgeDirectoryHandle', () => {
  return mocks.saveKnowledgeDirectoryHandle
})
mockNuxtImport('loadKnowledgeDirectoryHandle', () => {
  return mocks.loadKnowledgeDirectoryHandle
})

enableAutoUnmount(afterEach)

function stubSheet(name: string, testId: string) {
  return defineComponent({
    name,
    props: ['open', 'item'],
    emits: ['update:open', 'select', 'remove', 'readd', 'start', 'cancel'],
    setup(props, { emit }) {
      return () => h('div', {
        'data-testid': testId,
        'data-open': String(props.open),
        'data-item-id': props.item?.id ?? '',
        'onClick': () => emit('update:open', false),
      })
    },
  })
}

const UploadSheetStub = stubSheet('UploadSheet', 'stub-upload-sheet')
const NoteEditorStub = stubSheet('NoteEditor', 'stub-note-editor')
const ItemSheetStub = stubSheet('ItemSheet', 'stub-item-sheet')
const LibraryStub = stubSheet('LibraryPicker', 'stub-library')
const CacheInfoStub = defineComponent({
  name: 'CacheInfoStub',
  props: {
    knowledgeTokens: Number,
    collapsedAfterFirstView: Boolean,
    showMemoryIndex: Boolean,
  },
  setup(props) {
    return () => h('div', {
      'data-testid': 'stub-cache-info',
      'data-tokens': String(props.knowledgeTokens),
      'data-collapsed': String(props.collapsedAfterFirstView),
      'data-memory-index': String(props.showMemoryIndex),
    })
  },
})

const stubs = {
  LazyProjectsKnowledgeUploadSheet: UploadSheetStub,
  ProjectsKnowledgeUploadSheet: UploadSheetStub,
  LazyProjectsKnowledgeNoteEditor: NoteEditorStub,
  ProjectsKnowledgeNoteEditor: NoteEditorStub,
  LazyProjectsKnowledgeItemEditSheet: ItemSheetStub,
  ProjectsKnowledgeItemEditSheet: ItemSheetStub,
  LazyProjectsKnowledgeLibraryPicker: LibraryStub,
  ProjectsKnowledgeLibraryPicker: LibraryStub,
  ProfileMemoryCacheInfo: CacheInfoStub,
}

const readme = createKnowledgeItem({ id: 'readme', title: 'README.md' })
const scan = createKnowledgeItem({
  id: 'scan',
  title: 'scan.pdf',
  fileId: 'file-1',
  mediaType: 'application/pdf',
  extractStatus: 'no-text',
  pageCount: 2,
})
const note = createKnowledgeItem({
  id: 'note',
  kind: 'note',
  title: 'Notes',
  extractor: 'note',
})
const folderItem = createKnowledgeItem({
  id: 'folder-item',
  title: 'a.ts',
  folderId: 'folder-1',
  relativePath: 'src/a.ts',
})

const ok = { ok: true, result: {} }

function setItems(items: KnowledgeItem[]) {
  mocks.state.items.value = items
  mocks.state.totals.value = sumKnowledgeTotals(items)
  mocks.state.summary.value = items.length >= 0 ? { items } : null
}

function createState() {
  mocks.state.selection = shallowRef({
    source: 'provider',
    modelId: 'test-model',
  })
  mocks.state.items = shallowRef<KnowledgeItem[]>([])
  mocks.state.totals = shallowRef(sumKnowledgeTotals([]))
  mocks.state.summary = shallowRef<unknown>({ items: [] })
  mocks.state.mode = shallowRef<KnowledgeMode>('auto')
  mocks.state.pending = shallowRef<boolean>(false)
  mocks.state.error = shallowRef<unknown>(null)
  mocks.state.knowledge = {
    summary: mocks.state.summary,
    items: mocks.state.items,
    totals: mocks.state.totals,
    mode: mocks.state.mode,
    pending: mocks.state.pending,
    error: mocks.state.error,
    refresh: vi.fn().mockResolvedValue(undefined),
    setMode: vi.fn().mockResolvedValue(ok),
    removeItem: vi.fn().mockResolvedValue(ok),
    patchItem: vi.fn().mockResolvedValue(ok),
    createNote: vi.fn().mockResolvedValue(ok),
    updateNote: vi.fn().mockResolvedValue(ok),
    getItemText: vi.fn().mockResolvedValue({ ok: true, result: { text: '' } }),
  }
  mocks.state.upload = {
    phase: shallowRef<KnowledgeUploadPhase>('idle'),
    plan: shallowRef<unknown>(null),
    syncSummary: shallowRef<unknown>(null),
    entries: shallowRef<KnowledgeUploadEntry[]>([]),
    progress: shallowRef({
      done: 0,
      total: 0,
      currentName: null,
      bytesDone: 0,
      bytesTotal: 0,
    }),
    error: shallowRef<unknown>(null),
    wasCancelled: shallowRef<boolean>(false),
    isBusy: shallowRef<boolean>(false),
    prepare: vi.fn().mockResolvedValue(undefined),
    syncFolder: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    retryFailed: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    reset: vi.fn(),
  }
}

async function mountPanel() {
  const wrapper = await mountSuspended(Panel, {
    props: { projectId: 'project-1' },
    global: { stubs },
  })

  await flushPromises()

  return wrapper
}

type Wrapper = Awaited<ReturnType<typeof mountPanel>>

function byTestId(wrapper: Wrapper, id: string) {
  return wrapper.get(`[data-testid="${id}"]`)
}

function missing(wrapper: Wrapper, id: string): boolean {
  return !wrapper.find(`[data-testid="${id}"]`).exists()
}

async function chooseFiles(
  wrapper: Wrapper,
  testId: string,
  files: File[],
) {
  const input = byTestId(wrapper, testId).element as HTMLInputElement

  Object.defineProperty(input, 'files', {
    value: files,
    configurable: true,
  })
  await byTestId(wrapper, testId).trigger('change')
  await flushPromises()
}

describe('Projects/Knowledge/Panel', () => {
  beforeEach(() => {
    window.localStorage.clear()
    createState()
    mocks.modelContext.value = createKnowledgeModelContext({
      acceptsPdf: true,
    }) satisfies KnowledgeModelContext
    mocks.storage.data = shallowRef({ total: 20 * 1024 * 1024 })
    mocks.refreshStorage.mockReset()
    mocks.confirm.mockReset()
    mocks.confirm.mockResolvedValue({ confirmed: true })
    mocks.info.mockReset()
    mocks.error.mockReset()
    mocks.fetch.mockReset()
    mocks.hydrate.mockReset()
    mocks.supportsDirectoryPicker.mockReset()
    mocks.supportsDirectoryPicker.mockReturnValue(false)
    mocks.readDirectoryHandleEntries.mockReset()
    mocks.saveKnowledgeDirectoryHandle.mockReset()
    mocks.saveKnowledgeDirectoryHandle.mockResolvedValue(true)
    mocks.loadKnowledgeDirectoryHandle.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('states', () => {
    it('is a named region with the title and description', async () => {
      const wrapper = await mountPanel()
      const panel = byTestId(wrapper, 'knowledge-panel')
      const heading = panel.get('h2')

      expect(panel.attributes('role')).toBe('region')
      expect(panel.attributes('aria-labelledby'))
        .toBe(heading.attributes('id'))
      expect(heading.text()).toBe('Project knowledge')
      expect(panel.text()).toContain(
        'Files and notes Besidka reads in this project\'s chats.',
      )
      expect(panel.classes()).toEqual(expect.arrayContaining([
        'bg-base-100',
        'shadow-none',
      ]))
    })

    it('shows a skeleton while the summary loads', async () => {
      mocks.state.summary.value = null
      mocks.state.pending.value = true

      const wrapper = await mountPanel()

      expect(byTestId(wrapper, 'knowledge-skeleton').find('.skeleton--default')
        .exists()).toBe(true)
      expect(missing(wrapper, 'knowledge-new-note')).toBe(true)
    })

    it('shows the load error with a retry', async () => {
      mocks.state.summary.value = null
      mocks.state.error.value = Object.assign(new Error('Failed'), {
        data: {
          statusCode: 500,
          message: 'Knowledge unavailable',
          data: { why: 'Database is down' },
        },
      })

      const wrapper = await mountPanel()
      const alert = byTestId(wrapper, 'knowledge-error')

      expect(alert.attributes('role')).toBe('alert')
      expect(alert.text()).toContain('Knowledge unavailable')
      expect(alert.text()).toContain('Database is down')

      await byTestId(wrapper, 'knowledge-retry').trigger('click')

      expect(mocks.state.knowledge.refresh).toHaveBeenCalledOnce()
    })

    it('keeps showing the items when a background refresh fails', async () => {
      setItems([readme])
      mocks.state.error.value = new Error('refresh failed')

      const wrapper = await mountPanel()

      expect(missing(wrapper, 'knowledge-error')).toBe(true)
      expect(byTestId(wrapper, 'knowledge-items').exists()).toBe(true)
    })

    it('shows the empty state with the actions and no meter', async () => {
      const wrapper = await mountPanel()

      expect(byTestId(wrapper, 'knowledge-empty').text())
        .toBe('No knowledge yet. Add files, a folder or a note.')
      expect(missing(wrapper, 'knowledge-meter')).toBe(true)
      expect(missing(wrapper, 'knowledge-mode')).toBe(true)
      expect(missing(wrapper, 'stub-cache-info')).toBe(true)
      expect(byTestId(wrapper, 'knowledge-new-note').exists()).toBe(true)
    })
  })

  describe('with items', () => {
    beforeEach(() => {
      setItems([readme, scan, note])
    })

    it('renders the meter, mode selector, cache alert and list', async () => {
      const wrapper = await mountPanel()

      expect(byTestId(wrapper, 'knowledge-meter-headline').text())
        .toContain('Project knowledge ·')
      expect(byTestId(wrapper, 'knowledge-mode').exists()).toBe(true)
      expect(byTestId(wrapper, 'stub-cache-info').exists()).toBe(true)
      expect(wrapper.findAll('[data-testid="knowledge-item"]'))
        .toHaveLength(3)
    })

    it('feeds the meter the project totals and the storage total',
      async () => {
        const wrapper = await mountPanel()

        expect(byTestId(wrapper, 'knowledge-meter-cap').text())
          .toContain('3 of 500 items')
        expect(byTestId(wrapper, 'knowledge-meter-storage').text())
          .toContain('of your 20 MB storage')
      })

    it('shows the item tokens for the current model after mount', async () => {
      const wrapper = await mountPanel()

      expect(missing(wrapper, 'knowledge-meter-skeleton')).toBe(true)
      expect(wrapper.find('[data-testid="knowledge-item-tokens"]').exists())
        .toBe(true)
    })

    it('passes the real knowledge tokens to the cache alert in full mode',
      async () => {
        const wrapper = await mountPanel()
        const cacheInfo = byTestId(wrapper, 'stub-cache-info')

        expect(Number(cacheInfo.attributes('data-tokens'))).toBeGreaterThan(0)
        expect(cacheInfo.attributes('data-collapsed')).toBe('true')
        expect(cacheInfo.attributes('data-memory-index')).toBe('false')
      })

    it('keeps the example numbers when knowledge is searched, not sent',
      async () => {
        mocks.state.mode.value = 'search'

        const wrapper = await mountPanel()

        expect(byTestId(wrapper, 'stub-cache-info')
          .attributes('data-tokens')).toBe('undefined')
      })

    it('writes the chosen mode through setMode', async () => {
      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-mode-search').setValue(true)
      await flushPromises()

      expect(mocks.state.knowledge.setMode).toHaveBeenCalledWith('search')
      expect(mocks.error).not.toHaveBeenCalled()
    })

    it('reports a failed mode change', async () => {
      mocks.state.knowledge.setMode.mockResolvedValue({
        ok: false,
        parsed: { message: 'Could not save the mode', why: 'Offline' },
      })

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-mode-full').setValue(true)
      await flushPromises()

      expect(mocks.error)
        .toHaveBeenCalledWith('Could not save the mode', 'Offline')
    })
  })

  describe('actions', () => {
    it('picks files with an allow-listed accept hint', async () => {
      const wrapper = await mountPanel()
      const input = byTestId(wrapper, 'knowledge-file-input')

      expect(input.attributes('type')).toBe('file')
      expect(input.attributes('multiple')).toBeDefined()
      expect(input.attributes('accept')).toContain('.md')
      expect(input.attributes('accept')).toContain('.pdf')
      expect(input.attributes('accept')).toContain('.png')
      expect(input.attributes('aria-hidden')).toBe('true')
      expect(input.attributes('tabindex')).toBe('-1')
    })

    it('prepares the chosen files and opens the upload sheet', async () => {
      const wrapper = await mountPanel()
      const file = new File(['hello'], 'hello.md')

      await chooseFiles(wrapper, 'knowledge-file-input', [file])

      expect(mocks.state.upload.prepare).toHaveBeenCalledWith(
        [{ file, relativePath: null }],
        {},
      )
      expect(byTestId(wrapper, 'stub-upload-sheet').attributes('data-open'))
        .toBe('true')
    })

    it('ignores an empty file selection', async () => {
      const wrapper = await mountPanel()

      await chooseFiles(wrapper, 'knowledge-file-input', [])

      expect(mocks.state.upload.prepare).not.toHaveBeenCalled()
    })

    it('offers a folder input with webkitdirectory', async () => {
      const wrapper = await mountPanel()
      const input = byTestId(wrapper, 'knowledge-folder-input')

      expect(input.attributes('webkitdirectory')).toBeDefined()
      expect(input.attributes('multiple')).toBeDefined()
    })

    it('prepares a picked folder with an id, .gitignore and its name',
      async () => {
        const wrapper = await mountPanel()
        const sourceFile = new File(['const a = 1'], 'a.ts')
        const gitignore = new File(['dist/\n'], '.gitignore')

        Object.defineProperty(sourceFile, 'webkitRelativePath', {
          value: 'my-app/src/a.ts',
        })
        Object.defineProperty(gitignore, 'webkitRelativePath', {
          value: 'my-app/.gitignore',
        })

        await chooseFiles(wrapper, 'knowledge-folder-input', [
          sourceFile,
          gitignore,
        ])

        const [sources, options] = mocks.state.upload.prepare.mock.calls[0]!

        expect(sources.map((source: { relativePath: string }) => {
          return source.relativePath
        })).toEqual(['src/a.ts', '.gitignore'])
        expect(options.folderId).toMatch(/^[a-f0-9]{32}$/)
        expect(options.gitignoreText).toBe('dist/\n')

        const stored = JSON.parse(
          window.localStorage.getItem('knowledge-folders:project-1')!,
        )

        expect(stored.names[options.folderId]).toBe('my-app')
      })

    it('collapses folder actions into a More menu', async () => {
      const wrapper = await mountPanel()
      const more = byTestId(wrapper, 'knowledge-more-trigger')

      expect(more.element.tagName).toBe('SUMMARY')
      expect(more.attributes('aria-expanded')).toBe('false')
      expect(byTestId(wrapper, 'knowledge-add-folder-menu').exists())
        .toBe(true)
    })

    it('opens the library picker', async () => {
      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-from-library').trigger('click')

      expect(byTestId(wrapper, 'stub-library').attributes('data-open'))
        .toBe('true')
    })

    it('downloads library files and links them by file id', async () => {
      mocks.fetch.mockResolvedValue(new Blob(['%PDF']))

      const wrapper = await mountPanel()

      wrapper.getComponent(LibraryStub).vm.$emit('select', [{
        id: 'file-9',
        storageKey: 'key 9',
        name: 'spec.pdf',
        size: 4,
        type: 'application/pdf',
      }])
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith('/files/key%209', {
        responseType: 'blob',
      })

      const [sources] = mocks.state.upload.prepare.mock.calls[0]!

      expect(sources).toHaveLength(1)
      expect(sources[0].fileId).toBe('file-9')
      expect(sources[0].file.name).toBe('spec.pdf')
      expect(sources[0].file.type).toBe('application/pdf')
    })

    it('reports a library file that cannot be downloaded', async () => {
      mocks.fetch.mockRejectedValue(new Error('gone'))

      const wrapper = await mountPanel()

      wrapper.getComponent(LibraryStub).vm.$emit('select', [{
        id: 'file-9',
        storageKey: 'key-9',
        name: 'spec.pdf',
        size: 4,
        type: 'application/pdf',
      }])
      await flushPromises()

      expect(mocks.error).toHaveBeenCalled()
      expect(mocks.state.upload.prepare).not.toHaveBeenCalled()
    })

    it('opens the note editor for a new note', async () => {
      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-new-note').trigger('click')

      expect(byTestId(wrapper, 'stub-note-editor').attributes('data-open'))
        .toBe('true')
      expect(byTestId(wrapper, 'stub-note-editor')
        .attributes('data-item-id')).toBe('')
    })

    it('disables adding while an upload is busy', async () => {
      mocks.state.upload.isBusy.value = true

      const wrapper = await mountPanel()

      expect(byTestId(wrapper, 'knowledge-upload-files')
        .attributes('disabled')).toBeDefined()
      expect(byTestId(wrapper, 'knowledge-add-folder')
        .attributes('disabled')).toBeDefined()
    })
  })

  describe('folder sync', () => {
    it('hides the sync action without the directory picker', async () => {
      const wrapper = await mountPanel()

      expect(missing(wrapper, 'knowledge-sync-folder')).toBe(true)
      expect(missing(wrapper, 'knowledge-sync-folder-menu')).toBe(true)
    })

    it('offers it on Chromium and saves the directory handle', async () => {
      mocks.supportsDirectoryPicker.mockReturnValue(true)

      const handle = { name: 'my-app' }

      vi.stubGlobal('showDirectoryPicker', vi.fn().mockResolvedValue(handle))
      Object.defineProperty(window, 'showDirectoryPicker', {
        value: vi.fn().mockResolvedValue(handle),
        configurable: true,
      })
      mocks.readDirectoryHandleEntries.mockResolvedValue({
        rootName: 'my-app',
        entries: [{ file: new File(['x'], 'a.ts'), relativePath: 'a.ts' }],
        gitignoreText: 'dist/',
      })

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-sync-folder').trigger('click')
      await flushPromises()

      expect(mocks.saveKnowledgeDirectoryHandle)
        .toHaveBeenCalledWith('project-1', handle)

      const [, options] = mocks.state.upload.prepare.mock.calls[0]!
      const stored = JSON.parse(
        window.localStorage.getItem('knowledge-folders:project-1')!,
      )

      expect(options.gitignoreText).toBe('dist/')
      expect(stored.syncedFolderId).toBe(options.folderId)
      expect(stored.names[options.folderId]).toBe('my-app')

      Reflect.deleteProperty(window, 'showDirectoryPicker')
    })

    it('syncs a linked folder from its saved handle', async () => {
      mocks.supportsDirectoryPicker.mockReturnValue(true)
      window.localStorage.setItem('knowledge-folders:project-1', JSON.stringify({
        names: { 'folder-1': 'my-app' },
        syncedFolderId: 'folder-1',
      }))
      setItems([folderItem, readme])

      const incoming = [{ file: new File(['x'], 'a.ts'), relativePath: 'a.ts' }]

      mocks.loadKnowledgeDirectoryHandle.mockResolvedValue({ name: 'my-app' })
      mocks.readDirectoryHandleEntries.mockResolvedValue({
        rootName: 'my-app',
        entries: incoming,
        gitignoreText: '',
      })

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-group-sync').trigger('click')
      await flushPromises()

      expect(mocks.state.upload.syncFolder).toHaveBeenCalledWith({
        folderId: 'folder-1',
        incoming,
        existing: [{
          id: 'folder-item',
          relativePath: 'src/a.ts',
          contentHash: '',
        }],
        gitignoreText: '',
      })
      expect(byTestId(wrapper, 'stub-upload-sheet').attributes('data-open'))
        .toBe('true')
    })

    it('asks to choose the folder again when access is gone', async () => {
      mocks.supportsDirectoryPicker.mockReturnValue(true)
      window.localStorage.setItem('knowledge-folders:project-1', JSON.stringify({
        names: { 'folder-1': 'my-app' },
        syncedFolderId: 'folder-1',
      }))
      setItems([folderItem])
      mocks.loadKnowledgeDirectoryHandle.mockResolvedValue(null)

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-group-sync').trigger('click')
      await flushPromises()

      expect(mocks.info).toHaveBeenCalledWith(
        'Choose the folder again',
        expect.stringContaining('Sync with a folder'),
      )
      expect(mocks.state.upload.syncFolder).not.toHaveBeenCalled()
      expect(missing(wrapper, 'knowledge-group-sync')).toBe(true)
    })
  })

  describe('editing and removing', () => {
    beforeEach(() => {
      setItems([readme, note])
    })

    it('opens the item sheet for a file', async () => {
      const wrapper = await mountPanel()
      const row = wrapper.findAll('[data-testid="knowledge-item"]')
        .find(item => item.text().includes('README.md'))!

      await row.get('[data-testid="knowledge-item-edit"]').trigger('click')

      expect(byTestId(wrapper, 'stub-item-sheet').attributes('data-open'))
        .toBe('true')
      expect(byTestId(wrapper, 'stub-item-sheet')
        .attributes('data-item-id')).toBe('readme')
      expect(byTestId(wrapper, 'stub-note-editor').attributes('data-open'))
        .toBe('false')
    })

    it('opens the note editor for a note', async () => {
      const wrapper = await mountPanel()
      const row = wrapper.findAll('[data-testid="knowledge-item"]')
        .find(item => item.text().includes('Notes'))!

      await row.get('[data-testid="knowledge-item-edit"]').trigger('click')

      expect(byTestId(wrapper, 'stub-note-editor').attributes('data-open'))
        .toBe('true')
      expect(byTestId(wrapper, 'stub-note-editor')
        .attributes('data-item-id')).toBe('note')
    })

    it('confirms before removing, then removes and toasts', async () => {
      const wrapper = await mountPanel()
      const row = wrapper.findAll('[data-testid="knowledge-item"]')
        .find(item => item.text().includes('README.md'))!

      await row.get('[data-testid="knowledge-item-remove"]').trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Remove "README.md"?',
        alert: true,
        actions: ['Remove'],
      }))
      expect(mocks.state.knowledge.removeItem).toHaveBeenCalledWith('readme')
      expect(mocks.info).toHaveBeenCalledWith('Removed', expect.any(String))
      expect(mocks.refreshStorage).toHaveBeenCalled()
    })

    it('does nothing when the removal is declined', async () => {
      mocks.confirm.mockResolvedValue(null)

      const wrapper = await mountPanel()

      await wrapper.get('[data-testid="knowledge-item-remove"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()
    })

    it('reports a failed removal', async () => {
      mocks.state.knowledge.removeItem.mockResolvedValue({
        ok: false,
        parsed: { message: 'Could not remove', why: 'Locked' },
      })

      const wrapper = await mountPanel()

      await wrapper.get('[data-testid="knowledge-item-remove"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.error).toHaveBeenCalledWith('Could not remove', 'Locked')
      expect(mocks.info).not.toHaveBeenCalled()
    })

    it('removes a failed file and reopens the picker to add it again',
      async () => {
        const failed = createKnowledgeItem({
          id: 'failed',
          title: 'broken.docx',
          extractStatus: 'failed',
          extractError: 'too-large',
        })

        setItems([failed])

        const wrapper = await mountPanel()
        const click = vi.spyOn(HTMLInputElement.prototype, 'click')
          .mockImplementation(() => undefined)

        wrapper.getComponent(ItemSheetStub).vm.$emit('readd', failed)
        await flushPromises()

        expect(click).toHaveBeenCalled()
        expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()

        await chooseFiles(wrapper, 'knowledge-file-input', [
          new File(['x'], 'broken.docx'),
        ])

        expect(mocks.state.knowledge.removeItem).toHaveBeenCalledWith('failed')
        expect(mocks.state.upload.prepare).toHaveBeenCalled()
      })
  })

  describe('upload lifecycle', () => {
    beforeEach(() => {
      setItems([readme])
    })

    it('shows ghost rows and a banner while running in the background',
      async () => {
        mocks.state.upload.phase.value = 'running'
        mocks.state.upload.entries.value = [{
          key: 'entry-0',
          name: 'big.pdf',
          relativePath: null,
          category: 'document',
          sizeBytes: 10,
          status: 'extracting',
          error: null,
        }]
        mocks.state.upload.progress.value = {
          done: 2,
          total: 5,
          currentName: 'big.pdf',
          bytesDone: 0,
          bytesTotal: 10,
        }

        const wrapper = await mountPanel()

        expect(byTestId(wrapper, 'knowledge-item-preparing').text())
          .toContain('big.pdf')
        expect(byTestId(wrapper, 'knowledge-upload-banner').text())
          .toContain('Adding files: 2 of 5')

        await byTestId(wrapper, 'knowledge-upload-show').trigger('click')

        expect(byTestId(wrapper, 'stub-upload-sheet').attributes('data-open'))
          .toBe('true')
      })

    it('refreshes and toasts when a hidden upload finishes', async () => {
      mocks.state.upload.phase.value = 'running'

      const wrapper = await mountPanel()

      mocks.state.upload.entries.value = [
        { key: 'a', status: 'ready' },
        { key: 'b', status: 'failed' },
      ] as KnowledgeUploadEntry[]
      mocks.state.upload.phase.value = 'done'
      await flushPromises()

      expect(mocks.state.knowledge.refresh).toHaveBeenCalled()
      expect(mocks.refreshStorage).toHaveBeenCalled()
      expect(mocks.info).toHaveBeenCalledWith(
        'Knowledge updated',
        '1 file added, 1 failed.',
      )
      expect(mocks.state.upload.reset).toHaveBeenCalled()
      expect(missing(wrapper, 'knowledge-upload-banner')).toBe(true)
    })

    it('reports a hidden upload that stopped with an error', async () => {
      mocks.state.upload.phase.value = 'running'

      await mountPanel()

      mocks.state.upload.error.value = {
        message: 'Not enough storage space for this upload.',
        why: 'Over quota',
        status: 413,
      }
      mocks.state.upload.phase.value = 'error'
      await flushPromises()

      expect(mocks.error).toHaveBeenCalledWith(
        'Not enough storage space for this upload.',
        'Over quota',
      )
    })

    it('keeps the summary for the sheet when it is still open', async () => {
      const wrapper = await mountPanel()

      await chooseFiles(wrapper, 'knowledge-file-input', [
        new File(['x'], 'a.md'),
      ])

      mocks.state.upload.phase.value = 'running'
      await flushPromises()
      mocks.state.upload.phase.value = 'done'
      await flushPromises()

      expect(mocks.info).not.toHaveBeenCalled()
      expect(mocks.state.upload.reset).not.toHaveBeenCalled()
    })

    it('cancels a running upload, resets a preview', async () => {
      const wrapper = await mountPanel()
      const sheet = wrapper.getComponent(UploadSheetStub)

      mocks.state.upload.phase.value = 'running'
      sheet.vm.$emit('cancel')
      await flushPromises()

      expect(mocks.state.upload.cancel).toHaveBeenCalledOnce()

      mocks.state.upload.phase.value = 'preview'
      sheet.vm.$emit('cancel')
      await flushPromises()

      expect(mocks.state.upload.reset).toHaveBeenCalled()
    })
  })

  describe('gateway catalog', () => {
    it('hydrates the catalog for a restored gateway selection', async () => {
      mocks.state.selection.value = {
        source: 'gateway',
        gatewayId: 'openrouter',
        modelId: 'vendor/model',
      }

      await mountPanel()

      expect(mocks.hydrate).toHaveBeenCalledWith('openrouter')
    })

    it('does nothing for a direct provider model', async () => {
      await mountPanel()

      expect(mocks.hydrate).not.toHaveBeenCalled()
    })
  })
})

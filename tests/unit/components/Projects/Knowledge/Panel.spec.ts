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
  removeKnowledgeDirectoryHandle: vi.fn(),
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
mockNuxtImport('removeKnowledgeDirectoryHandle', () => {
  return mocks.removeKnowledgeDirectoryHandle
})

enableAutoUnmount(afterEach)

function stubSheet(name: string, testId: string) {
  return defineComponent({
    name,
    props: [
      'open',
      'item',
      'canRetryCommit',
      'cleanupFailures',
      'linkedFileIds',
    ],
    emits: [
      'update:open',
      'select',
      'remove',
      'readd',
      'start',
      'cancel',
      'retry',
      'retry-commit',
    ],
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
    storageKey: String,
    collapsedAfterFirstView: Boolean,
    showMemoryIndex: Boolean,
  },
  setup(props) {
    return () => h('div', {
      'data-testid': 'stub-cache-info',
      'data-tokens': String(props.knowledgeTokens),
      'data-storage-key': props.storageKey,
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
  mocks.state.accountItems = shallowRef<number>(0)
  mocks.state.summary = shallowRef<unknown>({ items: [] })
  mocks.state.mode = shallowRef<KnowledgeMode>('auto')
  mocks.state.pending = shallowRef<boolean>(false)
  mocks.state.error = shallowRef<unknown>(null)
  mocks.state.knowledge = {
    summary: mocks.state.summary,
    items: mocks.state.items,
    totals: mocks.state.totals,
    accountItems: mocks.state.accountItems,
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
    syncResult: shallowRef<unknown>(null),
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
    canRetryCommit: shallowRef<boolean>(false),
    cleanupFailures: shallowRef<number>(0),
    retryCommit: vi.fn().mockResolvedValue(undefined),
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

function uploadEntry(
  status: KnowledgeUploadEntry['status'],
): KnowledgeUploadEntry {
  return { key: `entry-${status}`, status } as KnowledgeUploadEntry
}

async function finishRun(
  phase: 'done' | 'error',
  statuses: Array<KnowledgeUploadEntry['status']> = [],
  wasCancelled = false,
) {
  mocks.state.upload.phase.value = 'running'
  await flushPromises()
  mocks.state.upload.entries.value = statuses.map(uploadEntry)
  mocks.state.upload.wasCancelled.value = wasCancelled
  mocks.state.upload.phase.value = phase
  await flushPromises()
}

async function discardRun() {
  mocks.state.upload.phase.value = 'idle'
  await flushPromises()
}

function pickerHandle(name = 'my-app') {
  const handle = { name }

  Object.defineProperty(window, 'showDirectoryPicker', {
    value: vi.fn().mockResolvedValue(handle),
    configurable: true,
  })
  mocks.supportsDirectoryPicker.mockReturnValue(true)

  return handle
}

function directoryRead(
  overrides: Record<string, unknown> = {},
) {
  return {
    rootName: 'my-app',
    entries: [{ file: new File(['x'], 'a.ts'), relativePath: 'a.ts' }],
    gitignoreText: '',
    truncated: false,
    ...overrides,
  }
}

function storedFolderMemory() {
  return JSON.parse(
    window.localStorage.getItem('knowledge-folders:project-1') ?? 'null',
  )
}

function rememberSyncedFolder(folderId: string, name: string) {
  window.localStorage.setItem('knowledge-folders:project-1', JSON.stringify({
    names: { [folderId]: name },
    syncedFolderId: folderId,
  }))
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
    mocks.removeKnowledgeDirectoryHandle.mockReset()
    mocks.removeKnowledgeDirectoryHandle.mockResolvedValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(window, 'showDirectoryPicker')
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

    it('feeds the meter the account item count', async () => {
      mocks.state.accountItems.value = 1_850

      const wrapper = await mountPanel()

      expect(byTestId(wrapper, 'knowledge-meter-account-warning').text())
        .toContain('1,850 of 2,000')
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
        expect(cacheInfo.attributes('data-storage-key')).toBe('project-1')
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

    it('tells the library picker which files are already linked', async () => {
      setItems([scan, readme])

      const wrapper = await mountPanel()

      expect(wrapper.getComponent(LibraryStub).props('linkedFileIds'))
        .toEqual(['file-1'])
    })

    it('skips linked and repeated library files before downloading', async () => {
      setItems([scan])
      mocks.fetch.mockResolvedValue(new Blob(['%PDF']))

      const wrapper = await mountPanel()
      const linked = {
        id: 'file-1',
        storageKey: 'key-1',
        name: 'scan.pdf',
        size: 4,
        type: 'application/pdf',
      }
      const fresh = {
        id: 'file-2',
        storageKey: 'key-2',
        name: 'fresh.pdf',
        size: 4,
        type: 'application/pdf',
      }

      wrapper.getComponent(LibraryStub).vm.$emit('select', [
        linked,
        fresh,
        { ...fresh },
      ])
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(mocks.fetch).toHaveBeenCalledWith('/files/key-2', {
        responseType: 'blob',
      })

      const [sources] = mocks.state.upload.prepare.mock.calls[0]!

      expect(sources.map((source: any) => source.fileId)).toEqual(['file-2'])
      expect(mocks.info).toHaveBeenCalledWith(
        'Already in this project',
        '2 selected files were already added, so they were skipped.',
      )
    })

    it('does nothing when every selected library file is linked', async () => {
      setItems([scan])

      const wrapper = await mountPanel()

      wrapper.getComponent(LibraryStub).vm.$emit('select', [{
        id: 'file-1',
        storageKey: 'key-1',
        name: 'scan.pdf',
        size: 4,
        type: 'application/pdf',
      }])
      await flushPromises()

      expect(mocks.fetch).not.toHaveBeenCalled()
      expect(mocks.state.upload.prepare).not.toHaveBeenCalled()
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

    it('reads the folder but saves nothing before the upload succeeds', async () => {
      const handle = pickerHandle()

      mocks.readDirectoryHandleEntries.mockResolvedValue(directoryRead({
        gitignoreText: 'dist/',
      }))

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-sync-folder').trigger('click')
      await flushPromises()

      const [, options] = mocks.state.upload.prepare.mock.calls[0]!

      expect(options.gitignoreText).toBe('dist/')
      expect(mocks.saveKnowledgeDirectoryHandle).not.toHaveBeenCalled()
      expect(storedFolderMemory()).toBeNull()

      await finishRun('done', ['ready'])

      expect(mocks.saveKnowledgeDirectoryHandle)
        .toHaveBeenCalledWith('project-1', handle)
      expect(storedFolderMemory().syncedFolderId).toBe(options.folderId)
      expect(storedFolderMemory().names[options.folderId]).toBe('my-app')
    })

    it('keeps the previous sync when the preview is cancelled', async () => {
      rememberSyncedFolder('folder-1', 'old-app')
      setItems([folderItem])
      pickerHandle('other-app')
      mocks.readDirectoryHandleEntries.mockResolvedValue(directoryRead({
        rootName: 'other-app',
      }))

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-sync-folder').trigger('click')
      await flushPromises()

      mocks.state.upload.phase.value = 'preview'
      await flushPromises()
      wrapper.getComponent(UploadSheetStub).vm.$emit('cancel')
      await discardRun()
      await finishRun('done', ['ready'])

      expect(mocks.saveKnowledgeDirectoryHandle).not.toHaveBeenCalled()
      expect(storedFolderMemory()).toEqual({
        names: { 'folder-1': 'old-app' },
        syncedFolderId: 'folder-1',
      })
    })

    it('keeps the previous sync when the upload is cancelled', async () => {
      rememberSyncedFolder('folder-1', 'old-app')
      pickerHandle('other-app')
      mocks.readDirectoryHandleEntries.mockResolvedValue(directoryRead({
        rootName: 'other-app',
      }))

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-sync-folder').trigger('click')
      await flushPromises()
      await finishRun('done', ['ready'], true)

      expect(mocks.saveKnowledgeDirectoryHandle).not.toHaveBeenCalled()
      expect(storedFolderMemory().syncedFolderId).toBe('folder-1')
    })

    it('keeps the previous sync when the upload fails', async () => {
      rememberSyncedFolder('folder-1', 'old-app')
      pickerHandle('other-app')
      mocks.readDirectoryHandleEntries.mockResolvedValue(directoryRead({
        rootName: 'other-app',
      }))

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-sync-folder').trigger('click')
      await flushPromises()
      await finishRun('error', ['failed'])
      await discardRun()
      await finishRun('done', ['ready'])

      expect(mocks.saveKnowledgeDirectoryHandle).not.toHaveBeenCalled()
      expect(storedFolderMemory().syncedFolderId).toBe('folder-1')
    })

    it('saves a retried sync once it finally succeeds', async () => {
      const handle = pickerHandle()

      mocks.readDirectoryHandleEntries.mockResolvedValue(directoryRead())

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-sync-folder').trigger('click')
      await flushPromises()
      await finishRun('error', ['failed'])

      expect(mocks.saveKnowledgeDirectoryHandle).not.toHaveBeenCalled()

      await finishRun('done', ['ready'])

      expect(mocks.saveKnowledgeDirectoryHandle)
        .toHaveBeenCalledWith('project-1', handle)
    })

    it('does not save a new folder when nothing was added', async () => {
      pickerHandle()
      mocks.readDirectoryHandleEntries.mockResolvedValue(directoryRead())

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-sync-folder').trigger('click')
      await flushPromises()
      await finishRun('done', ['failed'])

      expect(mocks.saveKnowledgeDirectoryHandle).not.toHaveBeenCalled()
      expect(storedFolderMemory()).toBeNull()
    })

    it('reuses the folder group when the same folder is picked again', async () => {
      rememberSyncedFolder('folder-1', 'my-app')
      setItems([folderItem, readme])

      const handle = pickerHandle('my-app')
      const entries = [
        { file: new File(['x'], 'a.ts'), relativePath: 'src/a.ts' },
        { file: new File(['x'], 'huge.bin'), relativePath: 'huge.bin' },
        { file: new File(['x'], 'ignored.log'), relativePath: null },
      ]

      mocks.readDirectoryHandleEntries.mockResolvedValue(directoryRead({
        entries,
        gitignoreText: 'dist/',
        truncated: true,
      }))

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-sync-folder').trigger('click')
      await flushPromises()

      expect(mocks.state.upload.prepare).not.toHaveBeenCalled()
      expect(mocks.state.upload.syncFolder).toHaveBeenCalledWith({
        folderId: 'folder-1',
        incoming: entries,
        existing: [{
          id: 'folder-item',
          relativePath: 'src/a.ts',
          contentHash: '',
          folderId: 'folder-1',
        }],
        walkedPaths: ['src/a.ts', 'huge.bin'],
        truncated: true,
        gitignoreText: 'dist/',
      })
      expect(byTestId(wrapper, 'stub-upload-sheet').attributes('data-open'))
        .toBe('true')
      expect(mocks.saveKnowledgeDirectoryHandle).not.toHaveBeenCalled()

      await finishRun('done')

      expect(mocks.saveKnowledgeDirectoryHandle)
        .toHaveBeenCalledWith('project-1', handle)
      expect(storedFolderMemory()).toEqual({
        names: { 'folder-1': 'my-app' },
        syncedFolderId: 'folder-1',
      })
    })

    it('does not reuse a folder name that has no items any more', async () => {
      rememberSyncedFolder('folder-1', 'my-app')
      setItems([readme])
      pickerHandle('my-app')
      mocks.readDirectoryHandleEntries.mockResolvedValue(directoryRead())

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-sync-folder').trigger('click')
      await flushPromises()

      expect(mocks.state.upload.syncFolder).not.toHaveBeenCalled()
      expect(mocks.state.upload.prepare).toHaveBeenCalled()
    })

    it('syncs a linked folder from its saved handle', async () => {
      mocks.supportsDirectoryPicker.mockReturnValue(true)
      rememberSyncedFolder('folder-1', 'my-app')
      setItems([folderItem, readme])

      const incoming = [{ file: new File(['x'], 'a.ts'), relativePath: 'a.ts' }]

      mocks.loadKnowledgeDirectoryHandle.mockResolvedValue({ name: 'my-app' })
      mocks.readDirectoryHandleEntries.mockResolvedValue(directoryRead({
        entries: incoming,
      }))

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
          folderId: 'folder-1',
        }],
        walkedPaths: ['a.ts'],
        truncated: false,
        gitignoreText: '',
      })
      expect(byTestId(wrapper, 'stub-upload-sheet').attributes('data-open'))
        .toBe('true')
    })

    it('asks to choose the folder again when access is gone', async () => {
      mocks.supportsDirectoryPicker.mockReturnValue(true)
      rememberSyncedFolder('folder-1', 'my-app')
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
      expect(mocks.removeKnowledgeDirectoryHandle)
        .toHaveBeenCalledWith('project-1')
      expect(missing(wrapper, 'knowledge-group-sync')).toBe(true)
    })

    it.each([
      'NotFoundError',
      'NotAllowedError',
      'SecurityError',
    ])('forgets the sync when the folder fails with %s', async (name) => {
      mocks.supportsDirectoryPicker.mockReturnValue(true)
      rememberSyncedFolder('folder-1', 'my-app')
      setItems([folderItem])
      mocks.loadKnowledgeDirectoryHandle.mockResolvedValue({ name: 'my-app' })
      mocks.readDirectoryHandleEntries.mockRejectedValue(
        new DOMException('Gone', name),
      )

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-group-sync').trigger('click')
      await flushPromises()

      expect(mocks.removeKnowledgeDirectoryHandle)
        .toHaveBeenCalledWith('project-1')
      expect(storedFolderMemory().syncedFolderId).toBeNull()
      expect(mocks.info).toHaveBeenCalledWith(
        'Choose the folder again',
        expect.stringContaining('moved or been deleted'),
      )
      expect(mocks.error).not.toHaveBeenCalled()
      expect(missing(wrapper, 'knowledge-group-sync')).toBe(true)
    })

    it('keeps the sync and reports an unexpected folder error', async () => {
      mocks.supportsDirectoryPicker.mockReturnValue(true)
      rememberSyncedFolder('folder-1', 'my-app')
      setItems([folderItem])
      mocks.loadKnowledgeDirectoryHandle.mockResolvedValue({ name: 'my-app' })
      mocks.readDirectoryHandleEntries.mockRejectedValue(new Error('Boom'))

      const wrapper = await mountPanel()

      await byTestId(wrapper, 'knowledge-group-sync').trigger('click')
      await flushPromises()

      expect(mocks.error).toHaveBeenCalled()
      expect(mocks.removeKnowledgeDirectoryHandle).not.toHaveBeenCalled()
      expect(storedFolderMemory().syncedFolderId).toBe('folder-1')
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

    describe('replacing a file', () => {
      const failed = createKnowledgeItem({
        id: 'failed',
        title: 'broken.docx',
        extractStatus: 'failed',
        extractError: 'too-large',
      })

      async function startReplacement() {
        setItems([failed])

        const wrapper = await mountPanel()

        vi.spyOn(HTMLInputElement.prototype, 'click')
          .mockImplementation(() => undefined)
        wrapper.getComponent(ItemSheetStub).vm.$emit('readd', failed)
        await flushPromises()
        await chooseFiles(wrapper, 'knowledge-file-input', [
          new File(['x'], 'broken.docx'),
        ])

        return wrapper
      }

      it('reopens the picker and keeps the old file until the new one exists',
        async () => {
          await startReplacement()

          expect(HTMLInputElement.prototype.click).toHaveBeenCalled()
          expect(mocks.state.upload.prepare).toHaveBeenCalled()
          expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()

          await finishRun('done', ['ready'])

          expect(mocks.state.knowledge.removeItem)
            .toHaveBeenCalledOnce()
          expect(mocks.state.knowledge.removeItem)
            .toHaveBeenCalledWith('failed')
        })

      it('removes the old file when the new one has no text', async () => {
        await startReplacement()
        await finishRun('done', ['no-text'])

        expect(mocks.state.knowledge.removeItem).toHaveBeenCalledWith('failed')
      })

      it('keeps the old file when the preview is cancelled', async () => {
        const wrapper = await startReplacement()

        mocks.state.upload.phase.value = 'preview'
        await flushPromises()
        wrapper.getComponent(UploadSheetStub).vm.$emit('cancel')
        await discardRun()
        await finishRun('done', ['ready'])

        expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()
      })

      it('keeps the old file when the plan skipped the new one', async () => {
        await startReplacement()

        mocks.state.upload.phase.value = 'preview'
        await flushPromises()
        await discardRun()

        expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()
      })

      it('keeps the old file when the upload fails', async () => {
        await startReplacement()
        await finishRun('error', ['failed'])

        expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()

        await discardRun()
        await finishRun('done', ['ready'])

        expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()
      })

      it('removes the old file when a retry creates the new one', async () => {
        await startReplacement()
        await finishRun('error', ['failed'])
        await finishRun('done', ['ready'])

        expect(mocks.state.knowledge.removeItem).toHaveBeenCalledWith('failed')
      })

      it('keeps the old file when the new one was already added', async () => {
        await startReplacement()
        await finishRun('done', ['skipped-duplicate'])

        expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()
        expect(mocks.info).toHaveBeenCalledWith(
          'Already added',
          expect.stringContaining('previous one was kept'),
        )
      })

      it('keeps the old file when the upload was cancelled early', async () => {
        await startReplacement()
        await finishRun('done', [], true)

        expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()
      })

      it('does not start while another upload is busy', async () => {
        setItems([failed])
        mocks.state.upload.isBusy.value = true

        const wrapper = await mountPanel()

        vi.spyOn(HTMLInputElement.prototype, 'click')
          .mockImplementation(() => undefined)
        wrapper.getComponent(ItemSheetStub).vm.$emit('readd', failed)
        await flushPromises()
        await chooseFiles(wrapper, 'knowledge-file-input', [
          new File(['x'], 'broken.docx'),
        ])

        expect(mocks.state.upload.prepare).not.toHaveBeenCalled()
        expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()
        expect(mocks.info).toHaveBeenCalledWith(
          'Please wait',
          expect.stringContaining('still running'),
        )

        mocks.state.upload.isBusy.value = false
        await finishRun('done', ['ready'])

        expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()
      })

      it('reports a failed removal of the old file', async () => {
        await startReplacement()
        mocks.state.knowledge.removeItem.mockResolvedValue({
          ok: false,
          parsed: { message: 'Locked', why: 'Busy', status: 409 },
        })
        await finishRun('done', ['ready'])

        expect(mocks.error).toHaveBeenCalledWith('Locked', 'Busy')
      })

      it('ignores an old file that is already gone', async () => {
        await startReplacement()
        setItems([])
        await finishRun('done', ['ready'])

        expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()
      })

      it('does not tie a later plain upload to the replacement', async () => {
        const wrapper = await startReplacement()

        await discardRun()
        await chooseFiles(wrapper, 'knowledge-file-input', [
          new File(['x'], 'other.md'),
        ])
        await finishRun('done', ['ready'])

        expect(mocks.state.knowledge.removeItem).not.toHaveBeenCalled()
      })
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

    it('refreshes storage and toasts when a hidden upload finishes', async () => {
      mocks.state.upload.phase.value = 'running'

      const wrapper = await mountPanel()

      mocks.state.upload.entries.value = [
        { key: 'a', status: 'ready' },
        { key: 'b', status: 'failed' },
      ] as KnowledgeUploadEntry[]
      mocks.state.upload.phase.value = 'done'
      await flushPromises()

      expect(mocks.state.knowledge.refresh).not.toHaveBeenCalled()
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

    it('toasts the why and fix of the account item limit', async () => {
      mocks.state.upload.phase.value = 'running'

      await mountPanel()

      mocks.state.upload.error.value = {
        message: 'Knowledge item limit reached',
        why: 'An account holds at most 500 knowledge items',
        fix: 'Remove items from other projects before adding more',
        status: 422,
      }
      mocks.state.upload.phase.value = 'error'
      await flushPromises()

      expect(mocks.error).toHaveBeenCalledWith(
        'Knowledge item limit reached',
        'An account holds at most 500 knowledge items '
        + 'Remove items from other projects before adding more',
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

    it('hands the commit state to the sheet and retries on request', async () => {
      mocks.state.upload.canRetryCommit.value = true
      mocks.state.upload.cleanupFailures.value = 2

      const wrapper = await mountPanel()
      const sheet = wrapper.getComponent(UploadSheetStub)

      expect(sheet.props('canRetryCommit')).toBe(true)
      expect(sheet.props('cleanupFailures')).toBe(2)

      sheet.vm.$emit('retry-commit')
      await flushPromises()

      expect(mocks.state.upload.retryCommit).toHaveBeenCalledOnce()
    })

    it('retries failed files from the sheet', async () => {
      const wrapper = await mountPanel()

      wrapper.getComponent(UploadSheetStub).vm.$emit('retry')
      await flushPromises()

      expect(mocks.state.upload.retryFailed).toHaveBeenCalledOnce()
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

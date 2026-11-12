import { computed, defineComponent, h, reactive, ref, shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ExtraFileSourceTab,
  FileManagerFile,
  ProjectFileGroup,
} from '../../../../../../app/types/file-manager'
import { OFFICE_MEDIA_TYPES } from '../../../../../../shared/utils/office-files'
import { createFileDeliveryResolver } from '../../../../../../app/utils/file-delivery-hints'
import Select from '../../../../../../app/components/ChatInput/Files/Modal/Select.client.vue'

const mocks = vi.hoisted(() => ({
  fetchFiles: vi.fn(),
  getFileManagerExtraSourceTabs: vi.fn(),
  useActiveElement: vi.fn(),
  useFileManager: vi.fn(),
  useLazyFetch: vi.fn(),
  useWarningMessage: vi.fn(),
}))

mockNuxtImport(
  'getFileManagerExtraSourceTabs',
  () => mocks.getFileManagerExtraSourceTabs,
)
mockNuxtImport('useActiveElement', () => mocks.useActiveElement)
mockNuxtImport('useFileManager', () => mocks.useFileManager)
mockNuxtImport('useLazyFetch', () => mocks.useLazyFetch)
mockNuxtImport('useWarningMessage', () => mocks.useWarningMessage)

const source = shallowRef<'upload' | 'assistant' | 'project'>('upload')
const search = shallowRef<string>('')
const kind = shallowRef<'all' | 'image' | 'document'>('all')
const projectGroups = ref<ProjectFileGroup[]>([])
const isProjectGroupsLoading = shallowRef<boolean>(false)
const handleProjectGroupSelect = vi.fn()
const toggleProjectGroup = vi.fn()
const loadMoreProjectGroup = vi.fn()
const toggleProjectGroupSelectAll = vi.fn()
const resetFileManager = vi.fn()
const hasSelection = shallowRef<boolean>(false)
const handleSelect = vi.fn()
const getSelectedForAttach = vi.fn()
const managerFiles = ref<FileManagerFile[]>([])

const FakeDriveSource = defineComponent({
  name: 'FakeDriveSource',
  props: {
    attachedIds: { type: Set, required: true },
    search: { type: String, required: true },
    viewMode: { type: String, required: true },
  },
  emits: ['attach'],
  setup() {
    return () => h('div', { 'data-testid': 'fake-drive-source' })
  },
})

function createExtraTab(
  overrides: Partial<ExtraFileSourceTab> = {},
): ExtraFileSourceTab {
  return {
    kind: 'extra',
    id: 'drive',
    label: 'Google Drive',
    testId: 'files-source-drive',
    component: FakeDriveSource,
    ...overrides,
  }
}

function createManagerFile(
  overrides: Partial<FileManagerFile> = {},
): FileManagerFile {
  return {
    id: 'file-1',
    storageKey: 'file-1.png',
    name: 'File.png',
    size: 1,
    type: 'image/png',
    source: 'assistant',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  } as FileManagerFile
}

function createProjectGroup(
  overrides: Partial<ProjectFileGroup> = {},
): ProjectFileGroup {
  return {
    id: 'project-a',
    name: 'Alpha',
    fileCount: 1,
    pinned: false,
    archived: false,
    files: [],
    total: 1,
    serverOffset: 0,
    isLoading: false,
    isOpen: true,
    hasLoaded: false,
    hasError: false,
    ...overrides,
  }
}

describe('ChatInput/Files/Modal/Select', () => {
  beforeEach(() => {
    source.value = 'upload'
    search.value = ''
    kind.value = 'all'
    projectGroups.value = []
    isProjectGroupsLoading.value = false
    handleProjectGroupSelect.mockReset()
    toggleProjectGroup.mockReset()
    loadMoreProjectGroup.mockReset()
    toggleProjectGroupSelectAll.mockReset()
    resetFileManager.mockReset()
    hasSelection.value = false
    handleSelect.mockReset()
    getSelectedForAttach.mockReset()
    getSelectedForAttach.mockReturnValue([])
    managerFiles.value = []
    mocks.useWarningMessage.mockReset()
    mocks.getFileManagerExtraSourceTabs.mockReset()
    mocks.getFileManagerExtraSourceTabs.mockReturnValue([])
    mocks.fetchFiles.mockReset()
    mocks.fetchFiles.mockResolvedValue(true)
    mocks.useActiveElement.mockReturnValue(shallowRef<HTMLElement | null>(null))
    mocks.useLazyFetch.mockReturnValue({
      data: shallowRef(null),
    })
    mocks.useFileManager.mockReturnValue({
      files: managerFiles,
      selectedIds: ref(new Set<string>()),
      isLoading: shallowRef(false),
      isSearching: shallowRef(false),
      isDeletingSelected: shallowRef(false),
      search,
      source,
      kind,
      viewMode: shallowRef<'grid' | 'list'>('grid'),
      pagination: reactive({ offset: 0, limit: 20, total: 0 }),
      projectGroups,
      isProjectGroupsLoading,
      projectLoadedFiles: computed(() => []),
      loadedFiles: computed(() => managerFiles.value),
      hasMore: computed(() => false),
      selectedCount: computed(() => 0),
      hasSelection: computed(() => hasSelection.value),
      allSelected: computed(() => false),
      fetchFiles: mocks.fetchFiles,
      loadMore: vi.fn(),
      toggleProjectGroup,
      loadMoreProjectGroup,
      selectRange: vi.fn(),
      selectProjectGroupRange: vi.fn(),
      handleSelect,
      handleProjectGroupSelect,
      toggleProjectGroupSelectAll,
      toggleSelectAll: vi.fn(),
      deselectAll: vi.fn(),
      renameFile: vi.fn(),
      deleteFile: vi.fn(),
      deleteSelected: vi.fn(),
      getSelectedForAttach,
      reset: resetFileManager,
    })
  })

  it('renders the source filter as boxed, keyboard-native tabs', async () => {
    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })

    const tablist = wrapper.get('[role="tablist"]')
    const uploadedTab = wrapper.get('[data-testid="files-source-upload"]')
    const generatedTab = wrapper.get(
      '[data-testid="files-source-assistant"]',
    )
    const projectsTab = wrapper.get('[data-testid="files-source-project"]')
    const tabs = [uploadedTab, generatedTab, projectsTab]

    expect(tablist.classes()).toContain('tabs-box')
    expect(tabs.every(tab => tab.attributes('type') === 'radio')).toBe(true)
    expect(tabs.every((tab) => {
      return tab.attributes('name') === 'file_source_tabs'
    })).toBe(true)
    expect(tabs.every(tab => tab.classes().includes('min-h-11'))).toBe(true)
    expect(tablist.classes()).toEqual(expect.arrayContaining([
      'flex-nowrap',
      'overflow-x-auto',
      'no-scrollbar',
    ]))
    expect(generatedTab.attributes('aria-label')).toBe('Generated by AI')
    expect(projectsTab.attributes('aria-label')).toBe('Projects')
    expect(tabs.map(tab => tab.attributes('data-testid'))).toEqual([
      'files-source-upload',
      'files-source-assistant',
      'files-source-project',
    ])
    expect(wrapper.find('[data-testid="files-source-all"]').exists())
      .toBe(false)
    expect(tabs.map(tab => tab.attributes('aria-label'))).toEqual([
      'Uploaded',
      'Generated by AI',
      'Projects',
    ])
    expect(source.value).toBe('upload')
    expect((uploadedTab.element as HTMLInputElement).checked).toBe(true)

    const generatedInput = generatedTab.element as HTMLInputElement

    generatedInput.checked = true
    await generatedTab.trigger('change')

    expect(source.value).toBe('assistant')
    expect(generatedInput.checked).toBe(true)
  })

  it('applies the initialSource prop to the source filter', async () => {
    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
        initialSource: 'assistant',
      },
      shallow: true,
    })

    const generatedTab = wrapper.get(
      '[data-testid="files-source-assistant"]',
    )

    expect(source.value).toBe('assistant')
    expect((generatedTab.element as HTMLInputElement).checked).toBe(true)
  })

  it('keeps the generated-by-AI tab visible without image input gating', async () => {
    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })

    expect(
      wrapper.find('[data-testid="files-source-assistant"]').exists(),
    ).toBe(true)
    expect(
      wrapper.find('[data-testid="files-source-upload"]').exists(),
    ).toBe(true)
    expect(
      wrapper.find('[data-testid="files-source-project"]').exists(),
    ).toBe(true)
  })

  it('keeps an assistant initialSource without falling back to upload', async () => {
    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
        initialSource: 'assistant',
      },
      shallow: true,
    })

    expect(source.value).toBe('assistant')
    expect(
      (wrapper.get('[data-testid="files-source-assistant"]')
        .element as HTMLInputElement).checked,
    ).toBe(true)
  })

  it('shows the kind filter only on the generated tab', async () => {
    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })
    const kindFilterName = 'ChatInputFilesModalSelectKindFilter'

    expect(wrapper.findComponent({ name: kindFilterName }).exists())
      .toBe(false)

    source.value = 'assistant'
    await flushPromises()

    expect(wrapper.findComponent({ name: kindFilterName }).exists())
      .toBe(true)

    source.value = 'project'
    await flushPromises()

    expect(wrapper.findComponent({ name: kindFilterName }).exists())
      .toBe(false)
  })

  it('writes the chosen kind to the file manager', async () => {
    source.value = 'assistant'

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })
    const kindFilter = wrapper.findComponent({
      name: 'ChatInputFilesModalSelectKindFilter',
    })

    kindFilter.vm.$emit('update:modelValue', 'document')
    await flushPromises()

    expect(kind.value).toBe('document')
  })

  it.each(['grid', 'list'] as const)(
    'passes a %s preview up to the modal',
    async (view) => {
      source.value = 'assistant'
      managerFiles.value = [createManagerFile({
        id: 'file-doc',
        name: 'Plan.docx',
        documentId: 'doc-1',
      })]
      mocks.useFileManager.mockReturnValue({
        ...mocks.useFileManager(),
        viewMode: shallowRef<'grid' | 'list'>(view),
      })

      const wrapper = await mountSuspended(Select, {
        props: {
          attachedIds: new Set<string>(),
        },
        shallow: true,
        global: { stubs: { KeepAlive: false } },
      })

      await flushPromises()

      const fileView = wrapper.findComponent({ name: 'AsyncComponentWrapper' })

      expect(fileView.exists()).toBe(true)

      fileView.vm.$emit('preview', managerFiles.value[0])

      expect(wrapper.emitted('preview')?.[0]).toEqual([managerFiles.value[0]])
    },
  )

  it('names the empty state after the chosen kind', async () => {
    source.value = 'assistant'
    kind.value = 'document'

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })

    expect(wrapper.text()).toContain('No AI-generated documents yet')

    kind.value = 'image'
    await flushPromises()

    expect(wrapper.text()).toContain('No AI-generated images yet')

    kind.value = 'all'
    await flushPromises()

    expect(wrapper.text()).toContain('No AI-generated files yet')
  })

  it('switches the source filter to project files', async () => {
    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })

    const projectsTab = wrapper.get('[data-testid="files-source-project"]')
    const projectsInput = projectsTab.element as HTMLInputElement

    projectsInput.checked = true
    await projectsTab.trigger('change')

    expect(source.value).toBe('project')
    expect(projectsInput.checked).toBe(true)
  })

  it('shows the project empty state on the Projects tab', async () => {
    source.value = 'project'

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })

    expect(wrapper.text()).toContain('No project files yet')
  })

  it('shows the search variant of the project empty state', async () => {
    source.value = 'project'
    search.value = 'budget'

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })

    expect(wrapper.text()).toContain('No project files match "budget"')
  })

  it('renders the grouped component instead of the flat views on the Projects tab', async () => {
    source.value = 'project'
    projectGroups.value = [createProjectGroup()]

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })

    expect(
      wrapper.findComponent({ name: 'ChatInputFilesModalSelectProjectGroups' })
        .exists(),
    ).toBe(true)
    expect(wrapper.text()).not.toContain('No project files yet')
    expect(wrapper.find('[data-testid="files-source-project"]').exists())
      .toBe(true)
  })

  it('routes grouped file clicks and group toggles to the manager', async () => {
    source.value = 'project'
    projectGroups.value = [createProjectGroup()]

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })
    const groups = wrapper.findComponent({
      name: 'ChatInputFilesModalSelectProjectGroups',
    })
    const file = {
      id: 'file-1',
      storageKey: 'file-1.pdf',
      name: 'File.pdf',
      size: 1,
      type: 'application/pdf',
      source: 'upload' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    groups.vm.$emit('file-click', new MouseEvent('click', {
      shiftKey: true,
    }), file, 2, 'project-a')
    groups.vm.$emit('toggle', 'project-a')
    groups.vm.$emit('load-more', 'project-a')
    groups.vm.$emit('toggle-select-all', 'project-a')

    expect(handleProjectGroupSelect).toHaveBeenCalledWith(
      'project-a',
      'file-1',
      2,
      true,
    )
    expect(toggleProjectGroup).toHaveBeenCalledWith('project-a')
    expect(loadMoreProjectGroup).toHaveBeenCalledWith('project-a')
    expect(toggleProjectGroupSelectAll).toHaveBeenCalledWith('project-a')
  })

  describe('model capability', () => {
    const imageFile = createManagerFile()
    const textFile = createManagerFile({
      id: 'file-2',
      storageKey: 'file-2.txt',
      name: 'Notes.txt',
      type: 'text/plain',
    })
    const pdfDocument = createManagerFile({
      id: 'file-3',
      storageKey: 'file-3.pdf',
      name: 'Report.pdf',
      type: 'application/pdf',
    })
    const canAttachWithoutImages = (mediaType: string) => {
      return !mediaType.startsWith('image/')
    }
    const canAttachWithoutPdf = (mediaType: string) => {
      return mediaType !== 'application/pdf'
    }

    async function mountWithFiles(
      canAttachMediaType: (mediaType: string) => boolean,
    ) {
      source.value = 'assistant'
      managerFiles.value = [imageFile, textFile, pdfDocument]

      return await mountSuspended(Select, {
        props: {
          attachedIds: new Set<string>(),
          canAttachMediaType,
        },
        shallow: true,
        global: { stubs: { KeepAlive: false } },
      })
    }

    function findFlatView(wrapper: Awaited<ReturnType<typeof mountWithFiles>>) {
      return wrapper.findComponent({ name: 'AsyncComponentWrapper' })
    }

    function readReasons(
      wrapper: Awaited<ReturnType<typeof mountWithFiles>>,
    ): Record<string, string> {
      const attributes = findFlatView(wrapper).vm.$attrs

      return (attributes['unsupported-reasons']
        ?? attributes.unsupportedReasons) as Record<string, string>
    }

    it('marks generated images as unsupported for a text-only model', async () => {
      const wrapper = await mountWithFiles(canAttachWithoutImages)

      const reasons = readReasons(wrapper)

      expect(Object.keys(reasons)).toEqual(['file-1'])
      expect(reasons['file-1']).toBe(
        'This model does not support image input. '
        + 'Attach a PDF or text file instead, or switch models.',
      )
    })

    it('marks generated PDF documents as unsupported without PDF input', async () => {
      const wrapper = await mountWithFiles(canAttachWithoutPdf)
      const reasons = readReasons(wrapper)

      expect(Object.keys(reasons)).toEqual(['file-3'])
      expect(reasons['file-3']).toContain(
        'This model does not support PDF input.',
      )
    })

    it('does not mark anything when the model accepts every file', async () => {
      const wrapper = await mountWithFiles(() => true)

      expect(readReasons(wrapper)).toEqual({})
    })

    it('warns instead of selecting an unsupported file', async () => {
      const wrapper = await mountWithFiles(canAttachWithoutImages)
      const view = findFlatView(wrapper)

      view.vm.$emit('file-click', new MouseEvent('click'), imageFile, 0)

      expect(handleSelect).not.toHaveBeenCalled()
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('This model does not support image input.'),
      )

      view.vm.$emit('file-click', new MouseEvent('click'), textFile, 1)

      expect(handleSelect).toHaveBeenCalledWith('file-2', 1, false)
    })

    it('attaches only the supported files from a bulk selection', async () => {
      hasSelection.value = true
      getSelectedForAttach.mockReturnValue([imageFile, textFile])

      const wrapper = await mountWithFiles(canAttachWithoutImages)
      const toolbar = wrapper.findComponent({
        name: 'ChatInputFilesModalSelectActionsToolbar',
      })

      toolbar.vm.$emit('attach')

      expect(wrapper.emitted('attach')).toEqual([[[textFile]]])
      expect(mocks.useWarningMessage).toHaveBeenCalledTimes(1)
    })

    it('does not emit an attach when every selected file is unsupported', async () => {
      hasSelection.value = true
      getSelectedForAttach.mockReturnValue([imageFile])

      const wrapper = await mountWithFiles(canAttachWithoutImages)
      const toolbar = wrapper.findComponent({
        name: 'ChatInputFilesModalSelectActionsToolbar',
      })

      toolbar.vm.$emit('attach')

      expect(wrapper.emitted('attach')).toBeUndefined()
      expect(mocks.useWarningMessage).toHaveBeenCalledTimes(1)
    })
  })

  describe('delivery reasons', () => {
    const docxType = OFFICE_MEDIA_TYPES.docx
    const xlsxType = OFFICE_MEDIA_TYPES.xlsx
    const readableSheet = createManagerFile({
      id: 'sheet-ready',
      storageKey: 'sheet-ready.xlsx',
      name: 'Budget.xlsx',
      type: xlsxType,
      textStatus: 'ready',
    })
    const unreadSheet = createManagerFile({
      id: 'sheet-null',
      storageKey: 'sheet-null.xlsx',
      name: 'Old budget.xlsx',
      type: xlsxType,
      textStatus: null,
    })
    const emptyDocument = createManagerFile({
      id: 'doc-empty',
      storageKey: 'doc-empty.docx',
      name: 'Empty.docx',
      type: docxType,
      textStatus: 'empty',
    })
    const failedDocument = createManagerFile({
      id: 'doc-failed',
      storageKey: 'doc-failed.docx',
      name: 'Broken.docx',
      type: docxType,
      textStatus: 'failed',
    })
    const legacySheet = createManagerFile({
      id: 'sheet-legacy',
      storageKey: 'sheet-legacy.xls',
      name: 'Legacy.xls',
      type: 'application/vnd.ms-excel',
    })
    const archive = createManagerFile({
      id: 'archive',
      storageKey: 'archive.zip',
      name: 'Backup.zip',
      type: 'application/zip',
    })
    const resolveDelivery = createFileDeliveryResolver({
      route: 'direct',
      providerId: 'anthropic',
      modalities: ['text', 'image', 'pdf'],
    })

    async function mountWithResolver() {
      source.value = 'assistant'
      managerFiles.value = [
        readableSheet,
        unreadSheet,
        emptyDocument,
        failedDocument,
        legacySheet,
        archive,
        createManagerFile(),
      ]

      return await mountSuspended(Select, {
        props: {
          attachedIds: new Set<string>(),
          canAttachMediaType: () => true,
          resolveDelivery,
        },
        shallow: true,
        global: { stubs: { KeepAlive: false } },
      })
    }

    function readCaptions(
      wrapper: Awaited<ReturnType<typeof mountWithResolver>>,
    ): Record<string, string> {
      const attributes = wrapper
        .findComponent({ name: 'AsyncComponentWrapper' }).vm.$attrs

      return (attributes['unsupported-captions']
        ?? attributes.unsupportedCaptions) as Record<string, string>
    }

    function readReasons(
      wrapper: Awaited<ReturnType<typeof mountWithResolver>>,
    ): Record<string, string> {
      const attributes = wrapper
        .findComponent({ name: 'AsyncComponentWrapper' }).vm.$attrs

      return (attributes['unsupported-reasons']
        ?? attributes.unsupportedReasons) as Record<string, string>
    }

    it('keeps generated and stored Office files selectable', async () => {
      const reasons = readReasons(await mountWithResolver())

      expect(reasons['sheet-ready']).toBeUndefined()
      expect(reasons['sheet-null']).toBeUndefined()
      expect(reasons['file-1']).toBeUndefined()
    })

    it('disables a document with no readable text and says why', async () => {
      const reasons = readReasons(await mountWithResolver())

      for (const id of ['doc-empty', 'doc-failed']) {
        expect(reasons[id]).toContain('No text could be read')
        expect(reasons[id]).toContain('.docx, .xlsx or .pptx')
      }
    })

    it('names each file in its own reason', async () => {
      const reasons = readReasons(await mountWithResolver())

      expect(reasons['doc-empty']).toContain('Empty.docx')
      expect(reasons['doc-failed']).toContain('Broken.docx')
      expect(reasons['doc-failed']).not.toContain('Empty.docx')
      expect(reasons['sheet-legacy']).toContain('Legacy.xls')
    })

    it('captions each disabled file with a few words', async () => {
      const captions = readCaptions(await mountWithResolver())

      expect(captions).toEqual({
        'doc-empty': 'No readable text',
        'doc-failed': 'No readable text',
        'sheet-legacy': 'Old Office format',
        'archive': 'Type not supported',
      })
    })

    it('disables a legacy Office file with the save-as hint', async () => {
      const reasons = readReasons(await mountWithResolver())

      expect(reasons['sheet-legacy']).toContain('cannot be read')
      expect(reasons['sheet-legacy'])
        .toContain('Save the file as .docx, .xlsx or .pptx')
    })

    it('disables a type no model can take instead of dropping it', async () => {
      const reasons = readReasons(await mountWithResolver())

      expect(reasons.archive).toContain('cannot be sent to a model')
    })

    it('shows the reason in a warning when a disabled file is clicked',
      async () => {
        const wrapper = await mountWithResolver()
        const view = wrapper.findComponent({ name: 'AsyncComponentWrapper' })

        view.vm.$emit('file-click', new MouseEvent('click'), failedDocument, 3)

        expect(handleSelect).not.toHaveBeenCalled()
        expect(mocks.useWarningMessage).toHaveBeenCalledWith(
          expect.stringContaining('No text could be read'),
        )
      })

    it('keeps the model reason for an image the model cannot read',
      async () => {
        source.value = 'assistant'
        managerFiles.value = [createManagerFile()]

        const wrapper = await mountSuspended(Select, {
          props: {
            attachedIds: new Set<string>(),
            canAttachMediaType: (mediaType: string) => {
              return !mediaType.startsWith('image/')
            },
            resolveDelivery: createFileDeliveryResolver({
              route: 'direct',
              modalities: ['text', 'pdf'],
            }),
          },
          shallow: true,
          global: { stubs: { KeepAlive: false } },
        })

        expect(readReasons(wrapper)['file-1']).toBe(
          'This model does not support image input. '
          + 'Attach a PDF or text file instead, or switch models.',
        )
      })
  })

  it('renders a registered extra source after the built-in tabs', async () => {
    mocks.getFileManagerExtraSourceTabs.mockReturnValue([createExtraTab()])

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })
    const tabs = wrapper.findAll('input[name="file_source_tabs"]')

    expect(tabs.map(tab => tab.attributes('data-testid'))).toEqual([
      'files-source-upload',
      'files-source-assistant',
      'files-source-project',
      'files-source-drive',
    ])
    expect(wrapper.get('[data-testid="files-source-drive"]')
      .attributes('aria-label')).toBe('Google Drive')
  })

  it('hides an extra source whose feature is disabled', async () => {
    const isEnabled = vi.fn(() => false)

    mocks.getFileManagerExtraSourceTabs.mockReturnValue([
      createExtraTab({ isEnabled }),
    ])

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })

    expect(isEnabled).toHaveBeenCalled()
    expect(wrapper.find('[data-testid="files-source-drive"]').exists())
      .toBe(false)
    expect(wrapper.findAll('input[name="file_source_tabs"]')).toHaveLength(3)
  })

  it('shows an extra source whose feature is enabled', async () => {
    mocks.getFileManagerExtraSourceTabs.mockReturnValue([
      createExtraTab({ isEnabled: () => true }),
    ])

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })

    expect(wrapper.find('[data-testid="files-source-drive"]').exists())
      .toBe(true)
  })

  it('renders the extra source component without changing the file source', async () => {
    mocks.getFileManagerExtraSourceTabs.mockReturnValue([createExtraTab()])

    const attachedIds = new Set<string>(['file-1'])
    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds,
      },
      shallow: true,
    })
    const driveTab = wrapper.get('[data-testid="files-source-drive"]')
    const uploadedTab = wrapper.get('[data-testid="files-source-upload"]')

    expect(wrapper.findComponent(FakeDriveSource).exists()).toBe(false)

    await driveTab.trigger('change')

    const driveSource = wrapper.findComponent(FakeDriveSource)

    expect(source.value).toBe('upload')
    expect(driveSource.exists()).toBe(true)
    expect(driveSource.props('attachedIds')).toBe(attachedIds)
    expect((driveTab.element as HTMLInputElement).checked).toBe(true)
    expect((uploadedTab.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).not.toContain('No uploaded files yet')

    const file = {
      id: 'drive-1',
      storageKey: 'drive-1.pdf',
      name: 'Plan.pdf',
      size: 1,
      type: 'application/pdf',
      source: 'upload' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
    }

    driveSource.vm.$emit('attach', [file])

    expect(wrapper.emitted('attach')?.[0]).toEqual([[file]])

    await uploadedTab.trigger('change')

    expect(wrapper.findComponent(FakeDriveSource).exists()).toBe(false)
    expect((uploadedTab.element as HTMLInputElement).checked).toBe(true)
    expect(source.value).toBe('upload')
  })

  it('leaves the extra source when reset or handed a new initialSource', async () => {
    mocks.getFileManagerExtraSourceTabs.mockReturnValue([createExtraTab()])

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
        initialSource: 'upload',
      },
      shallow: true,
    })

    await wrapper.get('[data-testid="files-source-drive"]').trigger('change')
    expect(wrapper.findComponent(FakeDriveSource).exists()).toBe(true)

    await wrapper.setProps({ initialSource: 'project' })

    expect(wrapper.findComponent(FakeDriveSource).exists()).toBe(false)
    expect(source.value).toBe('project')

    await wrapper.get('[data-testid="files-source-drive"]').trigger('change')
    expect(wrapper.findComponent(FakeDriveSource).exists()).toBe(true)

    const exposed = wrapper.vm as unknown as { reset: () => void }

    exposed.reset()
    await wrapper.vm.$nextTick()

    expect(resetFileManager).toHaveBeenCalled()
    expect(wrapper.findComponent(FakeDriveSource).exists()).toBe(false)
  })

  it('hides the bulk actions toolbar while an extra source is open', async () => {
    hasSelection.value = true
    mocks.getFileManagerExtraSourceTabs.mockReturnValue([createExtraTab()])

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })
    const toolbar = () => {
      return wrapper.findComponent({
        name: 'ChatInputFilesModalSelectActionsToolbar',
      })
    }

    expect(toolbar().props('visible')).toBe(true)

    await wrapper.get('[data-testid="files-source-drive"]').trigger('change')

    expect(toolbar().props('visible')).toBe(false)

    await wrapper.get('[data-testid="files-source-upload"]').trigger('change')

    expect(toolbar().props('visible')).toBe(true)
  })

  it('rebinds the interaction listeners when returning from an extra source', async () => {
    mocks.getFileManagerExtraSourceTabs.mockReturnValue([createExtraTab()])

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })

    await flushPromises()

    const addEventListener = vi.spyOn(document, 'addEventListener')

    await wrapper.get('[data-testid="files-source-drive"]').trigger('change')
    await flushPromises()
    addEventListener.mockClear()

    await wrapper.get('[data-testid="files-source-upload"]').trigger('change')
    await flushPromises()

    expect(source.value).toBe('upload')
    expect(addEventListener.mock.calls.some(([type]) => {
      return type === 'keydown'
    })).toBe(true)

    addEventListener.mockRestore()
  })

  it('forgets an extra source that gets disabled while open', async () => {
    const isDriveEnabled = shallowRef<boolean>(true)

    mocks.getFileManagerExtraSourceTabs.mockReturnValue([
      createExtraTab({ isEnabled: () => isDriveEnabled.value }),
    ])

    const wrapper = await mountSuspended(Select, {
      props: {
        attachedIds: new Set<string>(),
      },
      shallow: true,
    })

    await wrapper.get('[data-testid="files-source-drive"]').trigger('change')
    expect(wrapper.findComponent(FakeDriveSource).exists()).toBe(true)

    isDriveEnabled.value = false
    await flushPromises()

    const uploadedTab = wrapper.get('[data-testid="files-source-upload"]')

    expect(wrapper.find('[data-testid="files-source-drive"]').exists())
      .toBe(false)
    expect(wrapper.findComponent(FakeDriveSource).exists()).toBe(false)
    expect((uploadedTab.element as HTMLInputElement).checked).toBe(true)

    isDriveEnabled.value = true
    await flushPromises()

    expect(wrapper.find('[data-testid="files-source-drive"]').exists())
      .toBe(true)
    expect(wrapper.findComponent(FakeDriveSource).exists()).toBe(false)
  })
})

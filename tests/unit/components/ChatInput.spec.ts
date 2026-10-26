import { computed, defineComponent, nextTick, reactive, shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInputMediaTypePredicate } from '#shared/utils/input-media-types'
import ChatInput from '../../../app/components/ChatInput.client.vue'
import { useFilesModalHandoff } from '../../../app/composables/files-modal-handoff'
import { usePreferenceStorage } from '../../../app/composables/preference-storage'

const mocks = vi.hoisted(() => ({
  useChatInput: vi.fn(),
  useChatFiles: vi.fn(),
  useDevice: vi.fn(),
  uploadFiles: vi.fn(),
  useWarningMessage: vi.fn(),
  requestPersistence: vi.fn(),
  ensureSendConsent: vi.fn(async () => true),
  setDefaultReasoningLevel: vi.fn(async () => {}),
  setReasoningExpanded: vi.fn(async () => {}),
  setReasoningAutoHide: vi.fn(async () => {}),
}))

mockNuxtImport('useChatInput', () => mocks.useChatInput)
mockNuxtImport('useChatFiles', () => mocks.useChatFiles)
mockNuxtImport('useDevice', () => mocks.useDevice)
mockNuxtImport('useWarningMessage', () => mocks.useWarningMessage)
mockNuxtImport('requestPersistence', () => mocks.requestPersistence)
mockNuxtImport('useLegalConsent', () => () => ({
  ensureSendConsent: mocks.ensureSendConsent,
}))

mockNuxtImport('useMediaQuery', () => {
  return () => isPopoverLayout
})

mockNuxtImport('useUserSetting', () => {
  return () => ({
    reasoningExpanded: computed(() => false),
    reasoningAutoHide: computed(() => true),
    defaultReasoningLevel: computed(() => defaultReasoningLevel.value),
    setDefaultReasoningLevel: mocks.setDefaultReasoningLevel,
    setReasoningExpanded: mocks.setReasoningExpanded,
    setReasoningAutoHide: mocks.setReasoningAutoHide,
  })
})

const isPopoverLayout = shallowRef<boolean>(true)
const defaultReasoningLevel = shallowRef<string | null>(null)

const mockRoute = reactive<{ path: string }>({ path: '/chats/abc123' })

mockNuxtImport('useRoute', () => {
  return () => mockRoute
})

const filesModalOpenMock = vi.fn()

const filesModalStub = defineComponent({
  name: 'ChatInputFilesModalStub',
  methods: {
    open: filesModalOpenMock,
  },
  template: '<div />',
})

const uiButtonStub = defineComponent({
  name: 'UiButtonStub',
  props: {
    disabled: { type: Boolean, default: false },
    title: { type: String, default: '' },
  },
  emits: ['click'],
  template: '<button :disabled="disabled" :title="title" '
    + '@click="$emit(\'click\')"><slot /></button>',
})

enableAutoUnmount(afterEach)

function mountChatInput(extraProps: Record<string, unknown> = {}) {
  return mountSuspended(ChatInput, {
    props: {
      messagesLength: 0,
      stop: vi.fn(),
      regenerate: vi.fn(),
      ...extraProps,
    },
    attachTo: document.body,
    global: {
      stubs: {
        ChatInputFilesModal: filesModalStub,
        LazyChatInputFilesModal: filesModalStub,
        LazyChatInputFilesDropZone: true,
        LazyChatScroll: true,
        LazyChatInputFilesAttachedPreview: true,
        LazyChatInputModelsTrigger: true,
        LazyChatInputFilesTrigger: true,
        LazyChatInputReasoningTrigger: true,
        LazyChatInputDeepResearchTrigger: true,
        LazyChatInputToolbarMore: true,
        UiBubble: {
          template: '<div><slot /></div>',
        },
        UiButton: uiButtonStub,
      },
    },
  })
}

type ChatInputWrapper = Awaited<ReturnType<typeof mountChatInput>>

async function openToolsPanel(wrapper: ChatInputWrapper) {
  await wrapper.get('[data-testid="chat-input-tools-trigger"]')
    .trigger('click')
  await flushPromises()
}

function hasTestId(wrapper: ChatInputWrapper, testId: string): boolean {
  return wrapper.find(`[data-testid="${testId}"]`).exists()
}

function isTestIdChecked(
  wrapper: ChatInputWrapper,
  testId: string,
): boolean {
  return (wrapper.get(`[data-testid="${testId}"]`).element as HTMLInputElement)
    .checked
}

function isTestIdDisabled(
  wrapper: ChatInputWrapper,
  testId: string,
): boolean {
  return (wrapper.get(`[data-testid="${testId}"]`).element as HTMLInputElement)
    .disabled
}

async function pickTestId(wrapper: ChatInputWrapper, testId: string) {
  await wrapper.get(`[data-testid="${testId}"]`).setValue(true)
  await nextTick()
}

async function setToggle(
  wrapper: ChatInputWrapper,
  testId: string,
  isOn: boolean,
) {
  await wrapper.get(`[data-testid="${testId}"]`).setValue(isOn)
  await nextTick()
}

function ariaLabelsOf(
  wrapper: ChatInputWrapper,
  testIdPrefix: string,
): string[] {
  return wrapper.findAll(`[data-testid^="${testIdPrefix}"]`).map((item) => {
    return item.attributes('aria-label') ?? ''
  })
}

function tileOf(wrapper: ChatInputWrapper, id: string) {
  return wrapper.find(`[data-testid="chat-input-tile-${id}"]`)
}

function tileTitle(wrapper: ChatInputWrapper, id: string): string {
  return wrapper.get(`[data-testid="chat-input-tile-${id}-body"]`)
    .attributes('aria-label') ?? ''
}

function createPasteEvent(files: File[]) {
  const event = new Event('paste', { cancelable: true }) as ClipboardEvent
  const items = files.map((file) => {
    return {
      type: file.type,
      getAsFile: () => file,
    }
  })

  Object.defineProperty(event, 'clipboardData', {
    value: { items },
    configurable: true,
  })

  return event
}

function appendBlockingDialog(className: string) {
  const dialog = document.createElement('dialog')

  dialog.className = className
  dialog.setAttribute('open', '')
  document.body.appendChild(dialog)

  return dialog
}

describe('ChatInput.client', () => {
  beforeEach(() => {
    mockRoute.path = '/chats/abc123'
    isPopoverLayout.value = true
    defaultReasoningLevel.value = null

    mocks.useChatInput.mockReturnValue({
      isWebSearchSupported: shallowRef(false),
      isToolCallingSupported: shallowRef(false),
      webSearchProviderOptions: shallowRef([]),
      isImageGenerationSupported: shallowRef(false),
      isImageGenerationRequired: shallowRef(false),
      isImageInputSupported: shallowRef(true),
      canAttachMediaType: shallowRef(() => true),
      isReasoningSupported: shallowRef(false),
      isReasoningAlwaysOn: shallowRef(false),
      canDisableReasoningLevel: shallowRef(true),
      reasoningCapability: shallowRef(null),
      reasoningMode: shallowRef('none'),
      reasoningMenuLevels: shallowRef([]),
      isDeepResearchModel: shallowRef(false),
      researchConfig: shallowRef(null),
      isSelectedModelKeyless: shallowRef(false),
      selectedTransferProviderId: shallowRef(null),
      selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
      isModelCapabilityResolved: shallowRef(true),
      isSelectedModelUnavailable: shallowRef(false),
    })

    mocks.useChatFiles.mockReturnValue({
      uploadFiles: mocks.uploadFiles,
      uploadingFiles: shallowRef(new Map()),
      uploadingCount: computed(() => 0),
      cancelUpload: vi.fn(),
      retryUpload: vi.fn(),
      cancelAllUploads: vi.fn(),
      removeAttachedFile: vi.fn(),
      removeAllFiles: vi.fn(),
    })

    mocks.useDevice.mockReturnValue({
      isIos: false,
      isAndroid: false,
      isDesktop: true,
    })

    filesModalOpenMock.mockReset()
    mocks.uploadFiles.mockReset()
    mocks.useWarningMessage.mockReset()
    mocks.requestPersistence.mockReset()
    mocks.setDefaultReasoningLevel.mockReset()

    useFilesModalHandoff().clearPendingOpen()

    const prefStorage = usePreferenceStorage()

    prefStorage.removeItem('settings_web_search_tool')
    prefStorage.removeItem('settings_reasoning_level')
    prefStorage.removeItem('settings_exa_search_level')
  })

  afterEach(() => {
    document
      .querySelectorAll('dialog.js-files-modal, dialog.js-search-modal')
      .forEach((dialog) => {
        dialog.remove()
      })
  })

  describe('files-modal handoff consumption', () => {
    it('opens the files modal and clears the flag for a pending request already matching the route at mount', async () => {
      useFilesModalHandoff().requestOpen('select', '/chats/abc123', 'all')

      await mountChatInput()
      await nextTick()

      expect(filesModalOpenMock).toHaveBeenCalledWith('select', 'all')
      expect(useFilesModalHandoff().pendingOpen.value).toBeNull()
    })

    it('opens the files modal when a matching request arrives after mount', async () => {
      await mountChatInput()
      await nextTick()

      useFilesModalHandoff().requestOpen('upload', '/chats/abc123')
      await nextTick()

      expect(filesModalOpenMock).toHaveBeenCalledWith('upload', undefined)
      expect(useFilesModalHandoff().pendingOpen.value).toBeNull()
    })

    it('does not open the files modal while the target path does not match the current route, but still opens a fresh matching request (proving the modal ref is live, not just unreachable)', async () => {
      useFilesModalHandoff().requestOpen(
        'select',
        '/chats/other-chat',
        'all',
      )

      await mountChatInput()
      await nextTick()

      expect(filesModalOpenMock).not.toHaveBeenCalled()
      expect(useFilesModalHandoff().pendingOpen.value).toEqual({
        tab: 'select',
        source: 'all',
        targetPath: '/chats/other-chat',
      })

      useFilesModalHandoff().requestOpen('upload', '/chats/abc123')
      await nextTick()

      expect(filesModalOpenMock).toHaveBeenCalledWith('upload', undefined)
      expect(useFilesModalHandoff().pendingOpen.value).toBeNull()
    })
  })

  describe('paste-to-attach guard', () => {
    it('uploads a pasted image when no blocking dialog is open', async () => {
      await mountChatInput()

      const file = new File(['data'], 'clip.png', { type: 'image/png' })
      const event = createPasteEvent([file])
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

      document.dispatchEvent(event)

      expect(preventDefaultSpy).toHaveBeenCalled()
      expect(mocks.uploadFiles).toHaveBeenCalledWith([file])
    })

    it('ignores a pasted image while the files modal dialog is open', async () => {
      await mountChatInput()

      appendBlockingDialog('js-files-modal')

      const file = new File(['data'], 'clip.png', { type: 'image/png' })

      document.dispatchEvent(createPasteEvent([file]))

      expect(mocks.uploadFiles).not.toHaveBeenCalled()
    })

    it('ignores a pasted image while the search modal dialog is open', async () => {
      await mountChatInput()

      appendBlockingDialog('js-search-modal')

      const file = new File(['data'], 'clip.png', { type: 'image/png' })

      document.dispatchEvent(createPasteEvent([file]))

      expect(mocks.uploadFiles).not.toHaveBeenCalled()
    })
  })

  describe('missing-key send guidance', () => {
    function useKeylessSelection() {
      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(false),
        isToolCallingSupported: shallowRef(false),
        webSearchProviderOptions: shallowRef([]),
        isImageGenerationSupported: shallowRef(false),
        isImageGenerationRequired: shallowRef(false),
        isImageInputSupported: shallowRef(true),
        canAttachMediaType: shallowRef(() => true),
        isReasoningSupported: shallowRef(false),
        isReasoningAlwaysOn: shallowRef(false),
        canDisableReasoningLevel: shallowRef(true),
        reasoningCapability: shallowRef(null),
        reasoningMode: shallowRef('none'),
        reasoningMenuLevels: shallowRef([]),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(true),
        selectedTransferProviderId: shallowRef(null),
        selectedModelKeyOwnerLabel: shallowRef('Anthropic'),
        isModelCapabilityResolved: shallowRef(true),
        isSelectedModelUnavailable: shallowRef(false),
      })
    }

    it('names the key the selection depends on without deadening the button', async () => {
      useKeylessSelection()

      const wrapper = await mountChatInput()

      await wrapper.get('textarea').setValue('hello')

      const sendButton = wrapper.get('[data-testid="send-message"]')

      expect(sendButton.attributes('title'))
        .toBe('Add your Anthropic API key to send this message')
      expect(sendButton.attributes('disabled')).toBeUndefined()
    })

    it('warns instead of sending when the send button is pressed', async () => {
      useKeylessSelection()

      const wrapper = await mountChatInput()

      await wrapper.get('textarea').setValue('hello')
      await wrapper.get('[data-testid="send-message"]').trigger('click')

      expect(mocks.useWarningMessage).toHaveBeenCalledWith(
        'Add your Anthropic API key to send this message.',
        'Open Profile → API Keys to add it, or pick a model you have a key for.',
      )
      expect(wrapper.emitted('submit')).toBeUndefined()
    })

    it('warns instead of regenerating against the same missing key', async () => {
      useKeylessSelection()

      const regenerate = vi.fn()
      const wrapper = await mountSuspended(ChatInput, {
        props: {
          messagesLength: 2,
          stop: vi.fn(),
          regenerate,
          displayRegenerate: true,
        },
        attachTo: document.body,
        global: {
          stubs: {
            ChatInputFilesModal: filesModalStub,
            LazyChatInputFilesModal: filesModalStub,
            LazyChatInputFilesDropZone: true,
            LazyChatScroll: true,
            LazyChatInputFilesAttachedPreview: true,
            LazyChatInputModelsTrigger: true,
            LazyChatInputFilesTrigger: true,
            LazyChatInputReasoningTrigger: true,
            LazyChatInputDeepResearchTrigger: true,
            LazyChatInputToolbarMore: true,
            UiBubble: {
              template: '<div><slot /></div>',
            },
            UiButton: uiButtonStub,
          },
        },
      })

      const regenerateButton = wrapper.get('[data-testid="regenerate"]')

      expect(regenerateButton.attributes('title'))
        .toBe('Add your Anthropic API key to send this message')

      await regenerateButton.trigger('click')

      expect(regenerate).not.toHaveBeenCalled()
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(
        'Add your Anthropic API key to send this message.',
        'Open Profile → API Keys to add it, or pick a model you have a key for.',
      )
    })

    it('warns with the keys-page guidance when Enter bypasses the button', async () => {
      useKeylessSelection()

      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')

      await textarea.setValue('hello')
      await textarea.trigger('keydown.enter')

      expect(mocks.useWarningMessage).toHaveBeenCalledWith(
        'Add your Anthropic API key to send this message.',
        'Open Profile → API Keys to add it, or pick a model you have a key for.',
      )
      expect(wrapper.emitted('submit')).toBeUndefined()
    })

    it('sends normally once a key is present', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')

      await textarea.setValue('hello')

      expect(wrapper.get('[data-testid="send-message"]')
        .attributes('disabled')).toBeUndefined()

      await textarea.trigger('keydown.enter')
      await flushPromises()

      expect(mocks.useWarningMessage).not.toHaveBeenCalled()
      expect(wrapper.emitted('submit')).toHaveLength(1)
      expect(mocks.ensureSendConsent).toHaveBeenCalledWith(null)
    })

    it('keeps the draft and does not send when consent is refused',
      async () => {
        mocks.ensureSendConsent.mockResolvedValueOnce(false)

        const wrapper = await mountChatInput()
        const textarea = wrapper.get('textarea')

        await textarea.setValue('hello')
        await textarea.trigger('keydown.enter')
        await flushPromises()

        expect(wrapper.emitted('submit')).toBeUndefined()
        expect((textarea.element as HTMLTextAreaElement).value).toBe('hello')
      })

    it('leaves the regenerate title alone when a key is present', async () => {
      const wrapper = await mountSuspended(ChatInput, {
        props: {
          messagesLength: 2,
          stop: vi.fn(),
          regenerate: vi.fn(),
          displayRegenerate: true,
        },
        attachTo: document.body,
        global: {
          stubs: {
            ChatInputFilesModal: filesModalStub,
            LazyChatInputFilesModal: filesModalStub,
            LazyChatInputFilesDropZone: true,
            LazyChatScroll: true,
            LazyChatInputFilesAttachedPreview: true,
            LazyChatInputModelsTrigger: true,
            LazyChatInputFilesTrigger: true,
            LazyChatInputReasoningTrigger: true,
            LazyChatInputDeepResearchTrigger: true,
            LazyChatInputToolbarMore: true,
            UiBubble: {
              template: '<div><slot /></div>',
            },
            UiButton: uiButtonStub,
          },
        },
      })

      expect(wrapper.get('[data-testid="regenerate"]').attributes('title'))
        .toBe('Regenerate')
    })
  })

  describe('attachment input gating', () => {
    const imageFile = {
      id: '1',
      storageKey: 'image-key',
      name: 'a.png',
      size: 10,
      type: 'image/png',
    }
    const textFile = {
      id: '2',
      storageKey: 'text-key',
      name: 'a.txt',
      size: 10,
      type: 'text/plain',
    }
    const pdfFile = {
      id: '3',
      storageKey: 'pdf-key',
      name: 'a.pdf',
      size: 10,
      type: 'application/pdf',
    }
    const allowEverything = createInputMediaTypePredicate(['image', 'pdf'])
    const withoutImages = createInputMediaTypePredicate(['pdf'])
    const withoutPdf = createInputMediaTypePredicate(['image'])
    const textOnly = createInputMediaTypePredicate([])
    const imageWarning = 'This model does not support image input. '
      + 'Attach a PDF or text file instead, or switch models.'
    const pdfWarning = 'This model does not support PDF input. '
      + 'Attach an image or text file instead, or switch models.'
    const combinedWarning = 'This model does not support image or PDF input. '
      + 'Attach a text file instead, or switch models.'

    function useSelection(
      predicate: (mediaType: string) => boolean = allowEverything,
    ) {
      const canAttachMediaType = shallowRef(predicate)

      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(false),
        isToolCallingSupported: shallowRef(false),
        webSearchProviderOptions: shallowRef([]),
        isImageGenerationSupported: shallowRef(false),
        isImageGenerationRequired: shallowRef(false),
        isImageInputSupported: shallowRef(predicate('image/png')),
        canAttachMediaType,
        isReasoningSupported: shallowRef(false),
        isReasoningAlwaysOn: shallowRef(false),
        canDisableReasoningLevel: shallowRef(true),
        reasoningCapability: shallowRef(null),
        reasoningMode: shallowRef('none'),
        reasoningMenuLevels: shallowRef([]),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedTransferProviderId: shallowRef(null),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
        isModelCapabilityResolved: shallowRef(true),
        isSelectedModelUnavailable: shallowRef(false),
      })

      return canAttachMediaType
    }

    function attachedFileNames(wrapper: Awaited<ReturnType<
      typeof mountChatInput
    >>): string[] {
      return wrapper.findAll('[data-testid="carousel-item"]').map((item) => {
        return item.attributes('data-file-name')
      }) as string[]
    }

    it('drops an attached image and warns when unsupported', async () => {
      useSelection(withoutImages)

      const wrapper = await mountChatInput()
      const filesModal = wrapper.findComponent(filesModalStub)

      filesModal.vm.$emit('attach', [imageFile])
      await nextTick()

      expect(attachedFileNames(wrapper)).toEqual([])
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(imageWarning)
    })

    it('drops an attached PDF and warns when unsupported', async () => {
      useSelection(withoutPdf)

      const wrapper = await mountChatInput()
      const filesModal = wrapper.findComponent(filesModalStub)

      filesModal.vm.$emit('attach', [pdfFile])
      await nextTick()

      expect(attachedFileNames(wrapper)).toEqual([])
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(pdfWarning)
    })

    it('keeps a text file when images and PDFs are unsupported', async () => {
      useSelection(textOnly)

      const wrapper = await mountChatInput()
      const filesModal = wrapper.findComponent(filesModalStub)

      filesModal.vm.$emit('attach', [textFile])
      await nextTick()

      expect(attachedFileNames(wrapper)).toEqual(['a.txt'])
      expect(mocks.useWarningMessage).not.toHaveBeenCalled()
    })

    it('strips attached images and PDFs once after the model loses support', async () => {
      const canAttachMediaType = useSelection()

      const wrapper = await mountChatInput()
      const filesModal = wrapper.findComponent(filesModalStub)

      filesModal.vm.$emit('attach', [imageFile, pdfFile, textFile])
      await nextTick()

      expect(attachedFileNames(wrapper)).toEqual(['a.png', 'a.pdf', 'a.txt'])

      canAttachMediaType.value = textOnly
      await nextTick()

      expect(attachedFileNames(wrapper)).toEqual(['a.txt'])
      expect(mocks.useWarningMessage).toHaveBeenCalledTimes(1)
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(combinedWarning)
    })

    it('strips only the PDFs when only PDF support is lost', async () => {
      const canAttachMediaType = useSelection()

      const wrapper = await mountChatInput()
      const filesModal = wrapper.findComponent(filesModalStub)

      filesModal.vm.$emit('attach', [imageFile, pdfFile])
      await nextTick()

      canAttachMediaType.value = withoutPdf
      await nextTick()

      expect(attachedFileNames(wrapper)).toEqual(['a.png'])
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(pdfWarning)
    })
  })

  describe('toggle-mode reasoning', () => {
    function useToggleModeSelection() {
      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(false),
        isToolCallingSupported: shallowRef(false),
        webSearchProviderOptions: shallowRef([]),
        isImageGenerationSupported: shallowRef(false),
        isImageGenerationRequired: shallowRef(false),
        isImageInputSupported: shallowRef(true),
        canAttachMediaType: shallowRef(() => true),
        isReasoningSupported: shallowRef(true),
        isReasoningAlwaysOn: shallowRef(false),
        canDisableReasoningLevel: shallowRef(true),
        reasoningCapability: shallowRef({ mode: 'toggle' }),
        reasoningMode: shallowRef('toggle'),
        reasoningMenuLevels: shallowRef(['medium']),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedTransferProviderId: shallowRef(null),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
        isModelCapabilityResolved: shallowRef(true),
        isSelectedModelUnavailable: shallowRef(false),
      })
    }

    function useLevelsModeSelection() {
      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(false),
        isToolCallingSupported: shallowRef(false),
        webSearchProviderOptions: shallowRef([]),
        isImageGenerationSupported: shallowRef(false),
        isImageGenerationRequired: shallowRef(false),
        isImageInputSupported: shallowRef(true),
        canAttachMediaType: shallowRef(() => true),
        isReasoningSupported: shallowRef(true),
        isReasoningAlwaysOn: shallowRef(false),
        canDisableReasoningLevel: shallowRef(true),
        reasoningCapability: shallowRef({
          mode: 'levels',
          levels: ['low', 'medium', 'high'],
        }),
        reasoningMode: shallowRef('levels'),
        reasoningMenuLevels: shallowRef(['low', 'medium', 'high']),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedTransferProviderId: shallowRef(null),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
        isModelCapabilityResolved: shallowRef(true),
        isSelectedModelUnavailable: shallowRef(false),
      })
    }

    function useDeepResearchSelection() {
      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(false),
        isToolCallingSupported: shallowRef(false),
        webSearchProviderOptions: shallowRef([]),
        isImageGenerationSupported: shallowRef(false),
        isImageGenerationRequired: shallowRef(false),
        isImageInputSupported: shallowRef(true),
        canAttachMediaType: shallowRef(() => true),
        isReasoningSupported: shallowRef(true),
        isReasoningAlwaysOn: shallowRef(false),
        canDisableReasoningLevel: shallowRef(true),
        reasoningCapability: shallowRef({ mode: 'toggle' }),
        reasoningMode: shallowRef('toggle'),
        reasoningMenuLevels: shallowRef(['medium']),
        isDeepResearchModel: shallowRef(true),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedTransferProviderId: shallowRef(null),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
        isModelCapabilityResolved: shallowRef(true),
        isSelectedModelUnavailable: shallowRef(false),
      })
    }

    function bindReasoning(initial: string = 'off') {
      const wrapperRef: { current: ChatInputWrapper | null } = {
        current: null,
      }

      return {
        wrapperRef,
        props: {
          'reasoning': initial,
          'onUpdate:reasoning': (value: string) => {
            wrapperRef.current?.setProps({ reasoning: value })
          },
        },
      }
    }

    it('offers Off and On segments for a toggle-mode model', async () => {
      useToggleModeSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(ariaLabelsOf(wrapper, 'reasoning-level-'))
        .toEqual(['Off', 'On'])
    })

    it('never renders a bare reasoning toggle button for a '
      + 'toggle-mode model', async () => {
      useToggleModeSelection()

      const wrapper = await mountChatInput()

      expect(wrapper.find('[title="Enable reasoning"]').exists())
        .toBe(false)
      expect(wrapper.find('[title="Disable reasoning"]').exists())
        .toBe(false)
    })

    it('passes the model\'s real multi-level array through for a '
      + 'levels-mode model, with no "off" duplicated in it', async () => {
      useLevelsModeSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(ariaLabelsOf(wrapper, 'reasoning-level-'))
        .toEqual(['Off', 'Low', 'Medium', 'High'])
    })

    it('keeps a level pick for this chat only, without writing the default '
      + 'or asking to remember preferences', async () => {
      useLevelsModeSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await pickTestId(wrapper, 'reasoning-level-high')

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['high'])
      expect(mocks.requestPersistence).not.toHaveBeenCalled()
      expect(mocks.setDefaultReasoningLevel).not.toHaveBeenCalled()
      expect(usePreferenceStorage().getItem('settings_reasoning_level'))
        .toBeNull()
    })

    it('shows a Reasoning tile and a Save as default row once the level '
      + 'differs from the default, and saves it on request', async () => {
      useLevelsModeSelection()

      const { wrapperRef, props } = bindReasoning('off')
      const wrapper = await mountChatInput(props)

      wrapperRef.current = wrapper

      await openToolsPanel(wrapper)

      expect(tileOf(wrapper, 'reasoning').exists()).toBe(false)
      expect(hasTestId(wrapper, 'reasoning-save-default-toggle')).toBe(false)

      await pickTestId(wrapper, 'reasoning-level-high')
      await flushPromises()

      expect(tileTitle(wrapper, 'reasoning'))
        .toBe('Reasoning: High. Your default is Off.')
      expect(isTestIdChecked(wrapper, 'reasoning-save-default-toggle'))
        .toBe(false)

      await setToggle(wrapper, 'reasoning-save-default-toggle', true)

      expect(mocks.setDefaultReasoningLevel).toHaveBeenCalledWith('high')

      defaultReasoningLevel.value = 'high'
      await flushPromises()

      expect(tileOf(wrapper, 'reasoning').exists()).toBe(false)
      expect(isTestIdChecked(wrapper, 'reasoning-save-default-toggle'))
        .toBe(true)
    })

    it('compares against the saved server default', async () => {
      useLevelsModeSelection()
      defaultReasoningLevel.value = 'low'

      const wrapper = await mountChatInput({ reasoning: 'low' })

      await flushPromises()

      expect(tileOf(wrapper, 'reasoning').exists()).toBe(false)

      await wrapper.setProps({ reasoning: 'medium' })
      await flushPromises()

      expect(tileTitle(wrapper, 'reasoning'))
        .toBe('Reasoning: Medium. Your default is Low.')
    })

    it('follows a default that loads after mount until the user picks a '
      + 'level', async () => {
      useLevelsModeSelection()

      const { wrapperRef, props } = bindReasoning('off')
      const wrapper = await mountChatInput(props)

      wrapperRef.current = wrapper

      defaultReasoningLevel.value = 'high'
      await flushPromises()

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['high'])
      expect(tileOf(wrapper, 'reasoning').exists()).toBe(false)

      await openToolsPanel(wrapper)
      await pickTestId(wrapper, 'reasoning-level-low')

      defaultReasoningLevel.value = 'medium'
      await flushPromises()

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['low'])
    })

    it('never renders the reasoning section for a deep research model',
      async () => {
        useDeepResearchSelection()

        const wrapper = await mountChatInput()

        await openToolsPanel(wrapper)

        expect(hasTestId(wrapper, 'reasoning-level-off')).toBe(false)
        expect(hasTestId(wrapper, 'reasoning-level-medium')).toBe(false)
        expect(tileOf(wrapper, 'deep-research').exists()).toBe(true)
        expect(
          wrapper.find('[data-testid="chat-input-tile-deep-research-remove"]')
            .exists(),
        ).toBe(false)
      })
  })

  describe('web search provider picker', () => {
    function nativeOption(enabled = true) {
      return {
        value: 'web_search',
        label: 'Model\'s built-in search',
        enabled,
        disabledReason: enabled
          ? undefined
          : 'This model has no built-in web search.',
      }
    }

    function braveOption(enabled = true) {
      return {
        value: 'web_search_brave',
        label: 'Brave Search',
        providerId: 'brave',
        enabled,
        disabledReason: enabled
          ? undefined
          : 'Add a Brave Search key in Search Providers.',
      }
    }

    function exaOption(enabled = true) {
      return {
        value: 'web_search_exa',
        label: 'Exa',
        providerId: 'exa',
        enabled,
        disabledReason: enabled
          ? undefined
          : 'Add an Exa key in Search Providers.',
      }
    }

    function useWebSearchSelection(options: {
      isWebSearchSupported?: boolean
      isToolCallingSupported?: boolean
      webSearchProviderOptions?: ReturnType<typeof nativeOption>[]
    } = {}) {
      const {
        isWebSearchSupported = true,
        isToolCallingSupported = true,
        webSearchProviderOptions = [
          nativeOption(true),
          braveOption(true),
          exaOption(true),
        ],
      } = options

      const isToolCallingSupportedRef = shallowRef(isToolCallingSupported)
      const webSearchProviderOptionsRef = shallowRef(webSearchProviderOptions)

      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(isWebSearchSupported),
        isToolCallingSupported: isToolCallingSupportedRef,
        webSearchProviderOptions: webSearchProviderOptionsRef,
        isImageGenerationSupported: shallowRef(true),
        isImageGenerationRequired: shallowRef(false),
        isImageInputSupported: shallowRef(true),
        canAttachMediaType: shallowRef(() => true),
        isReasoningSupported: shallowRef(false),
        isReasoningAlwaysOn: shallowRef(false),
        canDisableReasoningLevel: shallowRef(true),
        reasoningCapability: shallowRef(null),
        reasoningMode: shallowRef('none'),
        reasoningMenuLevels: shallowRef([]),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedTransferProviderId: shallowRef(null),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
        isModelCapabilityResolved: shallowRef(true),
        isSelectedModelUnavailable: shallowRef(false),
      })

      return { webSearchProviderOptionsRef, isToolCallingSupportedRef }
    }

    it('shows no search tile while nothing is selected', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(tileOf(wrapper, 'search').exists()).toBe(false)
      expect(isTestIdChecked(wrapper, 'web-search-option-off')).toBe(true)
    })

    it('does not render the section when neither native search nor tool '
      + 'calling is supported', async () => {
      useWebSearchSelection({
        isWebSearchSupported: false,
        isToolCallingSupported: false,
        webSearchProviderOptions: [nativeOption(false)],
      })

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(hasTestId(wrapper, 'web-search-option-off')).toBe(false)
    })

    it('lists Off, native search, Brave and Exa in that order', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(ariaLabelsOf(wrapper, 'web-search-option-')).toEqual([
        'Off',
        'Model\'s built-in search',
        'Brave Search',
        'Exa',
      ])
    })

    it('removes Brave and Exa and explains why when the model cannot call '
      + 'tools', async () => {
      useWebSearchSelection({
        isToolCallingSupported: false,
        webSearchProviderOptions: [
          nativeOption(true),
          braveOption(false),
          exaOption(false),
        ],
      })

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(wrapper.get('[data-testid="web-search-no-tool-calling"]').text())
        .toContain('can\'t call tools')
      expect(hasTestId(wrapper, 'web-search-option-web_search_brave'))
        .toBe(false)
      expect(hasTestId(wrapper, 'exa-search-level-auto')).toBe(false)
    })

    it('disables a keyless provider and links to adding its key',
      async () => {
        useWebSearchSelection({
          webSearchProviderOptions: [
            nativeOption(true),
            { ...braveOption(false), addKeyHref: '/profile/keys' },
            exaOption(true),
          ],
        })

        const wrapper = await mountChatInput()

        await openToolsPanel(wrapper)

        expect(isTestIdDisabled(wrapper, 'web-search-option-web_search_brave'))
          .toBe(true)
        expect(wrapper.get('[data-testid="web-search-add-key-brave"]').text())
          .toContain('Add a Brave key')
      })

    it('selects native search and shows a Built-in tile', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await pickTestId(wrapper, 'web-search-option-web_search')

      expect(tileTitle(wrapper, 'search')).toBe('Web search: Built-in')
      expect(isTestIdChecked(wrapper, 'web-search-option-web_search'))
        .toBe(true)
    })

    it('never keeps two search providers selected at once', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await pickTestId(wrapper, 'web-search-option-web_search')
      await pickTestId(wrapper, 'web-search-option-web_search_brave')

      expect(tileTitle(wrapper, 'search')).toBe('Web search: Brave')
      expect(wrapper.emitted('update:tools')?.at(-1))
        .toEqual([['web_search_brave']])
    })

    it('drops the tile when Off is selected', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await pickTestId(wrapper, 'web-search-option-web_search_exa')
      await pickTestId(wrapper, 'web-search-option-off')

      expect(tileOf(wrapper, 'search').exists()).toBe(false)
    })

    it('turns search off from the tile and saves Off as the default',
      async () => {
        useWebSearchSelection()

        const wrapper = await mountChatInput()

        await openToolsPanel(wrapper)
        await pickTestId(wrapper, 'web-search-option-web_search_brave')
        await wrapper.get('[data-testid="chat-input-tile-search-remove"]')
          .trigger('click')
        await nextTick()

        expect(tileOf(wrapper, 'search').exists()).toBe(false)
        expect(usePreferenceStorage().getItem('settings_web_search_tool'))
          .toBe('off')
      })

    it('asks to remember preferences only on an explicit provider pick',
      async () => {
        useWebSearchSelection()

        const wrapper = await mountChatInput()

        await openToolsPanel(wrapper)

        expect(mocks.requestPersistence).not.toHaveBeenCalled()

        await pickTestId(wrapper, 'web-search-option-web_search_brave')

        expect(mocks.requestPersistence).toHaveBeenCalledTimes(1)
      })

    it('persists an explicitly chosen search provider as the new-chat '
      + 'default', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await pickTestId(wrapper, 'web-search-option-web_search_brave')

      expect(usePreferenceStorage().getItem('settings_web_search_tool'))
        .toBe('web_search_brave')
    })

    it('keeps the Exa depth rendered but disabled unless Exa is selected',
      async () => {
        useWebSearchSelection()

        const wrapper = await mountChatInput()

        await openToolsPanel(wrapper)

        expect(isTestIdDisabled(wrapper, 'exa-search-level-auto')).toBe(true)

        await pickTestId(wrapper, 'web-search-option-web_search_exa')

        expect(isTestIdDisabled(wrapper, 'exa-search-level-lite')).toBe(false)
        expect(isTestIdChecked(wrapper, 'exa-search-level-auto')).toBe(true)

        await pickTestId(wrapper, 'web-search-option-web_search_brave')

        expect(isTestIdDisabled(wrapper, 'exa-search-level-auto')).toBe(true)
      })

    it('persists a chosen Exa search level, updates the depth and the '
      + 'tile, and asks to remember preferences', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await pickTestId(wrapper, 'web-search-option-web_search_exa')

      mocks.requestPersistence.mockClear()
      await pickTestId(wrapper, 'exa-search-level-deep')

      expect(usePreferenceStorage().getItem('settings_exa_search_level'))
        .toBe('deep')
      expect(mocks.requestPersistence).toHaveBeenCalledTimes(1)
      expect(isTestIdChecked(wrapper, 'exa-search-level-deep')).toBe(true)
      expect(isTestIdChecked(wrapper, 'exa-search-level-auto')).toBe(false)
      expect(tileTitle(wrapper, 'search')).toBe('Web search: Exa · Deep')
    })

    it('restores the saved Exa search level from storage', async () => {
      useWebSearchSelection()

      usePreferenceStorage().setItem('settings_exa_search_level', 'lite')

      const wrapper = await mountChatInput({ tools: ['web_search_exa'] })

      await openToolsPanel(wrapper)

      expect(isTestIdChecked(wrapper, 'exa-search-level-lite')).toBe(true)
      expect(isTestIdChecked(wrapper, 'exa-search-level-auto')).toBe(false)
    })

    it('follows an Exa search level changed outside the component',
      async () => {
        useWebSearchSelection()

        const wrapper = await mountChatInput({ tools: ['web_search_exa'] })

        await openToolsPanel(wrapper)

        expect(isTestIdChecked(wrapper, 'exa-search-level-auto')).toBe(true)

        usePreferenceStorage().setItem('settings_exa_search_level', 'deep')

        await nextTick()

        expect(isTestIdChecked(wrapper, 'exa-search-level-deep')).toBe(true)
        expect(isTestIdChecked(wrapper, 'exa-search-level-auto')).toBe(false)
      })

    it('falls back to Auto when the saved Exa search level is invalid',
      async () => {
        useWebSearchSelection()

        usePreferenceStorage().setItem(
          'settings_exa_search_level',
          'turbo',
        )

        const wrapper = await mountChatInput({ tools: ['web_search_exa'] })

        await openToolsPanel(wrapper)

        expect(isTestIdChecked(wrapper, 'exa-search-level-auto')).toBe(true)
      })

    it('persists "off" as the new-chat default when the user explicitly '
      + 'clears the selection', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await pickTestId(wrapper, 'web-search-option-web_search_exa')
      await pickTestId(wrapper, 'web-search-option-off')

      expect(usePreferenceStorage().getItem('settings_web_search_tool'))
        .toBe('off')
    })

    it('hides the web search section once image generation is enabled, '
      + 'so a search provider can no longer be chosen alongside it',
    async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await setToggle(wrapper, 'tools-image-toggle', true)

      expect(hasTestId(wrapper, 'web-search-option-off')).toBe(false)
      expect(tileOf(wrapper, 'image').exists()).toBe(true)
    })

    it('clears the search selection and hides the section once image '
      + 'generation is enabled', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await pickTestId(wrapper, 'web-search-option-web_search_brave')
      await setToggle(wrapper, 'tools-image-toggle', true)

      expect(hasTestId(wrapper, 'web-search-option-off')).toBe(false)
      expect(tileOf(wrapper, 'search').exists()).toBe(false)
    })

    it('prunes an external selection once the model loses tool calling '
      + 'or its key', async () => {
      const { webSearchProviderOptionsRef } = useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await pickTestId(wrapper, 'web-search-option-web_search_brave')

      expect(tileTitle(wrapper, 'search')).toBe('Web search: Brave')

      webSearchProviderOptionsRef.value = [
        nativeOption(true),
        braveOption(false),
        exaOption(true),
      ]
      await nextTick()
      await nextTick()

      expect(tileOf(wrapper, 'search').exists()).toBe(false)
    })

    it('does not overwrite the saved new-chat default when a search '
      + 'provider is auto-pruned by a capability change', async () => {
      const { webSearchProviderOptionsRef } = useWebSearchSelection()

      usePreferenceStorage().setItem(
        'settings_web_search_tool',
        'web_search_brave',
      )

      const wrapper = await mountChatInput({ tools: ['web_search_brave'] })

      await nextTick()

      webSearchProviderOptionsRef.value = [
        nativeOption(true),
        braveOption(false),
        exaOption(true),
      ]
      await nextTick()
      await nextTick()

      expect(wrapper.emitted('update:tools')?.at(-1)).toEqual([[]])
      expect(usePreferenceStorage().getItem('settings_web_search_tool'))
        .toBe('web_search_brave')
    })

    it('auto-enables only native search when a URL is pasted, never an '
      + 'external provider', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')

      await textarea.setValue('check this out https://example.com')
      await nextTick()

      expect(tileTitle(wrapper, 'search')).toBe('Web search: Built-in')
    })
  })

  describe('image generation hides reasoning and web search', () => {
    function useMutualExclusionSelection(overrides: {
      isImageGenerationRequired?: boolean
      reasoningCapability?: unknown
      reasoningMenuLevels?: string[]
    } = {}) {
      const isImageGenerationRequired = shallowRef(
        overrides.isImageGenerationRequired ?? false,
      )
      const reasoningCapability = shallowRef(
        overrides.reasoningCapability ?? {
          mode: 'levels',
          levels: ['low', 'medium', 'high'],
        },
      )
      const reasoningMenuLevels = shallowRef(
        overrides.reasoningMenuLevels ?? ['low', 'medium', 'high'],
      )

      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(true),
        isToolCallingSupported: shallowRef(true),
        webSearchProviderOptions: shallowRef([
          {
            value: 'web_search',
            label: 'Model\'s built-in search',
            enabled: true,
          },
        ]),
        isImageGenerationSupported: shallowRef(true),
        isImageGenerationRequired,
        isImageInputSupported: shallowRef(true),
        canAttachMediaType: shallowRef(() => true),
        isReasoningSupported: shallowRef(true),
        isReasoningAlwaysOn: shallowRef(false),
        canDisableReasoningLevel: shallowRef(true),
        reasoningCapability,
        reasoningMode: shallowRef('levels'),
        reasoningMenuLevels,
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedTransferProviderId: shallowRef(null),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
        isModelCapabilityResolved: shallowRef(true),
        isSelectedModelUnavailable: shallowRef(false),
      })

      return { isImageGenerationRequired, reasoningCapability }
    }

    it('forces the default level for a model that cannot disable '
      + 'reasoning and restores off after switching back', async () => {
      const { reasoningCapability } = useMutualExclusionSelection({
        reasoningCapability: {
          mode: 'levels',
          levels: ['low', 'medium', 'high'],
          cannotDisable: true,
          defaultLevel: 'high',
        },
      })

      const wrapper = await mountChatInput({ reasoning: 'off' })
      await nextTick()

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['high'])

      reasoningCapability.value = {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      }
      await nextTick()
      await nextTick()

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['off'])
    })

    it('rounds a level up on a model that lacks it and restores it after '
      + 'switching back', async () => {
      const { reasoningCapability } = useMutualExclusionSelection()

      const wrapper = await mountChatInput({ reasoning: 'medium' })
      await nextTick()

      reasoningCapability.value = {
        mode: 'levels',
        levels: ['low', 'high'],
      }
      await nextTick()
      await nextTick()

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['high'])

      reasoningCapability.value = {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      }
      await nextTick()
      await nextTick()

      expect(wrapper.emitted('update:reasoning')?.at(-1))
        .toEqual(['medium'])
    })

    it('rounds off up to the default level on a model that cannot '
      + 'disable reasoning and lacks medium, then restores off', async () => {
      const { reasoningCapability } = useMutualExclusionSelection()

      const wrapper = await mountChatInput({ reasoning: 'off' })
      await nextTick()

      reasoningCapability.value = {
        mode: 'levels',
        levels: ['low', 'high'],
        cannotDisable: true,
        defaultLevel: 'high',
      }
      await nextTick()
      await nextTick()

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['high'])

      reasoningCapability.value = {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      }
      await nextTick()
      await nextTick()

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['off'])
    })

    it('hides both the reasoning and web search sections once image '
      + 'generation is toggled on, and shows them again once it is '
      + 'toggled off', async () => {
      useMutualExclusionSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(hasTestId(wrapper, 'reasoning-level-off')).toBe(true)
      expect(hasTestId(wrapper, 'web-search-option-off')).toBe(true)

      await setToggle(wrapper, 'tools-image-toggle', true)

      expect(hasTestId(wrapper, 'reasoning-level-off')).toBe(false)
      expect(hasTestId(wrapper, 'web-search-option-off')).toBe(false)
      expect(tileTitle(wrapper, 'image')).toBe('Image creation on')

      await setToggle(wrapper, 'tools-image-toggle', false)

      expect(hasTestId(wrapper, 'reasoning-level-off')).toBe(true)
      expect(hasTestId(wrapper, 'web-search-option-off')).toBe(true)
      expect(tileOf(wrapper, 'image').exists()).toBe(false)
    })

    it('turns image creation off from the tile', async () => {
      useMutualExclusionSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await setToggle(wrapper, 'tools-image-toggle', true)
      await wrapper.get('[data-testid="chat-input-tile-image-remove"]')
        .trigger('click')
      await nextTick()

      expect(tileOf(wrapper, 'image').exists()).toBe(false)
      expect(wrapper.emitted('update:tools')?.at(-1)).toEqual([[]])
    })

    it('hides both sections for an image-only model where image '
      + 'generation is required, with a non-removable image tile',
    async () => {
      useMutualExclusionSelection({ isImageGenerationRequired: true })

      const wrapper = await mountChatInput({ tools: ['image_generation'] })

      await openToolsPanel(wrapper)

      expect(hasTestId(wrapper, 'reasoning-level-off')).toBe(false)
      expect(hasTestId(wrapper, 'web-search-option-off')).toBe(false)
      expect(tileTitle(wrapper, 'image'))
        .toBe('Image creation is required for this model')
      expect(hasTestId(wrapper, 'chat-input-tile-image-remove')).toBe(false)
      expect(isTestIdDisabled(wrapper, 'tools-image-toggle')).toBe(true)
      expect(isTestIdChecked(wrapper, 'tools-image-toggle')).toBe(true)
    })

    it('hides both sections and tiles as soon as image generation is '
      + 'required, even before the tools-forcing watcher has removed the '
      + 'saved search/reasoning tools', async () => {
      useMutualExclusionSelection({ isImageGenerationRequired: true })

      const wrapper = await mountChatInput({
        tools: ['web_search'],
        reasoning: 'high',
      })

      expect(tileOf(wrapper, 'search').exists()).toBe(false)
      expect(tileOf(wrapper, 'reasoning').exists()).toBe(false)

      await openToolsPanel(wrapper)

      expect(hasTestId(wrapper, 'reasoning-level-off')).toBe(false)
      expect(hasTestId(wrapper, 'web-search-option-off')).toBe(false)
    })

    it('sets the live reasoning level off when image generation is '
      + 'enabled, without writing a new saved default', async () => {
      useMutualExclusionSelection()
      usePreferenceStorage().setItem('settings_reasoning_level', 'medium')

      const wrapper = await mountChatInput({ reasoning: 'medium' })
      await nextTick()

      await openToolsPanel(wrapper)
      await setToggle(wrapper, 'tools-image-toggle', true)

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['off'])
      expect(usePreferenceStorage().getItem('settings_reasoning_level'))
        .toBe('medium')
    })

    it('restores the saved reasoning level once image generation is '
      + 'disabled again, still without touching the saved default',
    async () => {
      useMutualExclusionSelection()
      usePreferenceStorage().setItem('settings_reasoning_level', 'medium')

      const wrapper = await mountChatInput({ reasoning: 'medium' })
      await nextTick()

      await openToolsPanel(wrapper)
      await setToggle(wrapper, 'tools-image-toggle', true)
      await setToggle(wrapper, 'tools-image-toggle', false)

      expect(wrapper.emitted('update:reasoning')?.map((args) => {
        return args[0]
      })).toEqual(['off', 'medium'])
      expect(usePreferenceStorage().getItem('settings_reasoning_level'))
        .toBe('medium')
    })

    it('clamps the restored reasoning level to off when the saved '
      + 'default is no longer supported by the model', async () => {
      const { reasoningCapability } = useMutualExclusionSelection()

      usePreferenceStorage().setItem('settings_reasoning_level', 'medium')

      const wrapper = await mountChatInput({ reasoning: 'medium' })
      await nextTick()

      await openToolsPanel(wrapper)
      await setToggle(wrapper, 'tools-image-toggle', true)

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['off'])

      reasoningCapability.value = { mode: 'levels', levels: ['low'] }
      await nextTick()

      await setToggle(wrapper, 'tools-image-toggle', false)

      const reasoningEmissions = wrapper.emitted('update:reasoning')?.map(
        (args) => {
          return args[0]
        },
      ) ?? []

      expect(reasoningEmissions).not.toContain('medium')
    })
  })

  describe('gateway capability resolution gating', () => {
    function useGatewayCapabilitySelection(overrides: {
      isReasoningSupported?: boolean
      reasoningCapability?: unknown
      isModelCapabilityResolved?: boolean
      webSearchProviderOptions?: unknown[]
      isImageGenerationSupported?: boolean
      isImageGenerationRequired?: boolean
    } = {}) {
      const isReasoningSupported = shallowRef(
        overrides.isReasoningSupported ?? false,
      )
      const reasoningCapability = shallowRef(
        overrides.reasoningCapability ?? null,
      )
      const isModelCapabilityResolved = shallowRef(
        overrides.isModelCapabilityResolved ?? false,
      )
      const webSearchProviderOptions = shallowRef(
        overrides.webSearchProviderOptions ?? [],
      )
      const isImageGenerationSupported = shallowRef(
        overrides.isImageGenerationSupported ?? false,
      )
      const isImageGenerationRequired = shallowRef(
        overrides.isImageGenerationRequired ?? false,
      )

      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(false),
        isToolCallingSupported: shallowRef(false),
        webSearchProviderOptions,
        isImageGenerationSupported,
        isImageGenerationRequired,
        isImageInputSupported: shallowRef(true),
        canAttachMediaType: shallowRef(() => true),
        isReasoningSupported,
        isReasoningAlwaysOn: shallowRef(false),
        canDisableReasoningLevel: shallowRef(true),
        reasoningCapability,
        reasoningMode: shallowRef('none'),
        reasoningMenuLevels: shallowRef([]),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedTransferProviderId: shallowRef(null),
        selectedModelKeyOwnerLabel: shallowRef('OpenRouter'),
        isModelCapabilityResolved,
        isSelectedModelUnavailable: shallowRef(false),
      })

      return {
        isReasoningSupported,
        reasoningCapability,
        isModelCapabilityResolved,
        webSearchProviderOptions,
        isImageGenerationSupported,
        isImageGenerationRequired,
      }
    }

    it('keeps a persisted reasoning level untouched while the gateway '
      + 'catalog fetch is pending', async () => {
      useGatewayCapabilitySelection({ isModelCapabilityResolved: false })

      const wrapper = await mountChatInput({ reasoning: 'high' })

      await nextTick()

      expect(wrapper.emitted('update:reasoning')).toBeUndefined()
    })

    it('keeps the reasoning level once the catalog resolves and confirms '
      + 'the model supports reasoning', async () => {
      const state = useGatewayCapabilitySelection({
        isModelCapabilityResolved: false,
      })

      const wrapper = await mountChatInput({ reasoning: 'high' })

      await nextTick()

      state.isReasoningSupported.value = true
      state.reasoningCapability.value = {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      }
      state.isModelCapabilityResolved.value = true
      await nextTick()

      expect(wrapper.emitted('update:reasoning')).toBeUndefined()
    })

    it('resets the reasoning level to off once the catalog resolves and '
      + 'the model does not support reasoning', async () => {
      const state = useGatewayCapabilitySelection({
        isModelCapabilityResolved: false,
      })

      const wrapper = await mountChatInput({ reasoning: 'high' })

      await nextTick()

      state.isModelCapabilityResolved.value = true
      await nextTick()

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['off'])
    })

    it('does not overwrite the saved reasoning default when the level '
      + 'is auto-reset by a capability change', async () => {
      usePreferenceStorage().setItem('settings_reasoning_level', 'high')

      const state = useGatewayCapabilitySelection({
        isModelCapabilityResolved: false,
      })

      const wrapper = await mountChatInput({ reasoning: 'high' })

      await nextTick()

      state.isModelCapabilityResolved.value = true
      await nextTick()

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['off'])
      expect(usePreferenceStorage().getItem('settings_reasoning_level'))
        .toBe('high')
    })

    it('keeps a carried-over web search tool while the gateway catalog '
      + 'fetch is pending', async () => {
      useGatewayCapabilitySelection({ isModelCapabilityResolved: false })

      const wrapper = await mountChatInput({ tools: ['web_search'] })

      await nextTick()

      expect(wrapper.emitted('update:tools')).toBeUndefined()
    })

    it('strips the web search tool once the catalog resolves without '
      + 'search support', async () => {
      const state = useGatewayCapabilitySelection({
        isModelCapabilityResolved: false,
      })

      const wrapper = await mountChatInput({ tools: ['web_search'] })

      await nextTick()

      state.isModelCapabilityResolved.value = true
      await nextTick()

      expect(wrapper.emitted('update:tools')?.at(-1)).toEqual([[]])
    })

    it('leaves reasoning and tools untouched when the catalog fetch '
      + 'fails and capability never resolves', async () => {
      useGatewayCapabilitySelection({ isModelCapabilityResolved: false })

      const wrapper = await mountChatInput({
        reasoning: 'high',
        tools: ['web_search'],
      })

      await nextTick()
      await nextTick()

      expect(wrapper.emitted('update:reasoning')).toBeUndefined()
      expect(wrapper.emitted('update:tools')).toBeUndefined()
    })

    it('forces image_generation once a gateway image-only model '
      + 'resolves, overriding a saved Brave default seeded before '
      + 'resolution', async () => {
      const state = useGatewayCapabilitySelection({
        isModelCapabilityResolved: false,
        webSearchProviderOptions: [
          {
            value: 'web_search_brave',
            label: 'Brave Search',
            providerId: 'brave',
            enabled: true,
          },
        ],
      })

      const wrapper = await mountChatInput({
        tools: ['web_search_brave'],
        reasoning: 'low',
      })

      await nextTick()

      state.isImageGenerationSupported.value = true
      state.isImageGenerationRequired.value = true
      state.isModelCapabilityResolved.value = true
      await nextTick()
      await nextTick()

      expect(wrapper.emitted('update:tools')?.at(-1)).toEqual([
        ['image_generation'],
      ])
    })

    it('forces image_generation when the catalog is already '
      + 'resolved at mount time (pre-warmed cache)', async () => {
      useGatewayCapabilitySelection({
        isModelCapabilityResolved: true,
        isImageGenerationSupported: true,
        isImageGenerationRequired: true,
        webSearchProviderOptions: [
          {
            value: 'web_search_brave',
            label: 'Brave Search',
            providerId: 'brave',
            enabled: true,
          },
        ],
      })

      const wrapper = await mountChatInput({
        tools: ['web_search_brave'],
        reasoning: 'low',
      })

      await nextTick()
      await nextTick()

      expect(wrapper.emitted('update:tools')?.at(-1)).toEqual([
        ['image_generation'],
      ])
    })
  })

  describe('unavailable gateway model guidance', () => {
    function useUnavailableGatewaySelection() {
      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(false),
        isToolCallingSupported: shallowRef(false),
        webSearchProviderOptions: shallowRef([]),
        isImageGenerationSupported: shallowRef(false),
        isImageGenerationRequired: shallowRef(false),
        isImageInputSupported: shallowRef(true),
        canAttachMediaType: shallowRef(() => true),
        isReasoningSupported: shallowRef(false),
        isReasoningAlwaysOn: shallowRef(false),
        canDisableReasoningLevel: shallowRef(true),
        reasoningCapability: shallowRef(null),
        reasoningMode: shallowRef('none'),
        reasoningMenuLevels: shallowRef([]),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedTransferProviderId: shallowRef(null),
        selectedModelKeyOwnerLabel: shallowRef('OpenRouter'),
        isModelCapabilityResolved: shallowRef(true),
        isSelectedModelUnavailable: shallowRef(true),
      })
    }

    it('names the gateway and blocks send without deadening the button',
      async () => {
        useUnavailableGatewaySelection()

        const wrapper = await mountChatInput()

        await wrapper.get('textarea').setValue('hello')

        const sendButton = wrapper.get('[data-testid="send-message"]')

        expect(sendButton.attributes('title')).toBe(
          'This model is no longer available on OpenRouter. '
          + 'Pick another model.',
        )
        expect(sendButton.attributes('disabled')).toBeUndefined()
      })

    it('warns instead of sending when the send button is pressed',
      async () => {
        useUnavailableGatewaySelection()

        const wrapper = await mountChatInput()

        await wrapper.get('textarea').setValue('hello')
        await wrapper.get('[data-testid="send-message"]').trigger('click')

        expect(mocks.useWarningMessage).toHaveBeenCalledWith(
          'This model is no longer available on OpenRouter. '
          + 'Pick another model.',
          'Open the model picker and choose another model to continue.',
        )
        expect(wrapper.emitted('submit')).toBeUndefined()
      })
  })

  describe('reasoning control states', () => {
    function useReasoningSelection(input: {
      state: 'configurable' | 'always-on' | 'none'
      isImageGenerationRequired?: boolean
    }) {
      const isConfigurable = input.state === 'configurable'

      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(false),
        isToolCallingSupported: shallowRef(false),
        webSearchProviderOptions: shallowRef([]),
        isImageGenerationSupported: shallowRef(
          !!input.isImageGenerationRequired,
        ),
        isImageGenerationRequired: shallowRef(
          !!input.isImageGenerationRequired,
        ),
        isImageInputSupported: shallowRef(true),
        canAttachMediaType: shallowRef(() => true),
        isReasoningSupported: shallowRef(isConfigurable),
        isReasoningAlwaysOn: shallowRef(input.state === 'always-on'),
        canDisableReasoningLevel: shallowRef(true),
        reasoningCapability: shallowRef(isConfigurable
          ? { mode: 'levels', levels: ['low', 'medium', 'high'] }
          : null),
        reasoningMode: shallowRef(isConfigurable ? 'levels' : 'none'),
        reasoningMenuLevels: shallowRef(isConfigurable
          ? ['low', 'medium', 'high']
          : []),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedTransferProviderId: shallowRef(null),
        selectedModelKeyOwnerLabel: shallowRef('xAI'),
        isModelCapabilityResolved: shallowRef(true),
        isSelectedModelUnavailable: shallowRef(false),
      })
    }

    it('renders the selectable effort levels and no always-on row for a '
      + 'configurable model', async () => {
      useReasoningSelection({ state: 'configurable' })

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(hasTestId(wrapper, 'reasoning-level-low')).toBe(true)
      expect(hasTestId(wrapper, 'reasoning-always-on-menu-item')).toBe(false)
      expect(hasTestId(wrapper, 'reasoning-expanded-toggle')).toBe(true)
      expect(isTestIdDisabled(wrapper, 'reasoning-expanded-toggle'))
        .toBe(true)
      expect(isTestIdDisabled(wrapper, 'reasoning-auto-hide-toggle'))
        .toBe(true)
    })

    it('renders a checked and disabled reasoning row for an always-on '
      + 'model', async () => {
      useReasoningSelection({ state: 'always-on' })

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      const toggle = wrapper.get(
        '[data-testid="reasoning-always-on-menu-item"]',
      )

      expect((toggle.element as HTMLInputElement).checked).toBe(true)
      expect((toggle.element as HTMLInputElement).disabled).toBe(true)
      expect(toggle.attributes('aria-label'))
        .toBe('Reasoning is always on for this model')
      expect(hasTestId(wrapper, 'reasoning-level-low')).toBe(false)
      expect(tileOf(wrapper, 'reasoning').exists()).toBe(false)
    })

    it('keeps the reasoning level unchanged when the always-on row '
      + 'is clicked', async () => {
      useReasoningSelection({ state: 'always-on' })

      const wrapper = await mountChatInput({ reasoning: 'off' })

      await openToolsPanel(wrapper)
      await wrapper.get('[data-testid="reasoning-always-on-menu-item"]')
        .trigger('click')
      await nextTick()

      expect(wrapper.emitted('update:reasoning') ?? []).not.toContainEqual([
        'low',
      ])
      expect(wrapper.emitted('update:reasoning') ?? []).not.toContainEqual([
        'medium',
      ])
      expect(wrapper.emitted('update:reasoning') ?? []).not.toContainEqual([
        'high',
      ])
      expect(usePreferenceStorage().getItem('settings_reasoning_level'))
        .toBeNull()
    })

    it('renders no reasoning control at all for a model that does not '
      + 'reason', async () => {
      useReasoningSelection({ state: 'none' })

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(hasTestId(wrapper, 'reasoning-level-off')).toBe(false)
      expect(hasTestId(wrapper, 'reasoning-always-on-menu-item')).toBe(false)
    })

    it('hides the always-on reasoning row while image generation is '
      + 'required', async () => {
      useReasoningSelection({
        state: 'always-on',
        isImageGenerationRequired: true,
      })

      const wrapper = await mountChatInput({ tools: ['image_generation'] })

      await openToolsPanel(wrapper)

      expect(hasTestId(wrapper, 'reasoning-always-on-menu-item')).toBe(false)
    })
  })

  describe('tools menu', () => {
    it('opens as a popover and closes on Escape, returning focus to "+"',
      async () => {
        const wrapper = await mountChatInput()
        const trigger = wrapper.get('[data-testid="chat-input-tools-trigger"]')

        expect(trigger.attributes('aria-expanded')).toBe('false')

        await openToolsPanel(wrapper)

        const panel = wrapper.get('[data-testid="chat-input-tools-panel"]')

        expect(trigger.attributes('aria-expanded')).toBe('true')
        expect(panel.attributes('role')).toBe('dialog')
        expect(panel.isVisible()).toBe(true)

        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape',
        }))
        await flushPromises()

        expect(trigger.attributes('aria-expanded')).toBe('false')
        expect(document.activeElement).toBe(trigger.element)
      })

    it('closes after an action and opens the files modal', async () => {
      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      await wrapper.get('[data-testid="tools-action-attach"]')
        .trigger('click')
      await flushPromises()

      expect(filesModalOpenMock).toHaveBeenCalledWith('upload', undefined)
      expect(
        wrapper.get('[data-testid="chat-input-tools-trigger"]')
          .attributes('aria-expanded'),
      ).toBe('false')

      await openToolsPanel(wrapper)
      await wrapper.get('[data-testid="tools-action-library"]')
        .trigger('click')

      expect(filesModalOpenMock).toHaveBeenLastCalledWith('select', undefined)

      await openToolsPanel(wrapper)
      await wrapper.get('[data-testid="tools-action-generated"]')
        .trigger('click')

      expect(filesModalOpenMock)
        .toHaveBeenLastCalledWith('select', 'assistant')
    })

    it('opens the project picker and labels the row by chat state',
      async () => {
        mockRoute.path = '/chats/new'

        const wrapper = await mountChatInput({
          displayProjectPicker: true,
          projectContext: { id: 'p1', name: 'Roadmap' },
        })

        expect(tileTitle(wrapper, 'project')).toBe('Project: Roadmap')

        await openToolsPanel(wrapper)

        const row = wrapper.get('[data-testid="tools-project"]')

        expect(row.text()).toContain('Project')
        expect(row.text()).toContain('Roadmap')

        await row.trigger('click')

        expect(wrapper.emitted('open-project-picker')).toHaveLength(1)

        await wrapper.get('[data-testid="chat-input-tile-project-remove"]')
          .trigger('click')

        expect(wrapper.emitted('clear-project-context')).toHaveLength(1)
      })

    it('offers Move to project on an existing chat', async () => {
      const wrapper = await mountChatInput({ displayProjectPicker: true })

      await openToolsPanel(wrapper)

      expect(wrapper.get('[data-testid="tools-project"]').text())
        .toContain('Move to project')
    })

    it('hides the Add section for a deep research model', async () => {
      mocks.useChatInput.mockReturnValue({
        ...mocks.useChatInput(),
        isDeepResearchModel: shallowRef(true),
        researchConfig: shallowRef({
          tier: 'thorough',
          assistModel: 'o4-mini',
          costEstimate: '~$1',
          timeEstimate: '5-30 min',
        }),
      })

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(hasTestId(wrapper, 'tools-action-attach')).toBe(false)
      expect(wrapper.get('[data-testid="tools-deep-research-note"]').text())
        .toContain('~$1 · 5-30 min')
    })

    it('opens the menu at a section when a tile is clicked', async () => {
      const wrapper = await mountChatInput({
        memoryExcluded: true,
      })

      await wrapper.get('[data-testid="chat-input-tile-memory-body"]')
        .trigger('click')
      await flushPromises()

      expect(
        wrapper.get('[data-testid="chat-input-tools-trigger"]')
          .attributes('aria-expanded'),
      ).toBe('true')
      expect(document.activeElement).toBe(
        wrapper.get('[data-testid="new-chat-memory-toggle"]').element,
      )
    })

    it('uses a bottom sheet below md', async () => {
      isPopoverLayout.value = false

      const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
        .mockImplementation(function (this: HTMLDialogElement) {
          this.setAttribute('open', '')
        })
      const wrapper = await mountChatInput({ memoryExcluded: true })

      await openToolsPanel(wrapper)

      const sheet = wrapper.get('[data-testid="chat-input-tools-panel"]')

      expect(sheet.element.tagName).toBe('DIALOG')
      expect(sheet.classes()).toContain('modal-bottom')
      expect(showModal).toHaveBeenCalledOnce()
      expect(wrapper.get('[data-testid="chat-input-tools-chip-memory"]')
        .text()).toContain('Memory off')

      await wrapper.get('[data-testid="chat-input-tools-chip-memory-remove"]')
        .trigger('click')

      expect(wrapper.emitted('update:memoryExcluded')?.at(-1))
        .toEqual([false])

      showModal.mockRestore()
    })
  })

  describe('memory exclusion for a new chat', () => {
    it('is not offered when the page does not bind it', async () => {
      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(hasTestId(wrapper, 'new-chat-memory-toggle')).toBe(false)
      expect(tileOf(wrapper, 'memory').exists()).toBe(false)
    })

    it('uses memory by default, shows a Memory off tile once unchecked, '
      + 'and turns memory back on from the tile', async () => {
      const wrapper = await mountChatInput({
        'memoryExcluded': false,
        'onUpdate:memoryExcluded': (value: boolean) => {
          wrapper.setProps({ memoryExcluded: value })
        },
      })

      await openToolsPanel(wrapper)

      expect(isTestIdChecked(wrapper, 'new-chat-memory-toggle')).toBe(true)
      expect(tileOf(wrapper, 'memory').exists()).toBe(false)

      await setToggle(wrapper, 'new-chat-memory-toggle', false)

      expect(wrapper.emitted('update:memoryExcluded')).toEqual([[true]])
      expect(tileOf(wrapper, 'memory').text()).toContain('Off')

      await wrapper.get('[data-testid="chat-input-tile-memory-remove"]')
        .trigger('click')

      expect(wrapper.emitted('update:memoryExcluded')?.at(-1))
        .toEqual([false])
    })
  })
})

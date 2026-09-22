import type { Ref } from 'vue'
import { computed, defineComponent, nextTick, reactive, shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatInput from '../../../app/components/ChatInput.client.vue'
import { useFilesModalHandoff } from '../../../app/composables/files-modal-handoff'

const mocks = vi.hoisted(() => ({
  useChatInput: vi.fn(),
  useChatFiles: vi.fn(),
  useDevice: vi.fn(),
  uploadFiles: vi.fn(),
  useWarningMessage: vi.fn(),
}))

mockNuxtImport('useChatInput', () => mocks.useChatInput)
mockNuxtImport('useChatFiles', () => mocks.useChatFiles)
mockNuxtImport('useDevice', () => mocks.useDevice)
mockNuxtImport('useWarningMessage', () => mocks.useWarningMessage)

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

function mountChatInput() {
  return mountSuspended(ChatInput, {
    props: {
      messagesLength: 0,
      stop: vi.fn(),
      regenerate: vi.fn(),
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

    mocks.useChatInput.mockReturnValue({
      isWebSearchSupported: shallowRef(false),
      isToolCallingSupported: shallowRef(false),
      webSearchProviderOptions: shallowRef([]),
      isImageGenerationSupported: shallowRef(false),
      isImageGenerationRequired: shallowRef(false),
      isImageInputSupported: shallowRef(true),
      isReasoningSupported: shallowRef(false),
      reasoningCapability: shallowRef(null),
      reasoningMode: shallowRef('none'),
      reasoningMenuLevels: shallowRef([]),
      isDeepResearchModel: shallowRef(false),
      researchConfig: shallowRef(null),
      isSelectedModelKeyless: shallowRef(false),
      selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
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

    useFilesModalHandoff().clearPendingOpen()
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
        isReasoningSupported: shallowRef(false),
        reasoningCapability: shallowRef(null),
        reasoningMode: shallowRef('none'),
        reasoningMenuLevels: shallowRef([]),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(true),
        selectedModelKeyOwnerLabel: shallowRef('Anthropic'),
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

      expect(mocks.useWarningMessage).not.toHaveBeenCalled()
      expect(wrapper.emitted('submit')).toHaveLength(1)
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

  describe('image-input gating', () => {
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
    const expectedWarning = 'This model does not support image input. '
      + 'Attach a PDF or text file instead, or switch models.'

    function useSelection(
      isImageInputSupported: Ref<boolean> = shallowRef(true),
    ) {
      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(false),
        isToolCallingSupported: shallowRef(false),
        webSearchProviderOptions: shallowRef([]),
        isImageGenerationSupported: shallowRef(false),
        isImageGenerationRequired: shallowRef(false),
        isImageInputSupported,
        isReasoningSupported: shallowRef(false),
        reasoningCapability: shallowRef(null),
        reasoningMode: shallowRef('none'),
        reasoningMenuLevels: shallowRef([]),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
      })

      return isImageInputSupported
    }

    function attachedFileNames(wrapper: Awaited<ReturnType<
      typeof mountChatInput
    >>): string[] {
      return wrapper.findAll('[data-testid="carousel-item"]').map((item) => {
        return item.attributes('data-file-name')
      }) as string[]
    }

    it('drops an attached image and warns when unsupported', async () => {
      useSelection(shallowRef(false))

      const wrapper = await mountChatInput()
      const filesModal = wrapper.findComponent(filesModalStub)

      filesModal.vm.$emit('attach', [imageFile])
      await nextTick()

      expect(attachedFileNames(wrapper)).toEqual([])
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(expectedWarning)
    })

    it('keeps a non-image file when image input is unsupported', async () => {
      useSelection(shallowRef(false))

      const wrapper = await mountChatInput()
      const filesModal = wrapper.findComponent(filesModalStub)

      filesModal.vm.$emit('attach', [textFile])
      await nextTick()

      expect(attachedFileNames(wrapper)).toEqual(['a.txt'])
      expect(mocks.useWarningMessage).not.toHaveBeenCalled()
    })

    it('strips an already-attached image after the model loses support', async () => {
      const isImageInputSupported = useSelection()

      const wrapper = await mountChatInput()
      const filesModal = wrapper.findComponent(filesModalStub)

      filesModal.vm.$emit('attach', [imageFile])
      await nextTick()

      expect(attachedFileNames(wrapper)).toEqual(['a.png'])

      isImageInputSupported.value = false
      await nextTick()

      expect(attachedFileNames(wrapper)).toEqual([])
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(expectedWarning)
    })
  })

  describe('toggle-mode reasoning', () => {
    function reasoningLevelButtonTexts(
      wrapper: Awaited<ReturnType<typeof mountChatInput>>,
    ): string[] {
      const trigger = wrapper.get('[data-testid="reasoning-trigger"]')
      const dropdown = trigger.element.closest('details')

      return Array.from(
        dropdown?.querySelectorAll('.menu li > button') ?? [],
      ).map(button => button.textContent?.trim() ?? '')
    }

    function useToggleModeSelection() {
      mocks.useChatInput.mockReturnValue({
        isWebSearchSupported: shallowRef(false),
        isToolCallingSupported: shallowRef(false),
        webSearchProviderOptions: shallowRef([]),
        isImageGenerationSupported: shallowRef(false),
        isImageGenerationRequired: shallowRef(false),
        isImageInputSupported: shallowRef(true),
        isReasoningSupported: shallowRef(true),
        reasoningCapability: shallowRef({ mode: 'toggle' }),
        reasoningMode: shallowRef('toggle'),
        reasoningMenuLevels: shallowRef(['medium']),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
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
        isReasoningSupported: shallowRef(true),
        reasoningCapability: shallowRef({
          mode: 'levels',
          levels: ['low', 'medium', 'high'],
        }),
        reasoningMode: shallowRef('levels'),
        reasoningMenuLevels: shallowRef(['low', 'medium', 'high']),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
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
        isReasoningSupported: shallowRef(true),
        reasoningCapability: shallowRef({ mode: 'toggle' }),
        reasoningMode: shallowRef('toggle'),
        reasoningMenuLevels: shallowRef(['medium']),
        isDeepResearchModel: shallowRef(true),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
      })
    }

    it('renders the reasoning trigger with an effective Off/On level '
      + 'list for a toggle-mode model', async () => {
      useToggleModeSelection()

      const wrapper = await mountChatInput()
      const levelButtonTexts = reasoningLevelButtonTexts(wrapper)

      expect(levelButtonTexts).toEqual(['off', 'On'])
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
      const levelButtonTexts = reasoningLevelButtonTexts(wrapper)

      expect(levelButtonTexts).toEqual(['off', 'low', 'medium', 'high'])
    })

    it('never renders the reasoning trigger for a deep research model',
      async () => {
        useDeepResearchSelection()

        const wrapper = await mountChatInput()

        expect(
          wrapper.find('[data-testid="reasoning-trigger"]').exists(),
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
          : 'Add a Brave Search key in Search providers.',
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
          : 'Add an Exa key in Search providers.',
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
        isReasoningSupported: shallowRef(false),
        reasoningCapability: shallowRef(null),
        reasoningMode: shallowRef('none'),
        reasoningMenuLevels: shallowRef([]),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
      })

      return { webSearchProviderOptionsRef, isToolCallingSupportedRef }
    }

    function webSearchDropdown(
      wrapper: Awaited<ReturnType<typeof mountChatInput>>,
    ) {
      const trigger = wrapper.get('[data-testid="web-search-trigger"]')

      return trigger.element.closest('details')
    }

    function webSearchOptionButtons(
      wrapper: Awaited<ReturnType<typeof mountChatInput>>,
    ) {
      const dropdown = webSearchDropdown(wrapper)

      return Array.from(
        dropdown?.querySelectorAll('.menu li > button') ?? [],
      ) as HTMLButtonElement[]
    }

    function webSearchOptionLabel(button: HTMLButtonElement): string {
      return button.querySelector(':scope > span:last-child')
        ?.textContent?.trim() ?? ''
    }

    function clickWebSearchOption(
      wrapper: Awaited<ReturnType<typeof mountChatInput>>,
      label: string,
    ) {
      const button = webSearchOptionButtons(wrapper).find((candidate) => {
        return webSearchOptionLabel(candidate) === label
      })

      if (!button) {
        throw new Error(`No web search option button labelled "${label}"`)
      }

      button.dispatchEvent(new Event('click', { bubbles: true }))
    }

    it('renders a ghost circle globe when nothing is selected', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()
      const trigger = wrapper.get('[data-testid="web-search-trigger"]')

      expect(trigger.classes()).toContain('btn-circle')
      expect(trigger.text()).toBe('')
    })

    it('does not render the trigger when neither native search nor tool '
      + 'calling is supported', async () => {
      useWebSearchSelection({
        isWebSearchSupported: false,
        isToolCallingSupported: false,
        webSearchProviderOptions: [nativeOption(false)],
      })

      const wrapper = await mountChatInput()

      expect(
        wrapper.find('[data-testid="web-search-trigger"]').exists(),
      ).toBe(false)
    })

    it('lists Off, native search, Brave and Exa in that order', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()
      const labels = webSearchOptionButtons(wrapper).map(webSearchOptionLabel)

      expect(labels).toEqual([
        'Off',
        'Model\'s built-in search',
        'Brave Search',
        'Exa',
      ])
    })

    it('collapses Brave and Exa into one explanatory line when the model '
      + 'cannot call tools', async () => {
      useWebSearchSelection({
        isToolCallingSupported: false,
        webSearchProviderOptions: [
          nativeOption(true),
          braveOption(false),
          exaOption(false),
        ],
      })

      const wrapper = await mountChatInput()
      const dropdown = webSearchDropdown(wrapper)

      expect(dropdown?.textContent).toContain(
        'does not support tool calling',
      )
      expect(
        webSearchOptionButtons(wrapper).some((button) => {
          return webSearchOptionLabel(button) === 'Brave Search'
        }),
      ).toBe(false)
    })

    it('selects native search and collapses to an active pill', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      clickWebSearchOption(wrapper, 'Model\'s built-in search')
      await nextTick()

      const trigger = wrapper.get('[data-testid="web-search-trigger"]')

      expect(trigger.text()).toContain('Search')
      expect(trigger.classes()).not.toContain('btn-circle')
    })

    it('never keeps two search providers selected at once', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      clickWebSearchOption(wrapper, 'Model\'s built-in search')
      await nextTick()
      clickWebSearchOption(wrapper, 'Brave Search')
      await nextTick()

      const trigger = wrapper.get('[data-testid="web-search-trigger"]')

      expect(trigger.text()).toContain('Brave')
      expect(trigger.text()).not.toContain('Search')
    })

    it('returns to a ghost circle globe when Off is selected', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      clickWebSearchOption(wrapper, 'Exa')
      await nextTick()
      clickWebSearchOption(wrapper, 'Off')
      await nextTick()

      const trigger = wrapper.get('[data-testid="web-search-trigger"]')

      expect(trigger.classes()).toContain('btn-circle')
    })

    it('turns off image generation once a search provider is chosen',
      async () => {
        useWebSearchSelection()

        const wrapper = await mountChatInput()

        await wrapper.get('[title="Create an image"]').trigger('click')

        clickWebSearchOption(wrapper, 'Brave Search')
        await nextTick()

        expect(
          wrapper.find('[title="Image creation is required for this model"]')
            .exists(),
        ).toBe(false)
        expect(
          wrapper.find('[title="Disable image creation"]').exists(),
        ).toBe(false)
      })

    it('clears the search selection once image generation is enabled',
      async () => {
        useWebSearchSelection()

        const wrapper = await mountChatInput()

        clickWebSearchOption(wrapper, 'Brave Search')
        await nextTick()

        await wrapper.get('[title="Create an image"]').trigger('click')
        await nextTick()

        const trigger = wrapper.get('[data-testid="web-search-trigger"]')

        expect(trigger.classes()).toContain('btn-circle')
      })

    it('prunes an external selection once the model loses tool calling '
      + 'or its key', async () => {
      const { webSearchProviderOptionsRef } = useWebSearchSelection()

      const wrapper = await mountChatInput()

      clickWebSearchOption(wrapper, 'Brave Search')
      await nextTick()

      let trigger = wrapper.get('[data-testid="web-search-trigger"]')

      expect(trigger.text()).toContain('Brave')

      webSearchProviderOptionsRef.value = [
        nativeOption(true),
        braveOption(false),
        exaOption(true),
      ]
      await nextTick()
      await nextTick()

      trigger = wrapper.get('[data-testid="web-search-trigger"]')

      expect(trigger.classes()).toContain('btn-circle')
      expect(trigger.text()).toBe('')
    })

    it('auto-enables only native search when a URL is pasted, never an '
      + 'external provider', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')

      await textarea.setValue('check this out https://example.com')
      await nextTick()

      const trigger = wrapper.get('[data-testid="web-search-trigger"]')

      expect(trigger.text()).toContain('Search')
      expect(trigger.text()).not.toContain('Brave')
      expect(trigger.text()).not.toContain('Exa')
    })
  })
})

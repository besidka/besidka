import { computed, defineComponent, nextTick, reactive, shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createInputMediaTypePredicate } from '#shared/utils/input-media-types'
import { MAX_USER_MESSAGE_TEXT_LENGTH } from '#shared/utils/chat-message-limits'
import ChatInput from '../../../app/components/ChatInput.client.vue'
import { useFilesModalHandoff } from '../../../app/composables/files-modal-handoff'
import { usePreferenceStorage } from '../../../app/composables/preference-storage'
import { usePastedTexts } from '../../../app/composables/pasted-texts'
import { LONG_PASTE_MIN_CHARACTERS } from '../../../app/composables/markdown-textarea'
import { MAX_PASTED_TEXTS } from '../../../app/utils/pasted-text'
import { REVEAL_GUARD_DURATION_MS } from '../../../app/composables/reveal-guard'

const mocks = vi.hoisted(() => ({
  useChatInput: vi.fn(),
  useChatFiles: vi.fn(),
  useDevice: vi.fn(),
  uploadFiles: vi.fn(),
  useWarningMessage: vi.fn(),
  useErrorMessage: vi.fn(),
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
mockNuxtImport('useErrorMessage', () => mocks.useErrorMessage)
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
const keyboardInset = shallowRef<number>(0)
const safeAreaBottom = shallowRef<number>(0)

mockNuxtImport('useVisualViewportInset', () => {
  return () => ({
    bottomInset: keyboardInset,
    viewportHeight: shallowRef<number>(800),
    isKeyboardOpen: computed<boolean>(() => keyboardInset.value >= 120),
    update: vi.fn(),
  })
})

mockNuxtImport('useDeviceSafeArea', () => {
  return () => ({
    safeAreaTop: computed<number>(() => 0),
    safeAreaBottom: computed<number>(() => safeAreaBottom.value),
    hasSafeAreaTop: computed<boolean>(() => false),
    hasSafeAreaBottom: computed<boolean>(() => safeAreaBottom.value > 0),
  })
})

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

const textFileModalStub = defineComponent({
  name: 'ChatTextFileModalStub',
  props: {
    open: { type: Boolean, default: false },
    name: { type: String, default: '' },
    content: { type: String, default: undefined },
    url: { type: String, default: undefined },
    downloadUrl: { type: String, default: undefined },
    isReadonly: { type: Boolean, default: false },
    canInsert: { type: Boolean, default: false },
  },
  emits: ['save', 'insert', 'update:open'],
  template: '<div data-testid="text-file-modal-stub" />',
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

function fakeRevealGuardTimers() {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
}

async function waitOutRevealGuard() {
  vi.advanceTimersByTime(REVEAL_GUARD_DURATION_MS)
  await flushPromises()
}

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
        LazyChatTextFileModal: textFileModalStub,
        ChatTextFileModal: textFileModalStub,
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

function getPastedTextItems(wrapper: ChatInputWrapper) {
  return wrapper.findAll('[data-testid="pasted-text-item"]')
}

async function openPastedText(wrapper: ChatInputWrapper, index: number = 0) {
  await getPastedTextItems(wrapper)[index]!
    .get('[data-testid="files-preview-text-open"]')
    .trigger('click')
  await vi.waitFor(() => {
    expect(getTextFileModal(wrapper).exists()).toBe(true)
  })
}

function getTextFileModal(wrapper: ChatInputWrapper) {
  return wrapper.findComponent({ name: 'ChatTextFileModalStub' })
}

async function openToolsPanel(wrapper: ChatInputWrapper) {
  await wrapper.get('[data-testid="chat-input-tools-trigger"]')
    .trigger('click')
  await flushPromises()
}

function hasTestId(wrapper: ChatInputWrapper, testId: string): boolean {
  return wrapper.find(`[data-testid="${testId}"]`).exists()
}

function isTestIdRevealed(
  wrapper: ChatInputWrapper,
  testId: string,
): boolean {
  const element = wrapper.find(`[data-testid="${testId}"]`)

  return element.exists() && !element.element.closest('[inert]')
}

function captionText(wrapper: ChatInputWrapper): string {
  return wrapper.get('[data-testid="reasoning-default-caption"]').text()
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

function createTextPasteEvent(plainText: string, html: string = '') {
  const event = new Event('paste', {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent
  const data: Record<string, string> = {
    'text/plain': plainText,
    'text/html': html,
  }

  Object.defineProperty(event, 'clipboardData', {
    value: {
      items: [],
      getData: (type: string) => data[type] ?? '',
    },
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
    keyboardInset.value = 0
    safeAreaBottom.value = 0

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
      selectedModelId: shallowRef('gemini-3.1-pro'),
      selectedModelBillingProviderId: shallowRef<string | null>('google'),
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
    mocks.uploadFiles.mockResolvedValue(true)
    mocks.useWarningMessage.mockReset()
    mocks.useErrorMessage.mockReset()
    usePastedTexts().value = []
    mocks.requestPersistence.mockReset()
    mocks.setDefaultReasoningLevel.mockReset()

    useFilesModalHandoff().clearPendingOpen()

    const prefStorage = usePreferenceStorage()

    prefStorage.removeItem('settings_web_search_tool')
    prefStorage.removeItem('settings_reasoning_level')
    prefStorage.removeItem('settings_exa_search_level')
  })

  afterEach(() => {
    vi.useRealTimers()
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

  describe('markdown-aware textarea', () => {
    it('inserts a newline instead of sending for Enter inside an open code fence', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const element = textarea.element as HTMLTextAreaElement

      await textarea.setValue('```ts\nconst a = 1')
      element.setSelectionRange(element.value.length, element.value.length)
      await textarea.trigger('keydown.enter')
      await flushPromises()

      expect(wrapper.emitted('submit')).toBeUndefined()
      expect(element.value).toBe('```ts\nconst a = 1\n')
    })

    it('sends on Enter once the code fence is closed', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const element = textarea.element as HTMLTextAreaElement

      await textarea.setValue('```\ncode\n```')
      element.setSelectionRange(element.value.length, element.value.length)
      await textarea.trigger('keydown.enter')
      await flushPromises()

      expect(wrapper.emitted('submit')).toHaveLength(1)
    })

    it('does not send on Enter while an IME composition is active', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')

      await textarea.setValue('hello')
      await textarea.trigger('keydown', { key: 'Enter', isComposing: true })
      await flushPromises()

      expect(wrapper.emitted('submit')).toBeUndefined()
    })

    it('continues a list on Shift+Enter without sending', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const element = textarea.element as HTMLTextAreaElement

      await textarea.setValue('- one')
      element.setSelectionRange(element.value.length, element.value.length)
      await textarea.trigger('keydown', { key: 'Enter', shiftKey: true })
      await flushPromises()

      expect(wrapper.emitted('submit')).toBeUndefined()
      expect(element.value).toBe('- one\n- ')
    })

    it('keeps a long paste as a pasted text chip without uploading it', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const longText = `first line\n${'x'.repeat(LONG_PASTE_MIN_CHARACTERS)}`

      textarea.element.dispatchEvent(createTextPasteEvent(longText))
      await flushPromises()

      const items = getPastedTextItems(wrapper)

      expect(mocks.uploadFiles).not.toHaveBeenCalled()
      expect((textarea.element as HTMLTextAreaElement).value).toBe('')
      expect(items).toHaveLength(1)
      expect(items[0]!.text()).toContain('first line')
      expect(items[0]!.text()).toContain('Pasted text')
      expect(items[0]!.get('[data-testid="files-preview-text-meta"]').text())
        .toMatch(/^2 lines, /)
    })

    it('inserts a long paste at the caret once the chip limit is reached', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const element = textarea.element as HTMLTextAreaElement
      const longText = 'q'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)

      for (let index = 0; index < MAX_PASTED_TEXTS; index++) {
        element.dispatchEvent(createTextPasteEvent(longText))
      }
      await flushPromises()

      await textarea.setValue('abcd')
      element.setSelectionRange(2, 2)
      element.dispatchEvent(createTextPasteEvent(longText))
      await flushPromises()

      expect(getPastedTextItems(wrapper)).toHaveLength(MAX_PASTED_TEXTS)
      expect(element.value).toBe(`ab${longText}cd`)
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(
        `You can attach up to ${MAX_PASTED_TEXTS} pasted texts.`,
        'The text was inserted into the message instead.',
      )
    })

    it('ignores a whitespace-only long paste', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')

      textarea.element.dispatchEvent(createTextPasteEvent(
        ' \n'.repeat(LONG_PASTE_MIN_CHARACTERS),
      ))
      await flushPromises()

      expect(getPastedTextItems(wrapper)).toHaveLength(0)
      expect((textarea.element as HTMLTextAreaElement).value).toBe('')
      expect(wrapper.get('[data-testid="send-message"]').attributes('disabled'))
        .toBeDefined()
    })

    it('refuses a long paste that would pass the message limit', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const element = textarea.element as HTMLTextAreaElement

      element.dispatchEvent(createTextPasteEvent(
        'a'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH - 10),
      ))
      await flushPromises()

      element.dispatchEvent(createTextPasteEvent(
        'b'.repeat(LONG_PASTE_MIN_CHARACTERS + 1),
      ))
      await flushPromises()

      expect(getPastedTextItems(wrapper)).toHaveLength(1)
      expect(element.value).toBe('')
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(
        'This text is too long to paste.',
        expect.stringContaining('200,000 characters'),
      )
    })

    it('refuses a long paste over the limit even at the chip limit',
      async () => {
        const wrapper = await mountChatInput()
        const element = wrapper.get('textarea').element as HTMLTextAreaElement
        const longText = 'q'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)

        for (let index = 0; index < MAX_PASTED_TEXTS; index++) {
          element.dispatchEvent(createTextPasteEvent(longText))
        }
        await flushPromises()

        element.dispatchEvent(createTextPasteEvent(
          'z'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH),
        ))
        await flushPromises()

        expect(element.value).toBe('')
        expect(mocks.useWarningMessage).toHaveBeenCalledTimes(1)
        expect(mocks.useWarningMessage).toHaveBeenCalledWith(
          'This text is too long to paste.',
          expect.any(String),
        )
      })

    it('does not send a message over the limit and keeps everything',
      async () => {
        const wrapper = await mountChatInput()
        const textarea = wrapper.get('textarea')
        const typedText = 't'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH - 5)

        await textarea.setValue(typedText)
        textarea.element.dispatchEvent(createTextPasteEvent(
          'p'.repeat(LONG_PASTE_MIN_CHARACTERS + 1),
        ))
        await flushPromises()

        expect(getPastedTextItems(wrapper)).toHaveLength(0)

        await textarea.setValue(`${typedText}${'u'.repeat(20)}`)
        await wrapper.get('[data-testid="send-message"]').trigger('click')
        await flushPromises()

        expect(wrapper.emitted('submit')).toBeUndefined()
        expect(mocks.ensureSendConsent).not.toHaveBeenCalled()
        expect((textarea.element as HTMLTextAreaElement).value)
          .toBe(`${typedText}${'u'.repeat(20)}`)
        expect(mocks.useErrorMessage).toHaveBeenCalledWith(
          'Message is too long',
          expect.stringContaining('15 over it'),
        )
      })

    it('does not send typed text plus chips over the limit', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')

      textarea.element.dispatchEvent(createTextPasteEvent(
        'c'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH - 100),
      ))
      await flushPromises()
      await textarea.setValue('d'.repeat(200))
      await wrapper.get('[data-testid="send-message"]').trigger('click')
      await flushPromises()

      expect(wrapper.emitted('submit')).toBeUndefined()
      expect(getPastedTextItems(wrapper)).toHaveLength(1)
      expect(mocks.useErrorMessage).toHaveBeenCalledWith(
        'Message is too long',
        expect.stringContaining('over it'),
      )
    })

    it('keeps the modal open when an edit passes the message limit',
      async () => {
        const wrapper = await mountChatInput()
        const longText = 'e'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)

        wrapper.get('textarea').element
          .dispatchEvent(createTextPasteEvent(longText))
        await flushPromises()
        await openPastedText(wrapper)

        getTextFileModal(wrapper).vm.$emit(
          'save',
          'f'.repeat(MAX_USER_MESSAGE_TEXT_LENGTH + 1),
        )
        await flushPromises()

        expect(getTextFileModal(wrapper).exists()).toBe(true)
        expect(getTextFileModal(wrapper).props('content')).toBe(longText)
        expect(mocks.useWarningMessage).toHaveBeenCalledWith(
          'These edits make the message too long.',
          expect.stringContaining('1 over'),
        )
      })

    it('keeps pending chips when the input remounts on another page',
      async () => {
        const firstWrapper = await mountChatInput()
        const longText = 'n'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)

        firstWrapper.get('textarea').element
          .dispatchEvent(createTextPasteEvent(longText))
        await flushPromises()
        firstWrapper.unmount()

        const secondWrapper = await mountChatInput()

        expect(getPastedTextItems(secondWrapper)).toHaveLength(1)
        expect(getPastedTextItems(secondWrapper)[0]!.text())
          .toContain('nnnn')

        await secondWrapper.get('[data-testid="send-message"]')
          .trigger('click')
        await flushPromises()
        secondWrapper.unmount()

        const thirdWrapper = await mountChatInput()

        expect(getPastedTextItems(thirdWrapper)).toHaveLength(0)
        expect(usePastedTexts().value).toEqual([])
      })

    it('sends a message that has only pasted text', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const longText = 'p'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)

      textarea.element.dispatchEvent(createTextPasteEvent(longText))
      await flushPromises()

      const sendButton = wrapper.get('[data-testid="send-message"]')

      expect(sendButton.attributes('disabled')).toBeUndefined()

      await sendButton.trigger('click')
      await flushPromises()

      expect(wrapper.emitted('submit')).toHaveLength(1)
      expect(wrapper.emitted('update:message')).toEqual([[longText], ['']])
      expect(getPastedTextItems(wrapper)).toHaveLength(0)
      expect(mocks.useWarningMessage).not.toHaveBeenCalled()
    })

    it('appends pasted blocks after the typed text on send', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const firstPaste = 'a'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)
      const secondPaste = 'b'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)

      await textarea.setValue('Compare these two:\n')
      textarea.element.dispatchEvent(createTextPasteEvent(firstPaste))
      textarea.element.dispatchEvent(createTextPasteEvent(secondPaste))
      await flushPromises()

      const emittedBeforeSend = wrapper.emitted('update:message')?.length ?? 0

      await wrapper.get('[data-testid="send-message"]').trigger('click')
      await flushPromises()

      expect(wrapper.emitted('submit')).toHaveLength(1)
      expect(wrapper.emitted('update:message')?.slice(emittedBeforeSend))
        .toEqual([
          [`Compare these two:\n\n${firstPaste}\n\n${secondPaste}`],
          [''],
        ])
    })

    it('opens an editable modal for a chip and saves the edit', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const longText = 'e'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)

      textarea.element.dispatchEvent(createTextPasteEvent(longText))
      await flushPromises()
      await openPastedText(wrapper)

      const modal = getTextFileModal(wrapper)

      expect(modal.props()).toMatchObject({
        open: true,
        name: 'Pasted text',
        content: longText,
        canInsert: true,
        isReadonly: false,
      })

      modal.vm.$emit('save', 'edited line one\nedited line two')
      await flushPromises()

      expect(getTextFileModal(wrapper).exists()).toBe(false)
      expect(getPastedTextItems(wrapper)[0]!.text())
        .toContain('edited line one')

      await openPastedText(wrapper)

      expect(getTextFileModal(wrapper).props('content'))
        .toBe('edited line one\nedited line two')
    })

    it('moves a chip into the textarea at the caret with Insert as text', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const element = textarea.element as HTMLTextAreaElement
      const longText = 'i'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)

      await textarea.setValue('abcd')
      element.setSelectionRange(2, 2)
      element.dispatchEvent(createTextPasteEvent(longText))
      await flushPromises()
      await openPastedText(wrapper)

      getTextFileModal(wrapper).vm.$emit('insert', 'NEW')
      await flushPromises()

      expect(element.value).toBe('abNEWcd')
      expect(getPastedTextItems(wrapper)).toHaveLength(0)
      expect(getTextFileModal(wrapper).exists()).toBe(false)
    })

    it('focuses the textarea after Insert as text',
      async () => {
        const wrapper = await mountChatInput()
        const textarea = wrapper.get('textarea')
        const element = textarea.element as HTMLTextAreaElement
        const longText = 'k'.repeat(LONG_PASTE_MIN_CHARACTERS + 1)

        await textarea.setValue('abcd')
        element.setSelectionRange(2, 2)
        element.dispatchEvent(createTextPasteEvent(longText))
        await flushPromises()
        await openPastedText(wrapper)

        const trigger = wrapper.get('[data-testid="files-preview-text-open"]')
          .element as HTMLElement

        trigger.focus()
        getTextFileModal(wrapper).vm.$emit('insert', 'NEW')
        await flushPromises()

        expect(document.activeElement).toBe(element)
        expect(element.value).toBe('abNEWcd')
      })

    it('removes a chip', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')

      textarea.element.dispatchEvent(createTextPasteEvent(
        'r'.repeat(LONG_PASTE_MIN_CHARACTERS + 1),
      ))
      await flushPromises()

      await wrapper.get('[data-testid="pasted-text-remove"]').trigger('click')
      await flushPromises()

      expect(getPastedTextItems(wrapper)).toHaveLength(0)
      expect(wrapper.get('[data-testid="send-message"]').attributes('disabled'))
        .toBeDefined()
    })

    it('opens an attached text file read-only', async () => {
      const wrapper = await mountChatInput({
        files: [{
          id: 'file-1',
          storageKey: 'notes-key',
          name: 'notes.md',
          size: 2 * 1024 * 1024 * 1024,
          type: 'text/markdown',
        }],
      })

      await wrapper
        .get('[data-file-name="notes.md"] [data-testid="files-preview-text-open"]')
        .trigger('click')
      await vi.waitFor(() => {
        expect(getTextFileModal(wrapper).exists()).toBe(true)
      })

      expect(getTextFileModal(wrapper).props()).toMatchObject({
        open: true,
        name: 'notes.md',
        isReadonly: true,
        canInsert: false,
        url: '/files/notes-key',
        downloadUrl: '/files/notes-key?download=1',
      })
    })

    it('does not send on Enter keydown with keyCode 229', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')

      await textarea.setValue('hello')
      await textarea.trigger('keydown', { key: 'Enter', keyCode: 229 })
      await flushPromises()

      expect(wrapper.emitted('submit')).toBeUndefined()
    })

    it('continues a list on a mobile insertLineBreak beforeinput', async () => {
      mocks.useDevice.mockReturnValue({
        isIos: false,
        isAndroid: true,
        isDesktop: false,
      })

      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const element = textarea.element as HTMLTextAreaElement

      await textarea.setValue('- one')
      element.setSelectionRange(element.value.length, element.value.length)
      element.dispatchEvent(new InputEvent('beforeinput', {
        inputType: 'insertLineBreak',
        bubbles: true,
        cancelable: true,
      }))
      await flushPromises()

      expect(element.value).toBe('- one\n- ')
      expect(wrapper.emitted('submit')).toBeUndefined()
    })

    it('continues a list on plain Enter on mobile without sending', async () => {
      mocks.useDevice.mockReturnValue({
        isIos: true,
        isAndroid: false,
        isDesktop: false,
      })

      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const element = textarea.element as HTMLTextAreaElement

      await textarea.setValue('- one')
      element.setSelectionRange(element.value.length, element.value.length)
      await textarea.trigger('keydown.enter')
      await flushPromises()

      expect(element.value).toBe('- one\n- ')
      expect(wrapper.emitted('submit')).toBeUndefined()

      await textarea.trigger('keydown.enter')
      await flushPromises()

      expect(element.value).toBe('- one\n')
      expect(wrapper.emitted('submit')).toBeUndefined()
    })

    it('still sends a list message on plain Enter on desktop', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')
      const element = textarea.element as HTMLTextAreaElement

      await textarea.setValue('- one')
      element.setSelectionRange(element.value.length, element.value.length)
      await textarea.trigger('keydown.enter')
      await flushPromises()

      expect(wrapper.emitted('submit')).toHaveLength(1)
    })

    it('inserts a short paste into the textarea without attaching it', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')

      textarea.element.dispatchEvent(
        createTextPasteEvent('\t•\tOne\n\t•\tTwo'),
      )
      await flushPromises()

      expect(mocks.uploadFiles).not.toHaveBeenCalled()
      expect((textarea.element as HTMLTextAreaElement).value)
        .toBe('- One\n- Two')
    })

    it('converts a pasted HTML list into Markdown in the textarea', async () => {
      const wrapper = await mountChatInput()
      const textarea = wrapper.get('textarea')

      textarea.element.dispatchEvent(createTextPasteEvent(
        'Totals',
        '<div>Totals</div><ul><li>Power</li><li>Water</li></ul>',
      ))

      await vi.waitFor(() => {
        expect((textarea.element as HTMLTextAreaElement).value)
          .toBe('Totals\n\n- Power\n- Water')
      })
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
        selectedModelId: shallowRef('gemini-3.1-pro'),
        selectedModelBillingProviderId: shallowRef<string | null>('google'),
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
        selectedModelId: shallowRef('gemini-3.1-pro'),
        selectedModelBillingProviderId: shallowRef<string | null>('google'),
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
        selectedModelId: shallowRef('gemini-3.1-pro'),
        selectedModelBillingProviderId: shallowRef<string | null>('google'),
      })
    }

    function useLevelsModeSelection() {
      const reasoningCapability = shallowRef<{
        mode: 'levels'
        levels: string[]
      }>({
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      })

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
        reasoningCapability,
        reasoningMode: shallowRef('levels'),
        reasoningMenuLevels: shallowRef(['low', 'medium', 'high']),
        isDeepResearchModel: shallowRef(false),
        researchConfig: shallowRef(null),
        isSelectedModelKeyless: shallowRef(false),
        selectedTransferProviderId: shallowRef(null),
        selectedModelKeyOwnerLabel: shallowRef('OpenAI'),
        isModelCapabilityResolved: shallowRef(true),
        isSelectedModelUnavailable: shallowRef(false),
        selectedModelId: shallowRef('gemini-3.1-pro'),
        selectedModelBillingProviderId: shallowRef<string | null>('google'),
      })

      return { reasoningCapability }
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
        selectedModelId: shallowRef('gemini-3.1-pro'),
        selectedModelBillingProviderId: shallowRef<string | null>('google'),
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

    it('shows a Reasoning tile and offers Save as default once the level '
      + 'differs from the default, and saves it on request', async () => {
      useLevelsModeSelection()

      const { wrapperRef, props } = bindReasoning('off')
      const wrapper = await mountChatInput(props)

      wrapperRef.current = wrapper

      await openToolsPanel(wrapper)

      expect(tileOf(wrapper, 'reasoning').exists()).toBe(false)
      expect(captionText(wrapper)).toBe('Off is your default')
      expect(hasTestId(wrapper, 'reasoning-save-default-button'))
        .toBe(false)

      await pickTestId(wrapper, 'reasoning-level-high')
      await flushPromises()

      expect(tileTitle(wrapper, 'reasoning'))
        .toBe('Reasoning: High. Your default is Off.')
      expect(captionText(wrapper))
        .toBe('Your default is Off · Save High as default')

      await wrapper.get('[data-testid="reasoning-save-default-button"]')
        .trigger('click')

      expect(mocks.setDefaultReasoningLevel).toHaveBeenCalledWith('high')

      defaultReasoningLevel.value = 'high'
      await flushPromises()

      expect(tileOf(wrapper, 'reasoning').exists()).toBe(false)
      expect(captionText(wrapper)).toBe('High is your default')
      expect(hasTestId(wrapper, 'reasoning-save-default-button'))
        .toBe(false)
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

    it('follows a default that loads after mount in the same flush that '
      + 'rebuilds an equal capability object', async () => {
      const { reasoningCapability } = useLevelsModeSelection()

      const { wrapperRef, props } = bindReasoning('off')
      const wrapper = await mountChatInput(props)

      wrapperRef.current = wrapper

      defaultReasoningLevel.value = 'high'
      reasoningCapability.value = {
        mode: 'levels',
        levels: ['low', 'medium', 'high'],
      }
      await flushPromises()

      expect(wrapper.emitted('update:reasoning')?.map((args) => {
        return args[0]
      })).toEqual(['high'])
      expect(wrapper.props('reasoning')).toBe('high')
      expect(tileOf(wrapper, 'reasoning').exists()).toBe(false)
    })

    it('still re-clamps the level when the capability really changes',
      async () => {
        const { reasoningCapability } = useLevelsModeSelection()

        const { wrapperRef, props } = bindReasoning('high')
        const wrapper = await mountChatInput(props)

        wrapperRef.current = wrapper

        reasoningCapability.value = {
          mode: 'levels',
          levels: ['low', 'medium'],
        }
        await flushPromises()

        expect(wrapper.emitted('update:reasoning')?.at(-1))
          .toEqual(['medium'])
      })

    it('follows a default that was already loaded before mount, until the '
      + 'user picks a level', async () => {
      useLevelsModeSelection()
      defaultReasoningLevel.value = 'high'

      const { wrapperRef, props } = bindReasoning('off')
      const wrapper = await mountChatInput(props)

      wrapperRef.current = wrapper

      await flushPromises()

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['high'])

      await wrapper.setProps({ reasoning: 'high' })

      expect(tileOf(wrapper, 'reasoning').exists()).toBe(false)

      await openToolsPanel(wrapper)

      expect(captionText(wrapper)).toBe('High is your default')

      await pickTestId(wrapper, 'reasoning-level-low')

      defaultReasoningLevel.value = 'medium'
      await flushPromises()

      expect(wrapper.emitted('update:reasoning')?.at(-1)).toEqual(['low'])
    })

    it('keeps a level the page seeded on purpose when the default was '
      + 'already loaded before mount', async () => {
      useLevelsModeSelection()
      defaultReasoningLevel.value = 'high'

      const wrapper = await mountChatInput({ reasoning: 'medium' })

      await flushPromises()

      expect(wrapper.emitted('update:reasoning')).toBeUndefined()

      await openToolsPanel(wrapper)

      expect(captionText(wrapper))
        .toBe('Your default is High · Save Medium as default')
    })

    it('keeps the level of a chat that already has messages, even when the '
      + 'default was loaded before mount or arrives later', async () => {
      useLevelsModeSelection()
      defaultReasoningLevel.value = 'high'

      const wrapper = await mountChatInput({
        reasoning: 'off',
        messagesLength: 2,
      })

      await flushPromises()

      defaultReasoningLevel.value = 'low'
      await flushPromises()

      expect(wrapper.emitted('update:reasoning')).toBeUndefined()
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
        selectedModelId: shallowRef('gemini-3.1-pro'),
        selectedModelBillingProviderId: shallowRef<string | null>('google'),
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

    it('renders the Exa depth only while Exa is selected', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(isTestIdRevealed(wrapper, 'exa-search-level-auto')).toBe(false)

      await pickTestId(wrapper, 'web-search-option-web_search_exa')

      expect(isTestIdRevealed(wrapper, 'exa-search-level-auto')).toBe(true)
      expect(isTestIdDisabled(wrapper, 'exa-search-level-lite')).toBe(false)
      expect(isTestIdChecked(wrapper, 'exa-search-level-auto')).toBe(true)

      await pickTestId(wrapper, 'web-search-option-web_search_brave')

      expect(isTestIdRevealed(wrapper, 'exa-search-level-auto')).toBe(false)
    })

    it('persists a chosen Exa search level, updates the depth and the '
      + 'tile, and asks to remember preferences', async () => {
      useWebSearchSelection()

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)
      fakeRevealGuardTimers()
      await pickTestId(wrapper, 'web-search-option-web_search_exa')
      await waitOutRevealGuard()

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

    function bindTools(initial: string[]) {
      const wrapperRef: { current: ChatInputWrapper | null } = {
        current: null,
      }

      return {
        wrapperRef,
        props: {
          'tools': initial,
          'onUpdate:tools': (value: string[]) => {
            wrapperRef.current?.setProps({ tools: value })
          },
        },
      }
    }

    it('keeps the saved search provider when preference storage is '
      + 'written in the same flush that rebuilds equal provider options',
    async () => {
      const { webSearchProviderOptionsRef } = useWebSearchSelection()

      usePreferenceStorage().setItem(
        'settings_web_search_tool',
        'web_search_brave',
      )

      const { wrapperRef, props } = bindTools(['web_search_brave'])
      const wrapper = await mountChatInput(props)

      wrapperRef.current = wrapper

      await flushPromises()

      usePreferenceStorage().setItem('settings_exa_search_level', 'deep')
      webSearchProviderOptionsRef.value = [
        nativeOption(true),
        braveOption(true),
        exaOption(true),
      ]
      await flushPromises()

      const emittedTools = wrapper.emitted('update:tools') ?? []

      expect(emittedTools.every((args) => {
        return JSON.stringify(args[0]) === JSON.stringify(['web_search_brave'])
      })).toBe(true)
      expect(wrapper.props('tools')).toEqual(['web_search_brave'])
      expect(usePreferenceStorage().getItem('settings_web_search_tool'))
        .toBe('web_search_brave')
    })

    it('keeps a provider picked in the same flush that rebuilds equal '
      + 'provider options', async () => {
      const { webSearchProviderOptionsRef } = useWebSearchSelection()

      const { wrapperRef, props } = bindTools([])
      const wrapper = await mountChatInput(props)

      wrapperRef.current = wrapper

      await openToolsPanel(wrapper)
      await wrapper.get('[data-testid="web-search-option-web_search_exa"]')
        .setValue(true)

      webSearchProviderOptionsRef.value = [
        nativeOption(true),
        braveOption(true),
        exaOption(true),
      ]
      await flushPromises()

      expect(wrapper.props('tools')).toEqual(['web_search_exa'])
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
        selectedModelId: shallowRef('gemini-3.1-pro'),
        selectedModelBillingProviderId: shallowRef<string | null>('google'),
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
      expect(tileTitle(wrapper, 'image')).toBe('Image generation is on')

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
        .toBe('Image generation is always on for this model')
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

    it('restores the level a reopened chat was on, not the saved default, '
      + 'once image generation is disabled again', async () => {
      useMutualExclusionSelection()
      defaultReasoningLevel.value = 'high'

      const wrapper = await mountChatInput({
        reasoning: 'low',
        messagesLength: 2,
      })
      await nextTick()

      await openToolsPanel(wrapper)
      await setToggle(wrapper, 'tools-image-toggle', true)
      await setToggle(wrapper, 'tools-image-toggle', false)

      expect(wrapper.emitted('update:reasoning')?.map((args) => {
        return args[0]
      })).toEqual(['off', 'low'])
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
        selectedModelId: shallowRef('gemini-3.1-pro'),
        selectedModelBillingProviderId: shallowRef<string | null>('google'),
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
        selectedModelId: shallowRef('openai/gpt-5.4'),
        selectedModelBillingProviderId: shallowRef<string | null>(
          'openrouter',
        ),
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
        selectedModelId: shallowRef('gemini-3.1-pro'),
        selectedModelBillingProviderId: shallowRef<string | null>('google'),
      })
    }

    it('renders the selectable effort levels and no always-on row for a '
      + 'configurable model', async () => {
      useReasoningSelection({ state: 'configurable' })

      const wrapper = await mountChatInput()

      await openToolsPanel(wrapper)

      expect(hasTestId(wrapper, 'reasoning-level-low')).toBe(true)
      expect(hasTestId(wrapper, 'reasoning-always-on-menu-item')).toBe(false)
      expect(isTestIdRevealed(wrapper, 'reasoning-expanded-toggle'))
        .toBe(false)
      expect(isTestIdRevealed(wrapper, 'reasoning-auto-hide-toggle'))
        .toBe(false)

      await pickTestId(wrapper, 'reasoning-level-low')
      await flushPromises()

      expect(isTestIdRevealed(wrapper, 'reasoning-expanded-toggle'))
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

  describe('on-screen keyboard', () => {
    const KEYBOARD_INSET = 300
    const PUSH_DOWN_CLASS
      = 'max-sm:translate-y-[calc(var(--spacing)_*_4_+_var(--sab))]'
    const SAFE_AREA_SHIFT_CLASS = 'max-sm:translate-y-[var(--sab)]'
    const NO_SHIFT_CLASS = 'max-sm:translate-y-0'
    const KEYBOARD_PEEK_CLASS
      = 'max-sm:translate-y-[calc(100%-var(--spacing)_*_20)]'
    const SAFE_AREA_PEEK_CLASS
      = 'max-sm:translate-y-[calc(100%-var(--spacing)_*_18-var(--sab))]'
    const PEEK_CLASS = 'max-sm:translate-y-[calc(100%-var(--spacing)_*_18)]'
    const SIDEBAR_PADDING_CLASS
      = 'max-sm:pb-[calc(var(--spacing)_*_20_+_var(--sab))]'

    function getComposer(wrapper: ChatInputWrapper): HTMLElement {
      const composer = wrapper.get('textarea').element.closest<HTMLElement>(
        '.fixed.bottom-0',
      )

      if (!composer) {
        throw new Error('composer root not found')
      }

      return composer
    }

    function getPaddingBox(wrapper: ChatInputWrapper): HTMLElement {
      const parent = wrapper.get('textarea').element.parentElement

      if (!parent) {
        throw new Error('textarea has no parent')
      }

      return parent
    }

    async function mountVisibleComposer(
      extraProps: Record<string, unknown> = {},
    ) {
      const wrapper = await mountChatInput(extraProps)

      await vi.waitFor(() => {
        expect(getComposer(wrapper).className)
          .not.toContain('translate-y-[calc(100%_+_')
      })

      return wrapper
    }

    it('keeps the closed layout above the home indicator', async () => {
      safeAreaBottom.value = 34

      const wrapper = await mountVisibleComposer()
      const composer = getComposer(wrapper)

      expect(composer.classList.contains(SAFE_AREA_SHIFT_CLASS)).toBe(true)
      expect(composer.classList.contains(NO_SHIFT_CLASS)).toBe(false)
      expect(composer.style.bottom).toBe('')
      expect(getPaddingBox(wrapper).classList
        .contains(SIDEBAR_PADDING_CLASS)).toBe(true)
    })

    it('keeps the closed layout without a safe area', async () => {
      const wrapper = await mountVisibleComposer()
      const composer = getComposer(wrapper)

      expect(composer.classList.contains(NO_SHIFT_CLASS)).toBe(true)
      expect(composer.classList.contains(SAFE_AREA_SHIFT_CLASS)).toBe(false)
      expect(composer.style.bottom).toBe('')
      expect(getPaddingBox(wrapper).classList
        .contains(SIDEBAR_PADDING_CLASS)).toBe(true)
    })

    it('animates bottom alongside the slide so the lift follows the keyboard',
      async () => {
        const wrapper = await mountVisibleComposer()
        const composer = getComposer(wrapper)
        const properties = composer.style.transitionProperty.split(', ')
        const durations = composer.style.transitionDuration.split(', ')
        const timingFunctions
          = composer.style.transitionTimingFunction.split(', ')

        expect(properties).toEqual([
          'transform',
          'translate',
          'scale',
          'rotate',
          'bottom',
        ])
        expect(durations).toEqual(['500ms', '500ms', '500ms', '500ms', '250ms'])
        expect(timingFunctions.at(-1)).toBe('ease-out')
        expect(timingFunctions.slice(0, -1))
          .toEqual(Array(4).fill('ease-in-out'))
        expect(composer.classList.contains('bottom-0')).toBe(true)
      })

    it('sits on the keyboard while it covers the page', async () => {
      safeAreaBottom.value = 34

      const wrapper = await mountVisibleComposer()

      keyboardInset.value = KEYBOARD_INSET
      await nextTick()

      const composer = getComposer(wrapper)

      expect(composer.style.bottom).toBe(`${KEYBOARD_INSET}px`)
      expect(composer.classList.contains(NO_SHIFT_CLASS)).toBe(true)
      expect(composer.classList.contains(PUSH_DOWN_CLASS)).toBe(false)
      expect(composer.classList.contains(SAFE_AREA_SHIFT_CLASS)).toBe(false)
      expect(getPaddingBox(wrapper).classList
        .contains(SIDEBAR_PADDING_CLASS)).toBe(false)

      keyboardInset.value = 0
      await nextTick()

      expect(composer.style.bottom).toBe('')
      expect(composer.classList.contains(SAFE_AREA_SHIFT_CLASS)).toBe(true)
      expect(getPaddingBox(wrapper).classList
        .contains(SIDEBAR_PADDING_CLASS)).toBe(true)
    })

    it('ignores an inset below the keyboard threshold', async () => {
      safeAreaBottom.value = 34

      const wrapper = await mountVisibleComposer()

      keyboardInset.value = 60
      await nextTick()

      const composer = getComposer(wrapper)

      expect(composer.style.bottom).toBe('')
      expect(composer.classList.contains(SAFE_AREA_SHIFT_CLASS)).toBe(true)
    })

    it('peeks a fixed strip above the keyboard while collapsed on scroll',
      async () => {
        safeAreaBottom.value = 34

        const wrapper = await mountVisibleComposer({
          status: 'ready',
          messagesLength: 5,
        })
        const composer = getComposer(wrapper)

        expect(composer.classList.contains(SAFE_AREA_PEEK_CLASS)).toBe(true)

        keyboardInset.value = KEYBOARD_INSET
        await nextTick()

        expect(composer.style.bottom).toBe(`${KEYBOARD_INSET}px`)
        expect(composer.classList.contains(KEYBOARD_PEEK_CLASS)).toBe(true)
        expect(composer.classList.contains(SAFE_AREA_PEEK_CLASS)).toBe(false)
      })

    it('keeps the closed peek without a safe area', async () => {
      const wrapper = await mountVisibleComposer({
        status: 'ready',
        messagesLength: 5,
      })

      expect(getComposer(wrapper).classList.contains(PEEK_CLASS)).toBe(true)
    })

    it('reports its new height when the keyboard opens', async () => {
      const wrapper = await mountVisibleComposer()
      const reportedHeights: number[] = []
      const removeHook = useNuxtApp().hook('chat-input:height', (height) => {
        reportedHeights.push(height)
      })

      Object.defineProperty(getComposer(wrapper), 'offsetHeight', {
        configurable: true,
        value: 180,
      })

      keyboardInset.value = KEYBOARD_INSET
      await flushPromises()

      removeHook()

      expect(reportedHeights).toContain(180)
    })

    it('still announces the keyboard and scrolls to the bottom on focus '
      + 'without a measured keyboard', async () => {
      fakeRevealGuardTimers()

      const wrapper = await mountChatInput({
        status: 'ready',
        messagesLength: 5,
      })
      const keyboardStates: boolean[] = []
      const scrollToBottom = vi.fn()
      const nuxtApp = useNuxtApp()
      const removeKeyboardHook = nuxtApp.hook(
        'device-keyboard:state-changed',
        (isOpen) => {
          keyboardStates.push(isOpen)
        },
      )
      const removeScrollHook = nuxtApp.hook(
        'chat:scroll-to-bottom',
        scrollToBottom,
      )

      await wrapper.get('textarea').trigger('focus')
      await nextTick()

      expect(keyboardStates).toEqual([true])
      expect(scrollToBottom).toHaveBeenCalled()

      await wrapper.get('textarea').trigger('blur')
      vi.advanceTimersByTime(150)

      expect(keyboardStates).toEqual([true, false])
      expect(getComposer(wrapper).style.bottom).toBe('')

      removeKeyboardHook()
      removeScrollHook()
    })
  })

  describe('chat-input:prefill', () => {
    it('fills an empty composer with the text', async () => {
      const wrapper = await mountChatInput()

      await useNuxtApp().callHook('chat-input:prefill', 'Fix the error')
      await flushPromises()

      expect((wrapper.get('textarea').element as HTMLTextAreaElement).value)
        .toBe('Fix the error')
    })

    it('appends the text after a blank line instead of replacing a draft',
      async () => {
        const wrapper = await mountChatInput()
        const textarea = wrapper.get('textarea')

        await textarea.setValue('My unsent draft\n')
        await useNuxtApp().callHook('chat-input:prefill', 'Fix the error')
        await flushPromises()

        expect((textarea.element as HTMLTextAreaElement).value)
          .toBe('My unsent draft\n\nFix the error')
      })
  })
})

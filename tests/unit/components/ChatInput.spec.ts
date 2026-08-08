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
}))

mockNuxtImport('useChatInput', () => mocks.useChatInput)
mockNuxtImport('useChatFiles', () => mocks.useChatFiles)
mockNuxtImport('useDevice', () => mocks.useDevice)

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
        UiBubble: true,
        UiButton: true,
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
      isImageGenerationSupported: shallowRef(false),
      isImageGenerationRequired: shallowRef(false),
      isReasoningSupported: shallowRef(false),
      reasoningCapability: shallowRef(null),
      reasoningMode: shallowRef('none'),
      isDeepResearchModel: shallowRef(false),
      researchConfig: shallowRef(null),
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
})

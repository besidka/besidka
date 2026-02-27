<template>
  <div
    ref="chatInputRef"
    class="fixed z-50 bottom-0 max-sm:right-0 max-sm:left-0 sm:left-1/2 sm:-translate-x-1/2 sm:w-3xl sm:max-w-full transition-transform duration-500 ease-in-out"
    :class="{
      'translate-y-[calc(100%_+_var(--spacing)_*_4_+_var(--sab))]':
        !visible,
      'max-sm:translate-y-[calc(var(--spacing)_*_4_+_var(--sab))]':
        visible && isChatInputVisibleOnScroll
        && isKeyboardVisible && hasSafeAreaBottom,
      'max-sm:translate-y-0':
        visible && isChatInputVisibleOnScroll && !hasSafeAreaBottom,
      'max-sm:translate-y-[var(--sab)]':
        visible && isChatInputVisibleOnScroll
        && !isKeyboardVisible && hasSafeAreaBottom,
      'max-sm:translate-y-[calc(100%-var(--spacing)_*_20-var(--sab))]':
        visible && !isChatInputVisibleOnScroll
        && isKeyboardVisible && hasSafeAreaBottom,
      'max-sm:translate-y-[calc(100%-var(--spacing)_*_20)]':
        visible && !isChatInputVisibleOnScroll
        && isKeyboardVisible && !hasSafeAreaBottom,
      'max-sm:translate-y-[calc(100%-var(--spacing)_*_18-var(--sab))]':
        visible && !isChatInputVisibleOnScroll
        && !isKeyboardVisible && hasSafeAreaBottom,
      'max-sm:translate-y-[calc(100%-var(--spacing)_*_18)]':
        visible && !isChatInputVisibleOnScroll
        && !isKeyboardVisible && !hasSafeAreaBottom,
      'sm:translate-y-0': visible && isChatInputVisibleOnScroll,
      'sm:translate-y-[calc(100%-var(--spacing)_*_14)]':
        visible && !isChatInputVisibleOnScroll,
    }"
  >
    <LazyChatInputFilesDropZone
      v-if="$device.isDesktop"
      @files-dropped="uploadFiles"
    />
    <LazyChatScroll v-show="!isChatInputVisibleOnScroll" />
    <div class="flex justify-center w-full px-2">
      <UiBubble
        class="grow !p-0 !rounded-b-none !border-8 !border-b-0 !border-accent/40"
      >
        <div
          class="p-1 pb-0 bg-transparent max-sm:pb-[calc(var(--spacing)_*_20_+_var(--sab))]"
          :class="{
            'pt-0.5 px-1.5': files.length
          }"
        >
          <!-- Attached Files Preview with Upload Progress -->
          <LazyChatInputFilesAttachedPreview
            :files="files"
            :uploading-files="uploadingFiles"
            :uploading-count="uploadingCount"
            @remove="removeAttachedFile"
            @remove-all="removeAllFiles"
            @cancel="cancelUpload"
            @retry="retryUpload"
            @cancel-all="cancelAllUploads"
          />
          <textarea
            ref="textarea"
            v-model="input"
            class="textarea p-4 textarea-ghost !bg-transparent w-lg max-w-full !w-full h-12 max-h-[50dvh] rounded-sm border-0 no-scrollbar resize-none !outline-none"
            placeholder="Type your message here..."
            :disabled="displayStop"
            @keydown.enter.exact="handleEnter"
            @focus="onKeyboardFocus"
            @blur="onKeyboardBlur"
          />
          <div class="flex items-center justify-between gap-2 p-2">
            <div
              class="max-xs:grid max-xs:gap-0 flex items-center gap-2"
              :class="{
                'max-sm:grid max-xs:gap-0':
                  isWebSearchEnabled && isReasoningActive,
                'max-xxs:grid max-xxs:gap-0':
                  isWebSearchEnabled || isReasoningActive,
              }"
            >
              <LazyChatInputModelsTrigger
                hydrate-on-idle
                :is-web-search-enabled="isWebSearchEnabled"
                :is-reasoning-enabled="isReasoningActive"
              />
              <div class="flex items-center gap-2 my-2 px-1">
                <LazyChatInputFilesTrigger
                  hydrate-on-idle
                  :files="files"
                  @detach-all="files = []"
                  @detach="onFilesDetached"
                  @attach="onFilesAttached"
                  @upload="uploadFiles"
                />
                <UiButton
                  v-if="isWebSearchSupported"
                  mode="accent"
                  :ghost="isWebSearchEnabled ? undefined : true"
                  :circle="!isWebSearchEnabled"
                  icon-name="lucide:globe"
                  :icon-size="16"
                  :icon-only="!isWebSearchEnabled"
                  :title="isWebSearchEnabled
                    ? 'Disable web search'
                    : 'Enable web search'
                  "
                  text="Search"
                  tooltip-position="top"
                  size="xs"
                  class="rounded-full"
                  :class="{
                    'pl-[5px] btn-active': isWebSearchEnabled,
                  }"
                  @click="toggleWebSearch"
                />
                <LazyChatInputReasoningTrigger
                  v-if="isReasoningSupported && reasoningMode === 'levels'"
                  v-model:reasoning="reasoning"
                  :is-web-search-enabled="isWebSearchEnabled"
                  :levels="reasoningCapability?.mode === 'levels'
                    ? reasoningCapability.levels
                    : []
                  "
                />
                <UiButton
                  v-else-if="isReasoningSupported"
                  mode="accent"
                  :ghost="isReasoningActive ? undefined : true"
                  :circle="!isReasoningActive"
                  :icon-only="!isReasoningActive"
                  text="Reasoning"
                  :icon-size="16"
                  :title="isReasoningActive
                    ? 'Disable reasoning'
                    : 'Enable reasoning'
                  "
                  tooltip-position="top"
                  size="xs"
                  class="rounded-full pl-[5px]"
                  :class="{
                    'btn-active': isReasoningActive,
                  }"
                  @click="toggleReasoning"
                >
                  <template #icon>
                    <SvgoThinkMedium class="size-4 text-current" />
                  </template>
                </UiButton>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <UiButton
                v-show="displayStop"
                data-testid="stop-generation"
                mode="accent"
                circle
                title="Stop"
                icon-name="lucide:square"
                icon-only
                tooltip-position="left"
                @click="stop"
              />
              <UiButton
                v-show="canShowRegenerate"
                data-testid="regenerate"
                mode="accent"
                soft
                circle
                title="Regenerate"
                icon-name="lucide:refresh-ccw"
                icon-only
                tooltip-position="left"
                @click="regenerate"
              />
              <UiButton
                v-show="!displayStop && !canShowRegenerate"
                data-testid="send-message"
                mode="accent"
                circle
                :disabled="!hasMessage"
                :title="hasMessage ? 'Send Message' : 'Message is required'"
                icon-name="lucide:arrow-up"
                icon-only
                tooltip-position="left"
                @click="sendMessage"
              />
            </div>
          </div>
        </div>
      </UiBubble>
    </div>
  </div>
</template>
<script setup lang="ts">
import type { ChatStatus } from 'ai'
import type { Tools } from '#shared/types/chats.d'
import type { FileMetadata } from '#shared/types/files.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'

const props = defineProps<{
  stopped?: boolean
  messagesLength: MaybeRefOrGetter<number>
  stop: () => void
  regenerate: () => void
  displayRegenerate?: boolean
  displayStop?: boolean
  status?: ChatStatus
}>()

const emit = defineEmits<{
  submit: []
}>()

const route = useRoute()
const { isDesktop } = useDevice()
const {
  isWebSearchSupported,
  isReasoningSupported,
  reasoningCapability,
  reasoningMode,
} = useChatInput()
const { hasSafeAreaBottom } = useDeviceSafeArea()
const { visible } = useAnimateAppear()
const nuxtApp = useNuxtApp()

const message = defineModel<string>('message', {
  default: '',
})

const files = defineModel<FileMetadata[]>('files', {
  default: () => [],
})

const tools = defineModel<Tools>('tools', {
  default: [],
})

const reasoning = defineModel<ReasoningLevel>('reasoning', {
  default: 'off',
})

const isReasoningActive = computed<boolean>(() => {
  return isReasoningEnabled(reasoning.value)
})

const isKeyboardVisible = shallowRef<boolean>(false)

const blurTimeout = ref<NodeJS.Timeout | null>(null)

function onKeyboardFocus() {
  if (blurTimeout.value) {
    clearTimeout(blurTimeout.value)
  }

  isKeyboardVisible.value = true

  nuxtApp.callHook('device-keyboard:state-changed', true)

  nextTick(() => {
    if (!isChatInputVisibleOnScroll.value) {
      nuxtApp.callHook('chat:scroll-to-bottom')
    }
  })
}

function onKeyboardBlur() {
  if (blurTimeout.value) {
    clearTimeout(blurTimeout.value)
  }

  blurTimeout.value = setTimeout(() => {
    isKeyboardVisible.value = false

    nuxtApp.callHook('device-keyboard:state-changed', false)

    blurTimeout.value = null
  }, 150)
}
const scrollContainerRef = ref<HTMLDivElement | null>(null)
const messagesContainerRef = ref<HTMLDivElement | null>(null)
const { arrivedState, measure } = useScroll(scrollContainerRef)
const { height: scrollContainerHeight } = useElementSize(scrollContainerRef)
const { height: messagesContainerHeight } = useElementSize(messagesContainerRef)

nuxtApp.hook('chat:rendered', (container) => {
  if (!container.value) {
    return
  }

  scrollContainerRef.value = container.value
  messagesContainerRef.value = container.value.querySelector('.js-chat-messages-container')
})

nuxtApp.hook('chat-spacer:changed', () => measure())

const {
  uploadFiles,
  uploadingFiles,
  uploadingCount,
  cancelUpload,
  retryUpload,
  cancelAllUploads,
  removeAttachedFile,
  removeAllFiles,
} = useChatFiles(files)

watch(
  [isReasoningSupported, reasoningCapability],
  ([supported, capability]) => {
    if (!supported || !capability) {
      reasoning.value = 'off'

      return
    }

    if (!isReasoningLevelSupported(reasoning.value, capability)) {
      reasoning.value = 'off'
    }
  },
  {
    immediate: true,
    flush: 'post',
  },
)

const { textarea, input } = useTextareaAutosize({
  input: message,
})

const hasMessage = computed<boolean>(() => {
  return !!input.value?.trim().length
})

const canShowRegenerate = computed<boolean>(() => {
  return !!props.displayRegenerate && !hasMessage.value
})

const isWebSearchEnabled = computed<boolean>(() => {
  return tools.value.includes('web_search')
})

const isChatInputVisibleOnScroll = computed<boolean>(() => {
  if (
    route.path === '/chats/new'
    || props.status !== 'ready'
    || toValue(props.messagesLength) <= 1
    || messagesContainerHeight.value < scrollContainerHeight.value
  ) {
    return true
  }

  return arrivedState.bottom
})

watchPostEffect(() => {
  nuxtApp.callHook('chat-input:visibility-changed', isChatInputVisibleOnScroll.value)
})

function toggleWebSearch() {
  if (!isWebSearchEnabled.value) {
    tools.value = [...tools.value, 'web_search']

    return
  }

  tools.value = tools.value.filter((tool) => {
    return tool !== 'web_search'
  })
}

function toggleReasoning() {
  if (isReasoningActive.value) {
    reasoning.value = 'off'

    return
  }

  reasoning.value = 'medium'
}

onMounted(async () => {
  await nextTick()

  if (
    !isWebSearchEnabled.value
    && isWebSearchSupported.value
    && /https?:\/\//.test(input.value)
  ) {
    tools.value = [...tools.value, 'web_search']
  }
})

watch(input, (newValue) => {
  if (
    !isWebSearchEnabled.value
    && isWebSearchSupported.value
    && /https?:\/\//.test(newValue)
  ) {
    tools.value = [...tools.value, 'web_search']
  }
})

function onFilesAttached(
  attachedFiles: Pick<FileMetadata, 'id' | 'storageKey' | 'name' | 'size' | 'type'>[],
) {
  const existingKeys = new Set(files.value.map(file => file.storageKey))
  const newFiles = attachedFiles.filter(
    file => !existingKeys.has(file.storageKey),
  )

  if (newFiles.length === 0) {
    return
  }

  files.value.push(...newFiles as FileMetadata[])
}

function onFilesDetached(fileIds: string[]) {
  const idsToDetach = new Set(fileIds)

  files.value = files.value.filter(file => !idsToDetach.has(file.id))
}

function handleEnter(event: KeyboardEvent) {
  if (!isDesktop) {
    return
  }

  event.preventDefault()
  sendMessage()
}

function sendMessage() {
  if (!message.value?.trim()) {
    return useWarningMessage('Please enter a message before sending.')
  }

  const text = message.value

  emit('submit')
  message.value = ''
  files.value = []
  nuxtApp.callHook('chat:submit', { text })
}

const chatInputRef = useTemplateRef<HTMLDivElement>('chatInputRef')
const { height: chatInputHeight } = useElementSize(chatInputRef)
const isSentHeightOnMounted = shallowRef<boolean>(false)

watch(chatInputHeight, (newHeight) => {
  if (input.value) {
    if (!isSentHeightOnMounted.value) {
      isSentHeightOnMounted.value = true

      nuxtApp.callHook('chat-input:height', newHeight)
      nuxtApp.callHook('chat:scroll-to-bottom')
    }

    return
  }

  isSentHeightOnMounted.value = true

  nuxtApp.callHook('chat-input:height', newHeight)
}, { flush: 'post' })

onUnmounted(() => {
  if (blurTimeout.value) {
    clearTimeout(blurTimeout.value)
  }
})

onStartTyping(() => {
  nuxtApp.callHook('chat:scroll-to-bottom')
  textarea.value?.focus()
})

function onPaste(event: ClipboardEvent) {
  const isFilesModalOpen = !!document.querySelector(
    'dialog.js-files-modal[open]',
  )

  if (isFilesModalOpen) {
    return
  }

  const items = event.clipboardData?.items

  if (!items) {
    return
  }

  const imageFiles: File[] = []

  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()

      if (file) {
        imageFiles.push(file)
      }
    }
  }

  if (imageFiles.length > 0) {
    event.preventDefault()
    uploadFiles(imageFiles)
  }
}

onMounted(() => {
  if (!isDesktop) {
    return
  }

  document.addEventListener('paste', onPaste)
})

onUnmounted(() => {
  if (!isDesktop) {
    return
  }

  document.removeEventListener('paste', onPaste)
})
</script>

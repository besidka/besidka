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
      '!translate-y-full': anyMessagesSelected
    }"
  >
    <LazyChatInputFilesDropZone
      v-if="$device.isDesktop && !isDeepResearchModel"
      @files-dropped="uploadFiles"
    />
    <LazyChatScroll v-show="isChatScrollButtonVisible" />
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
            :placeholder="textareaPlaceholder"
            :disabled="displayStop"
            @keydown.enter.exact="handleEnter"
            @focus="onKeyboardFocus"
            @blur="onKeyboardBlur"
          />
          <div class="flex items-center justify-between gap-2 p-2 pb-0">
            <div class="flex items-center gap-2 max-md:grow">
              <div class="max-md:grow min-w-0">
                <LazyChatInputModelsTrigger
                  hydrate-on-idle
                  :is-web-search-enabled="isWebSearchEnabled"
                  :is-image-generation-enabled="isImageGenerationEnabled"
                  :is-reasoning-enabled="isReasoningActive"
                />
              </div>
              <div class="hidden md:flex items-center gap-2 my-2 px-1">
                <div
                  v-if="shouldDisplayProjectPicker"
                  class="join"
                >
                  <button
                    type="button"
                    class="btn btn-xs btn-accent join-item"
                    :class="{
                      'btn-ghost btn-ghost-legacy !px-1.5 rounded-full':
                        !projectContext,
                      'rounded-l-full': projectContext
                    }"
                    :aria-label="projectContext
                      ? `Current project: ${projectContext.name}`
                      : 'Select project'"
                    @click="emit('open-project-picker')"
                  >
                    <Icon
                      :name="projectContext
                        ? 'lucide:folder-check'
                        : 'lucide:folder'"
                      size="14"
                    />
                    <span
                      v-if="projectContext"
                      class="truncate max-w-[100px]"
                    >
                      {{ projectContext.name }}
                    </span>
                  </button>
                  <button
                    v-if="projectContext"
                    type="button"
                    class="btn btn-accent btn-xs join-item rounded-r-full"
                    aria-label="Remove project"
                    @click="emit('clear-project-context')"
                  >
                    <Icon name="lucide:x" size="12" />
                  </button>
                </div>
                <LazyChatInputFilesTrigger
                  v-if="!isDeepResearchModel"
                  hydrate-on-idle
                  :files="files"
                  :is-image-input-supported="isImageInputSupported"
                  @detach-all="files = []"
                  @open="openFilesModal"
                />
                <UiButton
                  v-if="isImageGenerationSupported && !isDeepResearchModel"
                  mode="accent"
                  :ghost="isImageGenerationEnabled ? undefined : true"
                  :circle="!isImageGenerationEnabled"
                  icon-name="lucide:image-plus"
                  :icon-size="16"
                  :icon-only="!isImageGenerationEnabled"
                  :title="isImageGenerationEnabled
                    ? isImageGenerationRequired
                      ? 'Image creation is required for this model'
                      : 'Disable image creation'
                    : 'Create an image'
                  "
                  text="Create image"
                  tooltip-position="top"
                  size="xs"
                  class="rounded-full"
                  :aria-disabled="isImageGenerationRequired"
                  :class="{
                    'pl-[5px] btn-active': isImageGenerationEnabled,
                    'pointer-events-none': isImageGenerationRequired,
                  }"
                  @click="toggleImageGeneration"
                />
                <LazyChatInputWebSearchTrigger
                  v-if="(isWebSearchSupported || isToolCallingSupported)
                    && !isDeepResearchModel"
                  :selected="selectedWebSearchProvider"
                  :options="webSearchProviderOptions"
                  :is-tool-calling-supported="isToolCallingSupported"
                  :align="toolbarDropdownAlign"
                  @select-provider="selectWebSearchProvider"
                />
                <LazyChatInputReasoningTrigger
                  v-if="isReasoningSupported && !isDeepResearchModel"
                  :reasoning="reasoning"
                  :align="toolbarDropdownAlign"
                  :levels="reasoningMenuLevels"
                  @update:reasoning="selectReasoningLevel"
                />
                <LazyChatInputDeepResearchTrigger
                  v-if="isDeepResearchModel"
                  :research="researchConfig"
                  :disabled="researchJobActive"
                />
              </div>
              <LazyChatInputToolbarMore
                hydrate-on-idle
                :is-web-search-supported="isWebSearchSupported"
                :is-web-search-enabled="isWebSearchEnabled"
                :is-tool-calling-supported="isToolCallingSupported"
                :web-search-options="webSearchProviderOptions"
                :selected-web-search-provider="selectedWebSearchProvider"
                :is-image-generation-supported="isImageGenerationSupported"
                :is-image-generation-enabled="isImageGenerationEnabled"
                :is-image-generation-required="isImageGenerationRequired"
                :is-reasoning-supported="isReasoningSupported"
                :is-reasoning-active="isReasoningActive"
                :reasoning="reasoning"
                :levels="reasoningMenuLevels"
                :is-deep-research-model="isDeepResearchModel"
                :research="researchConfig"
                :display-project-picker="shouldDisplayProjectPicker"
                :project-context="projectContext"
                :files-count="files.length"
                @select-web-search-provider="selectWebSearchProvider"
                @toggle-image-generation="toggleImageGeneration"
                @open-project-picker="emit('open-project-picker')"
                @clear-project-context="emit('clear-project-context')"
                @open-files-select="openFilesModal('select')"
                @open-files-upload="openFilesModal('upload')"
                @select-reasoning-level="selectReasoningLevel"
              />
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
                :title="regenerateButtonTitle"
                icon-name="lucide:refresh-ccw"
                icon-only
                tooltip-position="left"
                @click="onRegenerate"
              />
              <UiButton
                v-show="!displayStop && !canShowRegenerate"
                data-testid="send-message"
                mode="accent"
                circle
                :disabled="!hasMessage || isClarifying || researchJobActive"
                :title="sendButtonTitle"
                icon-name="lucide:arrow-up"
                icon-only
                tooltip-position="left"
                @click="sendMessage"
              />
            </div>
          </div>

          <!--
            AI Act Art. 50(1) disclosure. Must stay LAST: the collapsed states
            reveal a fixed strip from the container's top, so anything above the
            textarea eats into the draft text visible while peeking.
          -->
          <p class="px-3 pb-2 text-center text-2xs text-base-content/60">
            AI can make mistakes.
            <NuxtLink to="/terms-of-use" class="link link-accent">
              Terms of Use
            </NuxtLink>
          </p>
        </div>
      </UiBubble>
    </div>
  </div>
  <ClientOnly>
    <LazyChatInputFilesModal
      ref="filesModalRef"
      :attached-ids="attachedIds"
      :is-image-input-supported="isImageInputSupported"
      @attach="onFilesAttached"
      @detach="onFilesDetached"
      @upload="uploadFiles"
    />
  </ClientOnly>
</template>
<script setup lang="ts">
import type { ChatStatus } from 'ai'
import type { Tools } from '#shared/types/chats.d'
import type { FileMetadata } from '#shared/types/files.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import { isWebSearchTool } from '#shared/utils/message-metadata'
import type { FileSourceFilter } from '~/types/file-manager'
import type { WebSearchSelection } from '~/types/web-search'
import { LazyChatInputFilesModal } from '#components'

const props = defineProps<{
  stopped?: boolean
  messagesLength: MaybeRefOrGetter<number>
  stop: () => void
  regenerate: () => void
  displayRegenerate?: boolean
  displayStop?: boolean
  isClarifying?: boolean
  researchJobActive?: boolean
  status?: ChatStatus
  projectContext?: {
    id: string
    name: string
  } | null
  displayProjectPicker?: boolean
  anyMessagesSelected?: boolean
}>()

const emit = defineEmits<{
  'submit': []
  'clear-project-context': []
  'open-project-picker': []
}>()

const route = useRoute()
const { isDesktop } = useDevice()
const {
  isWebSearchSupported,
  isToolCallingSupported,
  webSearchProviderOptions,
  isImageGenerationSupported,
  isImageGenerationRequired,
  isImageInputSupported,
  isReasoningSupported,
  reasoningCapability,
  reasoningMenuLevels,
  isDeepResearchModel,
  researchConfig,
  isSelectedModelKeyless,
  selectedModelKeyOwnerLabel,
  isModelCapabilityResolved,
  isSelectedModelUnavailable,
} = useChatInput()
const { hasSafeAreaBottom } = useDeviceSafeArea()
const { visible } = useAnimateAppear()
const nuxtApp = useNuxtApp()
const prefStorage = usePreferenceStorage()

const message = defineModel<string>('message', {
  default: '',
})

const files = defineModel<FileMetadata[]>('files', {
  default: () => [],
})

const tools = defineModel<Tools>('tools', {
  default: () => [],
})

const reasoning = defineModel<ReasoningLevel>('reasoning', {
  default: 'off',
})

const isReasoningActive = computed<boolean>(() => {
  return isReasoningEnabled(reasoning.value)
})

const missingKeyWarning = computed<string>(() => {
  return `Add your ${selectedModelKeyOwnerLabel.value} API key to send this message`
})

const unavailableModelWarning = computed<string>(() => {
  return `This model is no longer available on `
    + `${selectedModelKeyOwnerLabel.value}. Pick another model.`
})

const regenerateButtonTitle = computed<string>(() => {
  if (isSelectedModelUnavailable.value) {
    return unavailableModelWarning.value
  }

  if (isSelectedModelKeyless.value) {
    return missingKeyWarning.value
  }

  return 'Regenerate'
})

/**
 * Kept clickable rather than disabled: a dead button explains nothing on
 * touch, where the title never surfaces, and this is a state the user has to
 * leave deliberately by adding a key.
 */
function warnAboutMissingKey() {
  useWarningMessage(
    `${missingKeyWarning.value}.`,
    'Open Profile → API Keys to add it, or pick a model you have a key for.',
  )
}

/**
 * Mirrors `warnAboutMissingKey()` above: kept clickable rather than disabled,
 * and the user leaves this state deliberately by picking another model.
 */
function warnAboutUnavailableModel() {
  useWarningMessage(
    unavailableModelWarning.value,
    'Open the model picker and choose another model to continue.',
  )
}

function onRegenerate() {
  if (isSelectedModelUnavailable.value) {
    return warnAboutUnavailableModel()
  }

  if (isSelectedModelKeyless.value) {
    return warnAboutMissingKey()
  }

  props.regenerate()
}

const sendButtonTitle = computed<string>(() => {
  if (isSelectedModelUnavailable.value) {
    return unavailableModelWarning.value
  }

  if (isSelectedModelKeyless.value) {
    return missingKeyWarning.value
  }

  if (props.researchJobActive) {
    return 'Research in progress — please wait'
  }

  if (props.isClarifying) {
    return 'Please wait for the research questions to finish loading'
  }

  return hasMessage.value ? 'Send Message' : 'Message is required'
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

nuxtApp.hook('chat:attach-file', async (file) => {
  onFilesAttached([file])
  await nextTick()

  const measuredHeight = chatInputRef.value?.offsetHeight

  // chat-input:height's own watcher (below) suppresses re-emitting while
  // the textarea has text, to avoid spamming the spacer on every keystroke
  // — but that means it never reports a resize caused by attaching a file
  // while a draft is already typed. Measure and report directly here
  // instead of waiting on that watcher or a ResizeObserver, both of which
  // can be delayed or throttled (e.g. a backgrounded tab).
  if (measuredHeight) {
    nuxtApp.callHook('chat-input:height', measuredHeight)
  }

  nuxtApp.callHook('chat:scroll-to-bottom')
})

const {
  uploadFiles,
  uploadingFiles,
  uploadingCount,
  cancelUpload,
  retryUpload,
  cancelAllUploads,
  removeAttachedFile,
  removeAllFiles,
} = useChatFiles(files, isImageInputSupported)

watch(isImageInputSupported, (supported) => {
  if (supported) {
    return
  }

  const remainingFiles = files.value.filter((file) => {
    return !isImageFile(file.type)
  })

  if (remainingFiles.length === files.value.length) {
    return
  }

  files.value = remainingFiles
  useWarningMessage(IMAGE_INPUT_UNSUPPORTED_MESSAGE)
}, { flush: 'post' })

watch(
  [isReasoningSupported, reasoningCapability, isModelCapabilityResolved],
  ([supported, capability, isResolved]) => {
    if (!isResolved) {
      return
    }

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

watch(
  [
    webSearchProviderOptions,
    isImageGenerationSupported,
    isImageGenerationRequired,
    isModelCapabilityResolved,
  ],
  ([
    searchOptions,
    imageGenerationSupported,
    imageGenerationRequired,
    isResolved,
  ], [
    ,
    ,
    wasImageGenerationRequired,
  ] = [undefined, undefined, undefined, undefined]) => {
    if (!isResolved) {
      return
    }

    if (imageGenerationRequired) {
      tools.value = ['image_generation']

      return
    }

    if (wasImageGenerationRequired) {
      tools.value = tools.value.filter((tool) => {
        return tool !== 'image_generation'
      })
    }

    tools.value = tools.value.filter((tool) => {
      if (isWebSearchTool(tool)) {
        const option = searchOptions.find((candidate) => {
          return candidate.value === tool
        })

        return !!option?.enabled && !tools.value.includes('image_generation')
      }

      if (tool === 'image_generation') {
        return imageGenerationSupported
      }

      return true
    })
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

const selectedWebSearchProvider = computed<WebSearchSelection>(() => {
  if (tools.value.includes('web_search_brave')) {
    return 'web_search_brave'
  }

  if (tools.value.includes('web_search_exa')) {
    return 'web_search_exa'
  }

  if (tools.value.includes('web_search')) {
    return 'web_search'
  }

  return 'off'
})

const isWebSearchEnabled = computed<boolean>(() => {
  return selectedWebSearchProvider.value !== 'off'
})

const isImageGenerationEnabled = computed<boolean>(() => {
  return tools.value.includes('image_generation')
})

/**
 * The single alignment source both the web-search and reasoning dropdowns
 * read, replacing the old boolean that only the web-search toggle used to
 * set. It generalises the same "does a wider control sit before me"
 * signal (now web search OR image generation) to whichever pair of
 * dropdowns ends up adjacent in the toolbar.
 */
const toolbarDropdownAlign = computed<'start' | 'end'>(() => {
  return isImageGenerationEnabled.value || isWebSearchEnabled.value
    ? 'end'
    : 'start'
})

const textareaPlaceholder = computed<string>(() => {
  if (isImageGenerationEnabled.value) {
    return 'Describe the image you want to create...'
  }

  return 'Type your message here...'
})

const shouldDisplayProjectPicker = computed<boolean>(() => {
  return !!(props.displayProjectPicker || props.projectContext)
})

const isChatInputVisibleOnScroll = computed<boolean>(() => {
  if (props.anyMessagesSelected) {
    return false
  }

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

const isChatScrollButtonVisible = computed<boolean>(() => {
  if (isChatInputVisibleOnScroll.value) {
    return false
  } else if (
    !isChatInputVisibleOnScroll.value
    && props.anyMessagesSelected
  ) {
    return false
  }

  return !isChatInputVisibleOnScroll.value
})

watchPostEffect(() => {
  nuxtApp.callHook('chat-input:visibility-changed', isChatInputVisibleOnScroll.value)
})

function selectWebSearchProvider(option: WebSearchSelection) {
  if (isImageGenerationRequired.value) {
    return
  }

  prefStorage.setItem('settings_web_search_tool', option)

  const withoutSearch = tools.value.filter((tool) => {
    return !isWebSearchTool(tool)
  })

  if (option === 'off') {
    tools.value = withoutSearch

    return
  }

  tools.value = [
    ...withoutSearch.filter((tool) => {
      return tool !== 'image_generation'
    }),
    option,
  ]
}

function selectReasoningLevel(level: ReasoningLevel) {
  reasoning.value = level
  prefStorage.setItem('settings_reasoning_level', level)
}

function toggleImageGeneration() {
  if (isImageGenerationRequired.value) {
    return
  }

  if (!isImageGenerationEnabled.value) {
    tools.value = [
      ...tools.value.filter((tool) => {
        return !isWebSearchTool(tool)
      }),
      'image_generation',
    ]

    return
  }

  tools.value = tools.value.filter((tool) => {
    return tool !== 'image_generation'
  })
}

onMounted(async () => {
  await nextTick()

  if (
    !isWebSearchEnabled.value
    && !isImageGenerationEnabled.value
    && isWebSearchSupported.value
    && /https?:\/\//.test(input.value)
  ) {
    tools.value = [...tools.value, 'web_search']
  }
})

watch(input, (newValue) => {
  if (
    !isWebSearchEnabled.value
    && !isImageGenerationEnabled.value
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
  const incomingFiles = attachedFiles.filter(
    file => !existingKeys.has(file.storageKey),
  )
  const newFiles = isImageInputSupported.value
    ? incomingFiles
    : incomingFiles.filter(file => !isImageFile(file.type))

  if (newFiles.length < incomingFiles.length) {
    useWarningMessage(IMAGE_INPUT_UNSUPPORTED_MESSAGE)
  }

  if (newFiles.length === 0) {
    return
  }

  files.value = [...files.value, ...newFiles as FileMetadata[]]
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

  if (isSelectedModelUnavailable.value) {
    return warnAboutUnavailableModel()
  }

  if (isSelectedModelKeyless.value) {
    return warnAboutMissingKey()
  }

  if (props.isClarifying) {
    return useWarningMessage(
      'Please wait for the research questions to finish loading.',
    )
  }

  if (props.researchJobActive) {
    return useWarningMessage('Research in progress — please wait.')
  }

  const text = message.value

  emit('submit')
  message.value = ''
  files.value = []
  nuxtApp.callHook('chat:submit', { text })
}

const filesModalRef = useTemplateRef<
  InstanceType<typeof LazyChatInputFilesModal>
>('filesModalRef')

const attachedIds = computed<Set<FileMetadata['id']>>(() => {
  return new Set(files.value.map(file => file.id))
})

function openFilesModal(tab: 'select' | 'upload', source?: FileSourceFilter) {
  filesModalRef.value?.open(tab, source)
}

const { pendingOpen, clearPendingOpen } = useFilesModalHandoff()

watch([pendingOpen, filesModalRef], () => {
  if (!pendingOpen.value || !filesModalRef.value) {
    return
  }

  if (pendingOpen.value.targetPath !== route.path) {
    return
  }

  filesModalRef.value.open(pendingOpen.value.tab, pendingOpen.value.source)
  clearPendingOpen()
}, { immediate: true, flush: 'post' })

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
  const isBlockingModalOpen = !!document.querySelector(
    'dialog.js-files-modal[open], dialog.js-search-modal[open]',
  )

  if (isBlockingModalOpen) {
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

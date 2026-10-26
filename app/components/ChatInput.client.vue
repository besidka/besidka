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
            'pt-0.5 px-1.5': files.length || tiles.length
          }"
        >
          <!-- Attached Files Preview with Upload Progress -->
          <LazyChatInputFilesAttachedPreview
            :files="files"
            :uploading-files="uploadingFiles"
            :uploading-count="uploadingCount"
            :tiles="tiles"
            @open-tile="openToolsMenu"
            @remove-tile="removeTile"
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
            <div class="flex items-center gap-1 min-w-0">
              <div class="min-w-0">
                <LazyChatInputModelsTrigger hydrate-on-idle />
              </div>
              <ChatInputToolsMenu
                ref="toolsMenu"
                :state="toolsState"
                :tiles="tiles"
                @select-web-search-provider="selectWebSearchProvider"
                @select-exa-search-level="selectExaSearchLevel"
                @toggle-auto-web-search="setAutoWebSearchPreferred"
                @toggle-image-generation="toggleImageGeneration"
                @select-reasoning-level="selectReasoningLevel"
                @save-default-reasoning-level="saveDefaultReasoningLevel"
                @open-project-picker="emit('open-project-picker')"
                @open-files-select="openFilesModal('select')"
                @open-files-upload="openFilesModal('upload')"
                @open-files-generated="openFilesModal('select', 'assistant')"
                @update:use-memory="setMemoryUsage"
                @remove-tile="removeTile"
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
      :can-attach-media-type="canAttachMediaType"
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
import type { ExaSearchLevel } from '#shared/utils/exa-search-level'
import type { WebSearchSelection } from '~/types/web-search'
import type {
  ChatInputTile,
  ChatInputTileId,
  ChatInputToolsState,
  ReasoningMode,
  ToolsSection,
} from '~/types/chat-input-tools'
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
  canAttachMediaType,
  isReasoningSupported,
  isReasoningAlwaysOn,
  reasoningCapability,
  reasoningMenuLevels,
  canDisableReasoningLevel,
  isDeepResearchModel,
  researchConfig,
  isSelectedModelKeyless,
  selectedTransferProviderId,
  selectedModelKeyOwnerLabel,
  isModelCapabilityResolved,
  isSelectedModelUnavailable,
} = useChatInput()
const { ensureSendConsent } = useLegalConsent()
const {
  isAvailable: isAutoWebSearchAvailable,
  isPreferred: isAutoWebSearchPreferred,
  setPreferred: setAutoWebSearchPreferred,
} = useAutoWebSearch()
const {
  defaultReasoningLevel,
  setDefaultReasoningLevel,
} = useUserSetting()
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

const memoryExcluded = defineModel<boolean | null>('memoryExcluded', {
  default: null,
})

function setMemoryUsage(isUsed: boolean) {
  memoryExcluded.value = !isUsed
}

const tools = defineModel<Tools>('tools', {
  default: () => [],
})

const reasoning = defineModel<ReasoningLevel>('reasoning', {
  default: 'off',
})

const effectiveDefaultReasoningLevel = computed<ReasoningLevel>(() => {
  return resolveInitialReasoningLevel(
    defaultReasoningLevel.value,
    prefStorage.getItem('settings_reasoning_level'),
  )
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

async function onRegenerate() {
  if (isSelectedModelUnavailable.value) {
    return warnAboutUnavailableModel()
  }

  if (isSelectedModelKeyless.value) {
    return warnAboutMissingKey()
  }

  if (!await ensureSendConsent(selectedTransferProviderId.value)) {
    return
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
} = useChatFiles(files, canAttachMediaType)

watch(canAttachMediaType, (canAttach) => {
  const rejectedFiles = files.value.filter((file) => {
    return isMediaTypeRejectedByModel(file.type, canAttach)
  })

  if (rejectedFiles.length === 0) {
    return
  }

  files.value = files.value.filter(file => !rejectedFiles.includes(file))
  useWarningMessage(
    getUnsupportedInputMessage(
      rejectedFiles.map(file => file.type),
      canAttach,
    ),
  )
}, { flush: 'post' })

/**
 * The level the user asked for before the model replaced it with a supported
 * one (the default effort on a model that cannot stop reasoning, or the next
 * stronger level on a model lacking the requested one), so switching back to
 * a model that can honor it restores that level instead of keeping the
 * substitute.
 */
const reasoningLevelBeforeClamp = shallowRef<ReasoningLevel | null>(null)

watch(
  [isReasoningSupported, reasoningCapability, isModelCapabilityResolved],
  ([supported, capability, isResolved]) => {
    if (!isResolved) {
      return
    }

    if (!supported || !capability) {
      reasoning.value = 'off'
      reasoningLevelBeforeClamp.value = null

      return
    }

    const desiredLevel = reasoningLevelBeforeClamp.value ?? reasoning.value

    const resolvedLevel = resolveSupportedReasoningLevel(
      desiredLevel,
      capability,
    )

    reasoningLevelBeforeClamp.value = resolvedLevel === desiredLevel
      ? null
      : desiredLevel
    reasoning.value = resolvedLevel
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

const exaSearchLevel = computed<ExaSearchLevel>(() => {
  return normalizeExaSearchLevel(
    prefStorage.getItem('settings_exa_search_level'),
  )
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
 * Mirrors direct providers: while image generation is active (toggled by
 * the user or forced by `isImageGenerationRequired` for image-only models),
 * neither the reasoning nor the web-search section can produce a request
 * the provider would accept alongside `image_generation`, so both are
 * hidden rather than shown disabled. `isImageGenerationRequired` is checked
 * directly (not only through `isImageGenerationEnabled`) so an image-only
 * model hides both sections the same render its capability resolves,
 * rather than one flush later once the tools-forcing watcher catches up.
 */
const isImageGenerationActive = computed<boolean>(() => {
  return isImageGenerationEnabled.value || isImageGenerationRequired.value
})

const isReasoningSectionVisible = computed<boolean>(() => {
  return (isReasoningSupported.value || isReasoningAlwaysOn.value)
    && !isDeepResearchModel.value
    && !isImageGenerationActive.value
})

const isWebSearchSectionVisible = computed<boolean>(() => {
  return (isWebSearchSupported.value || isToolCallingSupported.value)
    && !isDeepResearchModel.value
    && !isImageGenerationActive.value
})

const reasoningMode = computed<ReasoningMode>(() => {
  if (isReasoningSupported.value) {
    return 'configurable'
  }

  return isReasoningAlwaysOn.value ? 'always-on' : 'none'
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

const toolsState = computed<ChatInputToolsState>(() => {
  return {
    isNewChat: route.path === '/chats/new',
    webSearch: {
      visible: isWebSearchSectionVisible.value,
      selected: selectedWebSearchProvider.value,
      options: webSearchProviderOptions.value,
      isToolCallingSupported: isToolCallingSupported.value,
      exaSearchLevel: exaSearchLevel.value,
      isAutoAvailable: isAutoWebSearchAvailable.value,
      isAutoPreferred: isAutoWebSearchPreferred.value,
    },
    reasoning: {
      visible: isReasoningSectionVisible.value,
      mode: reasoningMode.value,
      level: reasoning.value,
      levels: reasoningMenuLevels.value,
      canDisable: canDisableReasoningLevel.value,
      capability: reasoningCapability.value,
      defaultLevel: effectiveDefaultReasoningLevel.value,
    },
    image: {
      supported: isImageGenerationSupported.value,
      enabled: isImageGenerationEnabled.value,
      required: isImageGenerationRequired.value,
    },
    files: {
      visible: !isDeepResearchModel.value,
      count: files.value.length,
      isImageInputSupported: isImageInputSupported.value,
    },
    project: {
      visible: shouldDisplayProjectPicker.value,
      context: props.projectContext ?? null,
    },
    memory: {
      excluded: memoryExcluded.value,
    },
    research: researchConfig.value,
    isDeepResearchModel: isDeepResearchModel.value,
    isResearchJobActive: !!props.researchJobActive,
    isCapabilityResolved: isModelCapabilityResolved.value,
  }
})

const tiles = computed<ChatInputTile[]>(() => {
  return buildChatInputTiles(toolsState.value)
})

const toolsMenu = useTemplateRef<{
  open: (
    section?: ToolsSection | null,
    origin?: HTMLElement | null,
  ) => Promise<void>
}>('toolsMenu')

function openToolsMenu(
  section: ToolsSection | null,
  origin: HTMLElement,
) {
  toolsMenu.value?.open(section, origin)
}

async function focusAfterTileRemoval() {
  await nextTick()

  const nextFocus = chatInputRef.value?.querySelector<HTMLElement>(
    '.js-chat-input-tile, .js-chat-input-tools-trigger',
  )

  nextFocus?.focus()
}

function removeTile(id: ChatInputTileId) {
  if (id === 'project') {
    emit('clear-project-context')
  } else if (id === 'memory') {
    memoryExcluded.value = false
  } else if (id === 'image') {
    if (isImageGenerationEnabled.value) {
      toggleImageGeneration()
    }
  } else if (id === 'search') {
    selectWebSearchProvider('off')
  }

  focusAfterTileRemoval()
}

function saveDefaultReasoningLevel(level: ReasoningLevel) {
  setDefaultReasoningLevel(level)
}

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
  requestPersistence()

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

function selectExaSearchLevel(level: ExaSearchLevel) {
  prefStorage.setItem('settings_exa_search_level', level)
  requestPersistence()
}

const hasPickedReasoningLevel = shallowRef<boolean>(false)

function selectReasoningLevel(level: ReasoningLevel) {
  hasPickedReasoningLevel.value = true
  reasoning.value = level
  reasoningLevelBeforeClamp.value = null
}

/**
 * Restores the live reasoning level after image generation turns off,
 * without touching the saved default — only the explicit "Save as default"
 * toggle persists a new one. Validated
 * against the current model's capability here rather than left to the
 * separate capability watcher above, since that watcher only reacts to its
 * own tracked sources and would not re-run just because `reasoning.value`
 * changed. When the saved level had to be substituted, it is remembered in
 * `reasoningLevelBeforeClamp` so a later model switch restores it.
 */
function restoreLiveReasoningLevel() {
  const savedLevel = effectiveDefaultReasoningLevel.value

  const resolvedLevel = resolveSupportedReasoningLevel(
    savedLevel,
    reasoningCapability.value,
  )

  reasoningLevelBeforeClamp.value = resolvedLevel === savedLevel
    ? null
    : savedLevel
  reasoning.value = resolvedLevel
}

/**
 * The saved default arrives after the page has already seeded the level
 * (settings load asynchronously on a full page load), so the live level
 * follows it until the user picks one for this chat. While image creation
 * holds reasoning off, the default is picked up on the way back instead.
 */
watch(effectiveDefaultReasoningLevel, () => {
  if (hasPickedReasoningLevel.value || isImageGenerationActive.value) {
    return
  }

  restoreLiveReasoningLevel()
}, { flush: 'post' })

/**
 * Mirrors `restoreLiveReasoningLevel()` for web search: safe to restore
 * without a persisted-default write because it re-validates the saved
 * option against the model's current `webSearchProviderOptions` itself,
 * rather than relying on the unrelated tools-filtering watcher to catch an
 * unsupported restore later.
 */
function restoreLiveWebSearchSelection() {
  if (tools.value.some(isWebSearchTool)) {
    return
  }

  const savedOption = prefStorage.getItem('settings_web_search_tool')

  if (!isWebSearchTool(savedOption)) {
    return
  }

  const option = webSearchProviderOptions.value.find((candidate) => {
    return candidate.value === savedOption
  })

  if (!option?.enabled) {
    return
  }

  tools.value = [...tools.value, savedOption]
}

/**
 * The single place that reacts to `image_generation` entering or leaving
 * `tools` — whichever of `toggleImageGeneration()`, the required-model
 * branch above, or `selectWebSearchProvider()` caused it. Forcing reasoning
 * off is unconditional on every enabled state (also covers mounting into an
 * already-image-generation chat), while restoring only fires on an actual
 * enabled-to-disabled transition, so it never clobbers a reasoning level
 * the user picked while image generation was already off.
 */
watch(
  isImageGenerationEnabled,
  (enabled, wasEnabled) => {
    if (enabled) {
      reasoning.value = 'off'

      return
    }

    if (wasEnabled !== true) {
      return
    }

    restoreLiveReasoningLevel()
    restoreLiveWebSearchSelection()
  },
  {
    immediate: true,
    flush: 'post',
  },
)

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
  const rejectedFiles = incomingFiles.filter((file) => {
    return isMediaTypeRejectedByModel(file.type, canAttachMediaType.value)
  })
  const newFiles = incomingFiles.filter((file) => {
    return !rejectedFiles.includes(file)
  })

  if (rejectedFiles.length > 0) {
    useWarningMessage(
      getUnsupportedInputMessage(
        rejectedFiles.map(file => file.type),
        canAttachMediaType.value,
      ),
    )
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

async function sendMessage() {
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

  if (!await ensureSendConsent(selectedTransferProviderId.value)) {
    return
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

watch(() => tiles.value.length > 0, async () => {
  if (!input.value) {
    return
  }

  await nextTick()

  const measuredHeight = chatInputRef.value?.offsetHeight

  if (measuredHeight) {
    nuxtApp.callHook('chat-input:height', measuredHeight)
  }
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

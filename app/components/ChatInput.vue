<template>
  <div
    ref="chatInputRef"
    class="fixed z-50 bottom-0 max-sm:right-0 max-sm:left-0 sm:left-1/2 sm:-translate-x-1/2 sm:w-3xl sm:max-w-full transition-transform duration-500 ease-in-out"
    :class="{
      // On mobile devices
      // When page is only loaded, is has to be animated from offscreen
      'max-sm:translate-y-[calc(var(--spacing)_*_20_+_var(--sab))]':
        !visible,

      // On mobile devices
      // When page is scrolled to bottom, show chat input
      // On iOS when the keyboard is not visible,
      // apply safe area (with safe area)
      'max-sm:translate-y-[calc(var(--spacing)_*_4_+_var(--sab))]':
        visible && isChatInputVisibleOnScroll
        && isKeyboardVisible && hasSafeAreaBottom,

      // On mobile devices
      // When page is scrolled to bottom, show chat input
      // On iOS when the keyboard is not visible, no safe area
      'max-sm:translate-y-0':
        visible && isChatInputVisibleOnScroll && !hasSafeAreaBottom,

      // On mobile devices
      // When page is scrolled to bottom, show chat input
      // On iOS when the keyboard is visible, apply safe area
      'max-sm:translate-y-[var(--sab)]':
        visible && isChatInputVisibleOnScroll
        && !isKeyboardVisible && hasSafeAreaBottom,

      // On mobile devices
      // When page is scrolled to bottom, show chat input
      // On iOS when the keyboard is visible, no safe area
      // 'max-sm:translate-y-0':
      //   visible && isChatInputVisibleOnScroll
      // && !isKeyboardVisible && !hasSafeAreaBottom,
      // On mobile devices
      // When page is not scrolled to bottom,
      // hide chat input partially offscreen
      // On iOS when the keyboard is not visible,
      // apply safe area (with safe area)
      'max-sm:translate-y-[calc(100%-var(--spacing)_*_20-var(--sab))]':
        visible && !isChatInputVisibleOnScroll
        && isKeyboardVisible && hasSafeAreaBottom,

      // On mobile devices
      // When page is not scrolled to bottom,
      // hide chat input partially offscreen
      // On iOS when the keyboard is not visible, no safe area
      'max-sm:translate-y-[calc(100%-var(--spacing)_*_20)]':
        visible && !isChatInputVisibleOnScroll
        && isKeyboardVisible && !hasSafeAreaBottom,

      // On mobile devices
      // When page is not scrolled to bottom,
      // hide chat input partially offscreen
      // On iOS when the keyboard is visible, apply safe area
      'max-sm:translate-y-[calc(100%-var(--spacing)_*_18-var(--sab))]':
        visible && !isChatInputVisibleOnScroll
        && !isKeyboardVisible && hasSafeAreaBottom,

      // On mobile devices
      // When page is not scrolled to bottom,
      // hide chat input partially offscreen
      // On iOS when the keyboard is visible, no safe area
      'max-sm:translate-y-[calc(100%-var(--spacing)_*_18)]':
        visible && !isChatInputVisibleOnScroll
        && !isKeyboardVisible && !hasSafeAreaBottom,
      'sm:translate-y-0': visible && isChatInputVisibleOnScroll,
      'sm:translate-y-[calc(100%-var(--spacing)_*_14)]':
        visible && !isChatInputVisibleOnScroll,
    }"
  >
    <LazyChatScroll v-show="!isChatInputVisibleOnScroll" />
    <div class="flex justify-center w-full px-4">
      <UiBubble
        class="grow !p-0 !rounded-b-none !rounded-t-xl !border-0 ring-12 ring-accent/20 !bg-transparent"
      >
        <div class="p-1 pb-0 bg-transparent shadow-lg max-sm:pb-[calc(var(--spacing)_*_20_+_var(--sab))]">
          <textarea
            ref="textarea"
            v-model="input"
            class="textarea p-4 textarea-ghost !bg-transparent w-lg max-w-full !w-full h-12 max-h-[50dvh] rounded-[var(--radius-field)] border-0 no-scrollbar resize-none"
            placeholder="Type your message here..."
            :disabled="displayStop"
            @keydown.enter.exact="handleEnter"
            @focus="onKeyboardFocus"
            @blur="onKeyboardBlur"
          />
          <div class="flex items-center justify-between gap-2 p-2">
            <div
              class="flex items-center gap-2"
              :class="{
                'max-xs:grid': isWebSearchEnabled
              }"
            >
              <details
                ref="modelDropdown"
                class="group dropdown dropdown-top"
              >
                <summary
                  aria-label="Select model"
                  class="btn btn-ghost btn-sm rounded-full [--size:calc(var(--size-field)_*_6)] transition-colors duration-200"
                >
                  {{ getModelName(toValue(userModel)) }}
                  <Icon
                    name="lucide:chevron-down"
                    size="14"
                    class="group-open:scale-y-[-1]"
                  />
                </summary>
                <div
                  class="dropdown-content bg-base-100 rounded-box z-50 w-64 shadow-sm"
                >
                  <ul class="menu menu-xs w-full">
                    <li
                      v-for="provider in providers"
                      :key="provider.id"
                    >
                      <span class="menu-title">
                        {{ provider.name }}
                      </span>
                      <ul>
                        <li v-for="model in provider.models" :key="model.id">
                          <button
                            type="button"
                            @click="userModel = model.id"
                          >
                            {{ model.name }}
                          </button>
                        </li>
                      </ul>
                    </li>
                  </ul>
                </div>
              </details>
              <div class="max-sm:px-1 sm:contents">
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
              </div>
            </div>
            <ClientOnly>
              <template #fallback>
                <div class="flex items-center gap-2">
                  <div class="skeleton size-10 rounded-full" />
                </div>
              </template>
              <template #default>
                <div class="flex items-center gap-2">
                  <UiButton
                    v-show="displayStop"
                    mode="accent"
                    circle
                    title="Stop"
                    icon-name="lucide:square"
                    icon-only
                    tooltip-position="left"
                    @click="stop"
                  />
                  <UiButton
                    v-show="displayRegenerate"
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
                    v-show="!displayStop && !displayRegenerate"
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
              </template>
            </ClientOnly>
          </div>
        </div>
      </UiBubble>
    </div>
  </div>
</template>
<script setup lang="ts">
import type { ChatStatus } from 'ai'
import type { Tools } from '#shared/types/chats.d'

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
const { userModel } = useUserModel()
const { providers } = getProviders()
const { isWebSearchSupported } = useChatInput()
const { hasSafeAreaBottom } = useDeviceSafeArea()
const nuxtApp = useNuxtApp()

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
  messagesContainerRef.value = container.value.querySelector('[data-chat-messages]')
})

nuxtApp.hook('chat-spacer:changed', () => measure())

const message = defineModel<string>('message', {
  default: '',
})

const tools = defineModel<Tools>('tools', {
  default: [],
})
const { textarea, input } = useTextareaAutosize({
  input: message,
})

const hasMessage = computed<boolean>(() => {
  return !!input.value?.trim().length
})

const modelDropdown = useTemplateRef<HTMLDetailsElement>('modelDropdown')
const isDropdownHovered = useElementHover(modelDropdown)

onClickOutside(modelDropdown, () => {
  if (modelDropdown.value?.open) {
    modelDropdown.value.open = false
  }
})

watch(isDropdownHovered, (hovered) => {
  if (!modelDropdown.value || !isDesktop) {
    return
  }

  modelDropdown.value.open = hovered
}, {
  immediate: false,
  flush: 'post',
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

  emit('submit')
  message.value = ''
}

const { visible } = useAnimateAppear()

const chatInputRef = useTemplateRef<HTMLDivElement>('chatInputRef')
const { height: chatInputHeight } = useElementSize(chatInputRef)

onMounted(() => {
  setTimeout(() => {
    nuxtApp.callHook('chat-input:height', chatInputHeight.value)
  }, 4)
})

onUnmounted(() => {
  if (blurTimeout.value) {
    clearTimeout(blurTimeout.value)
  }
})
</script>

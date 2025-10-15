<template>
  <div
    class="fixed z-50 bottom-safe sm:left-1/2 sm:-translate-x-1/2 max-sm:inset-x-3 transition-transform duration-500 ease-in-out"
    :class="{
      [`
        translate-y-[calc(100%-var(--spacing)_*_40)]
        sm:translate-y-[calc(100%-var(--spacing)_*_20)]
      `]:
        visible && !isChatInputVisibleOnScroll,
      'translate-y-0': visible && isChatInputVisibleOnScroll,
      'max-sm:translate-y-24': !visible
    }"
    >
    <LazyChatScroll
      v-show="isScrollToBottomVisible"
      @click="scrollToBottom"
    />
    <UiBubble
      class="!pb-0 !rounded-b-none !rounded-t-[calc(var(--radius-xl)_+_var(--spacing)_*_2)] !bg-accent/20"
    >
      <div
        class="p-1 pb-0 max-sm:pb-[calc(var(--spacing)_*_20_+_env(safe-area-inset-bottom,0))] rounded-t-xl bg-base-100/80 dark:bg-base-100/80 shadow-lg"
      >
        <textarea
          ref="textarea"
          v-model="input"
          class="textarea textarea-ghost !bg-transparent w-lg max-w-full h-12 max-h-[50dvh] rounded-[calc(var(--radius-field))] no-scrollbar resize-none"
          placeholder="Type your message here..."
          :disabled="pending"
          @keydown.enter.exact="handleEnter"
          @focus="onFocus"
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
          <div class="flex items-center gap-2">
            <ClientOnly>
              <UiButton
                v-show="pending"
                mode="accent"
                soft
                circle
                title="Stop"
                icon-name="lucide:pause"
                icon-only
                tooltip-position="left"
                @click="stop"
              />
              <UiButton
                v-show="!pending && displayRegenerate"
                mode="accent"
                soft
                circle
                title="Regenerate"
                icon-name="lucide:refresh-ccw"
                icon-only
                tooltip-position="left"
                @click="regenerate"
              />
            </ClientOnly>
            <UiButton
              v-show="!pending && !displayRegenerate"
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
</template>
<script setup lang="ts">
import type { Tools } from '#shared/types/chats.d'

const props = defineProps<{
  pending?: boolean
  stopped?: boolean
  messagesLength: MaybeRefOrGetter<number>
  stop: () => void
  regenerate: () => void
  displayRegenerate?: boolean
}>()

const emit = defineEmits<{
  submit: []
}>()

const route = useRoute()
const { isDesktop } = useDevice()
const { userModel } = useUserModel()
const { providers } = getProviders()
const { isWebSearchSupported } = useChatInput()
const {
  scrollToBottom,
  arrivedState,
} = useChatScroll()

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
  if (route.path === '/chats/new') {
    return true
  }

  const len = toValue(props.messagesLength)

  return len === 1
    || (len > 1 && arrivedState.bottom)
})

const isScrollToBottomVisible = computed<boolean>(() => {
  const len = toValue(props.messagesLength)

  return !arrivedState.bottom && len > 1
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

function onFocus() {
  if (!arrivedState.bottom) scrollToBottom()
}

const { visible } = useAnimateAppear()
</script>

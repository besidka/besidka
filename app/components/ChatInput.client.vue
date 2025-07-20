<template>
  <div
    class="fixed z-50 max-sm:bottom-8 bottom-0 sm:left-1/2 sm:-translate-x-1/2 max-sm:inset-x-3 transition-transform duration-500 ease-in-out"
    :class="{
      'translate-y-1/2': !visible,
      'translate-y-0': visible,
    }"
    >
    <UiBubble
      class="!pb-0 !rounded-b-none !rounded-t-[calc(var(--radius-xl)_+_var(--spacing)_*_2)] !bg-accent/20"
    >
      <div
        class="p-1 pb-0 max-sm:pb-16 rounded-t-xl bg-base-100/80 dark:bg-base-100/80 shadow-lg"
      >
        <textarea
          v-model="message"
          class="textarea textarea-ghost !bg-transparent w-lg max-w-full h-12 resize-none rounded-[calc(var(--radius-field))]"
          placeholder="Type your message here..."
          :disabled="pending"
          @keydown.enter.exact="handleEnter"
          @focus="onFocus"
        />
        <div class="flex items-center justify-between p-2">
          <div class="flex items-center gap-2">
            <details
              ref="modelDropdown"
              class="dropdown dropdown-top"
            >
              <summary
                aria-label="Select model"
                class="btn btn-ghost btn-sm [--size:calc(var(--size-field)_*_6)] transition-colors duration-200"
              >
                {{ getModelName(toValue(userModel)) }}
                <Icon name="lucide:chevron-up" size="14" />
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
            <UiButton
              v-if="isWebSearchSupported"
              mode="accent"
              :ghost="isWebSearchEnabled ? undefined : true"
              circle
              icon-name="lucide:globe"
              :icon-size="16"
              icon-only
              :text="isWebSearchEnabled
                ? 'Disable web search'
                : 'Enable web search'
              "
              tooltip-position="top"
              size="xs"
              :class="{
                'btn-active': isWebSearchEnabled,
              }"
              @click="toggleWebSearch"
            />
          </div>
          <div>
            <UiButton
              mode="accent"
              circle
              :disabled="!message.trim() || pending"
              title="Send Message"
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

defineProps<{
  pending?: boolean
  visible?: boolean
}>()

const emit = defineEmits<{
  submit: []
}>()

const { isDesktop } = useDevice()
const { userModel } = useUserModel()
const { replaceUserPre, isWebSearchSupported } = useChatInput()
const { providers } = getProviders()
const { scrollToBottom, arrivedState } = useChatScroll()

const message = defineModel<string>('message', {
  default: '',
  get: (value: string) => {
    value = replaceUserPre(value)

    return value
  },
  set: (value: string) => {
    value = replaceUserPre(value)

    return value
  },
})

const tools = defineModel<Tools>('tools', {
  default: [],
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
  !arrivedState.bottom && scrollToBottom()
}
</script>

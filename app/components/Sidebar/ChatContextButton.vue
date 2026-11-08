<template>
  <UiButton
    ghost
    circle
    :icon-only="true"
    :title="title"
    tooltip-position="left"
    :class="{ 'btn-active': isActive }"
    :aria-expanded="isActive"
    data-testid="sidebar-chat-context"
    @click="toggleContext"
  >
    <template #icon>
      <span
        class="indicator"
        data-testid="sidebar-chat-context-wrapper"
      >
        <span
          v-if="outputsCount > 0"
          class="indicator-item badge badge-xs badge-accent pointer-events-none"
          aria-hidden="true"
          data-testid="sidebar-chat-context-badge"
        >
          {{ badgeLabel }}
        </span>
        <Icon
          :name="iconName"
          size="20"
        />
      </span>
    </template>
  </UiButton>
</template>

<script setup lang="ts">
import ChatContextPanel from '~/components/Chat/ContextPanel.vue'
import { CHAT_CONTEXT_VIEW_KEY } from '~/composables/chat-context'

const BADGE_MAX = 9

const { mode, isOpen, toggle } = useSidePanel()
const { outputsCount, refresh } = useChatContext()
const layout = useSidePanelLayout()

const iconName = computed<string>(() => {
  return layout.value === 'sheet'
    ? 'lucide:panel-bottom'
    : 'lucide:panel-right'
})

const isActive = computed<boolean>(() => {
  return isOpen.value && mode.value === 'context'
})

const badgeLabel = computed<string>(() => {
  return outputsCount.value > BADGE_MAX
    ? `${BADGE_MAX}+`
    : String(outputsCount.value)
})

const title = computed<string>(() => {
  if (!outputsCount.value) {
    return 'Chat'
  }

  return outputsCount.value === 1
    ? 'Chat, 1 output'
    : `Chat, ${outputsCount.value} outputs`
})

const nuxtApp = useNuxtApp()
const removeHooks = [
  nuxtApp.hook('chat:generation-finished', () => {
    refresh()
  }),
  nuxtApp.hook('chat:context-changed', () => {
    refresh()
  }),
]

onBeforeUnmount(() => {
  removeHooks.forEach((removeHook) => {
    removeHook()
  })
})

function toggleContext() {
  if (!isActive.value) {
    refresh()
  }

  toggle({
    viewKey: CHAT_CONTEXT_VIEW_KEY,
    title: 'Chat',
    mode: 'context',
    component: ChatContextPanel,
  })
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="messageId"
      class="fixed inset-0 z-[9998]"
      @pointerdown="dismiss"
      @contextmenu.prevent
    />
    <ul
      v-if="messageId && menuPosition"
      class="fixed z-[9999] menu menu-xs bg-base-100 rounded-xl shadow-lg border border-base-200 w-44 p-1"
      :style="menuPosition"
      @pointerdown.stop
      @contextmenu.stop.prevent
    >
      <li>
        <button
          type="button"
          @click="onBranch"
        >
          <Icon name="lucide:git-branch-plus" size="14" />
          New chat from here
        </button>
      </li>
    </ul>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  messageId: string | null
  anchorEl: HTMLElement | null
}>()

const emit = defineEmits<{
  branch: [messageId: string]
  close: []
}>()

const menuPosition = computed(() => {
  if (!props.anchorEl || !import.meta.client) return null

  const bubbleEl = props.anchorEl.querySelector<HTMLElement>('.js-chat-bubble')
  const rect = (bubbleEl ?? props.anchorEl).getBoundingClientRect()
  const menuHeight = 44
  const gap = 4
  const rightOffset = window.innerWidth - rect.right
  const spaceBelow = window.innerHeight - rect.bottom

  if (spaceBelow >= menuHeight + gap + 16) {
    return { top: `${rect.bottom + gap}px`, right: `${rightOffset}px` }
  }

  return {
    bottom: `${window.innerHeight - rect.top + gap}px`,
    right: `${rightOffset}px`,
  }
})

function dismiss() {
  emit('close')
}

function onBranch() {
  if (!props.messageId) return

  emit('branch', props.messageId)
  emit('close')
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    dismiss()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown)
})
</script>

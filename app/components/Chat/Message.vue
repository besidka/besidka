<template>
  <div
    ref="element"
    class="group w-screen sm:w-4xl sm:max-w-screen mx-auto transition-opacity"
    :class="{
      'opacity-90 blur-md': anySelected && !isSelected,
    }"
    @contextmenu="onContextMenu"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="cancelLongPress"
    @pointercancel="cancelLongPress"
  >
    <div
      class="px-4 sm:px-24"
    >
      <div
        class="relative chat"
        :class="{
          'chat-start': role === 'assistant',
          'chat-end': role === 'user',
        }"
      >
        <div
          class="chat-image avatar rounded-full"
          :class="{
            'avatar-placeholder':
              role === 'assistant' || !user?.image,
              'max-sm:hidden': hideAssistantAvatarOnMobile
                && role === 'assistant',
          }"
        >
          <div class="bubble w-9 rounded-full bg-base-100 dark:bg-base-content/50 text-text dark:text-base-100 shadow-none">
            <Logo
              v-if="role === 'assistant'"
              short
              class="size-5"
            />
            <template v-else>
              <img
                v-if="user?.image"
                :alt="user.name"
                :src="user.image"
              >
              <Icon v-else name="lucide:user-round" />
            </template>
          </div>
        </div>
        <div class="js-chat-bubble bubble chat-bubble w-full shadow-none">
          <slot />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'

const props = withDefaults(defineProps<{
  role: UIMessage['role']
  hideAssistantAvatarOnMobile?: boolean
  messageId?: string
  isSelected?: boolean
  anySelected?: boolean
}>(), {
  hideAssistantAvatarOnMobile: true,
  messageId: undefined,
  isSelected: false,
  anySelected: false,
})

const emit = defineEmits<{
  select: [messageId: string]
}>()

const { user } = useAuth()
const element = useTemplateRef<HTMLDivElement>('element')

let longPressTimer: ReturnType<typeof setTimeout> | undefined
let pointerStartX = 0
let pointerStartY = 0

function onContextMenu(event: MouseEvent) {
  if (!props.messageId) return

  const target = event.target as HTMLElement

  if (target.closest('a, img')) return

  const selection = window.getSelection()

  if (selection && selection.toString().length > 0) return

  event.preventDefault()
  emit('select', props.messageId)
}

function onPointerDown(event: PointerEvent) {
  if (event.pointerType === 'mouse' || !props.messageId) return

  const messageId = props.messageId

  pointerStartX = event.clientX
  pointerStartY = event.clientY
  longPressTimer = setTimeout(() => {
    emit('select', messageId)
  }, 500)
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerType === 'mouse') return

  const dx = Math.abs(event.clientX - pointerStartX)
  const dy = Math.abs(event.clientY - pointerStartY)

  if (dx > 8 || dy > 8) {
    cancelLongPress()
  }
}

function cancelLongPress() {
  clearTimeout(longPressTimer)
}

onUnmounted(() => {
  clearTimeout(longPressTimer)
})

defineExpose({
  element,
})
</script>

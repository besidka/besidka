<template>
  <div
    class="w-full"
    @mouseenter="pauseInterval"
    @mouseleave="startInterval"
  >
    <div class="flex items-center justify-between gap-4 py-4 px-2 sm:px-4">
      <div class="flex items-center gap-4">
        <Icon
          :name="getIcon(message?.type)"
          size="20"
          class="shrink-0"
        />
        <span>{{ message.text }}</span>
      </div>
      <button
        ref="removeButton"
        type="button"
        class="shrink-0 btn btn-xs btn-circle btn-ghost"
        @click="removeMessage"
      >
        <Icon name="lucide:x" size="20" />
        <span class="sr-only">Close</span>
      </button>
    </div>
    <progress
      v-show="progress"
      :value="progress"
      max="100"
      class="progress block w-full h-1 bg-black/10"
      :class="{
        'text-error-content': message.type === 'error',
        'text-success-content': message.type === 'success',
        'text-info-content': message.type === 'info',
        'text-warning-content': message.type === 'warning',
      }"
    />
  </div>
</template>

<script setup lang="ts">
import type {
  MessageWithId,
  MessageType,
} from '~/types/message.d'

const props = defineProps<{
  message: MessageWithId
}>()

const {
  autoRemove,
  autoRemoveTimeout,
} = useAppConfig().messages

const progress = shallowRef<number>(100)
const interval = ref<NodeJS.Timeout | null>(null)
const removeButton = ref<HTMLButtonElement | null>(null)

const messages = useMessages()

async function removeMessage() {
  await nextTick()

  interval.value && clearInterval(interval.value)

  const index = messages.value.findIndex((message) => {
    return message.id === props.message.id
  })

  if (index === -1) return

  messages.value.splice(index, 1)
}

async function startInterval() {
  if (!autoRemove) return

  interval.value = setInterval(() => {
    progress.value -= 0.25

    if (progress.value <= 0) {
      progress.value = 0
      clearInterval(interval.value!)
      removeMessage()
    }
  }, autoRemoveTimeout / 400)
}

async function pauseInterval() {
  if (!autoRemove || !interval.value) return

  clearInterval(interval.value)
  interval.value = null
}

watchPostEffect(() => {
  removeButton.value?.focus()
})

onMounted(async () => {
  autoRemove && startInterval()
})

onBeforeUnmount(() => {
  autoRemove && pauseInterval()
})

function getIcon(type: MessageType | undefined): string {
  if (!type) return 'lucide:circle-dot'

  const icons = {
    error: 'lucide:circle-x',
    success: 'lucide:circle-check-big',
    info: 'lucide:info',
    warning: 'lucide:circle-alert',
  }

  return icons[type]
}
</script>

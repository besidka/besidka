<template>
  <div
    v-if="parts.length > 0"
    class="collapse my-2 border border-base-300 bg-base-100"
    :class="{
      'collapse-arrow': props.status !== 'streaming' || isTextDisplayed
    }"
  >
    <input
      :id="`reasoning-${message.id}-checkbox`"
      :aria-labelledby="`reasoning-${message.id}-label`"
      type="checkbox"
      :checked="isExpanded"
      @change="isExpanded = !isExpanded"
    >
    <strong
      :id="`reasoning-${message.id}-label`"
      class="collapse-title flex items-center gap-2 py-3 font-semibold text-sm"
    >
      <Icon name="lucide:brain" />
      Thought process
    </strong>
    <div class="collapse-content ml-10 mr-4 p-0 text-sm">
      <div
        v-for="(part, index) in parts"
        :key="`reasoning-${message.id}-part-${index}`"
      >
        <MDCCached
          :key="`reasoning-${message.id}-part-${index}-${status}`"
          :value="part.text"
          :parser-options="{ highlight: false }"
          class="chat-markdown !text-text/80"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage, ReasoningUIPart, ChatStatus } from 'ai'

const props = defineProps<{
  message: UIMessage
  status: ChatStatus
}>()

const parts = computed<ReasoningUIPart[]>(() => {
  return props.message.parts.filter((part) => {
    return part.type === 'reasoning' && part.text?.length
  }) as ReasoningUIPart[]
})

const isTextDisplayed = computed<boolean>(() => {
  return props.message.parts.some((part) => {
    return part.type === 'text'
  })
})

const isExpanded = shallowRef<boolean>(false)

watchPostEffect(() => {
  if (props.status !== 'streaming') {
    return
  }

  isExpanded.value = !isTextDisplayed.value
})

watch(() => props.status, (newStatus, oldStatus) => {
  if (oldStatus === 'streaming' && newStatus === 'ready') {
    setTimeout(() => {
      isExpanded.value = false
    }, 500)
  }
}, {
  once: true,
})
</script>

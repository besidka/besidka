<template>
  <section
    class="rounded-box transition-colors"
    :class="isHighlighted ? 'bg-accent/10 duration-0' : 'duration-700'"
    :data-section="id"
    :aria-labelledby="title ? headingId : undefined"
    :aria-label="title ? undefined : label"
  >
    <h3
      v-if="title"
      :id="headingId"
      class="px-2 pt-2 pb-0.5 text-xs font-semibold text-base-content/60"
    >
      {{ title }}
    </h3>
    <slot />
  </section>
</template>

<script setup lang="ts">
import type { ToolsSection } from '~/types/chat-input-tools'

defineProps<{
  id?: ToolsSection
  title?: string
  label?: string
  isHighlighted?: boolean
}>()

const headingId = useId()
</script>

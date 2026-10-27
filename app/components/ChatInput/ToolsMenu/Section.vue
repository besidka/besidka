<template>
  <section
    class="rounded-box transition-colors"
    :class="isHighlighted ? 'bg-accent/10 duration-0' : 'duration-700'"
    :data-section="id"
    :aria-labelledby="title ? headingId : undefined"
    :aria-label="title ? undefined : label"
  >
    <div
      v-if="title"
      class="flex items-center justify-between gap-2 h-7 px-2 text-xs font-semibold text-base-content/60"
    >
      <h3
        :id="headingId"
        class="inline-flex items-center gap-1.5 min-w-0"
      >
        <Icon
          v-if="icon"
          :name="icon"
          size="14"
          class="shrink-0"
          aria-hidden="true"
          data-testid="tools-section-icon"
        />
        <component
          :is="iconComponent"
          v-else-if="iconComponent"
          class="size-3.5 shrink-0"
          aria-hidden="true"
          data-testid="tools-section-icon"
        />
        <span class="truncate">{{ title }}</span>
      </h3>
      <slot name="title-end" />
    </div>
    <slot />
  </section>
</template>

<script setup lang="ts">
import type { ToolsSection } from '~/types/chat-input-tools'

defineProps<{
  id?: ToolsSection
  title?: string
  icon?: string
  iconComponent?: string
  label?: string
  isHighlighted?: boolean
}>()

const headingId = useId()
</script>

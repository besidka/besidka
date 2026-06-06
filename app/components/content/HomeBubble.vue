<template>
  <LandingMessageBubble
    :id="id || undefined"
    :role="role"
    :wide="wide"
    :sr-label="srLabel || undefined"
  >
    <div class="flex flex-col gap-3">
      <h2 v-if="heading" class="sr-only">
        {{ heading }}
      </h2>
      <slot />
    </div>
  </LandingMessageBubble>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  role?: 'assistant' | 'user'
  wide?: boolean
  heading?: string
  id?: string
  srLabel?: string
}>(), {
  role: 'assistant',
  wide: false,
  heading: undefined,
  id: undefined,
  srLabel: undefined,
})
</script>

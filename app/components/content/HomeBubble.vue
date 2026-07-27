<template>
  <LandingMessageBubble
    :role="role"
    :wide="wide"
    :sr-label="heading ? undefined : (srLabel || undefined)"
  >
    <div class="flex flex-col gap-3">
      <h2
        v-if="heading"
        :id="id || undefined"
        tabindex="-1"
        class="landing-anchor focus-visible:outline-2
          focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        <MDCSlot unwrap="p" />
      </h2>
      <slot v-else />
    </div>
  </LandingMessageBubble>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  role?: 'assistant' | 'user'
  wide?: boolean
  heading?: boolean
  id?: string
  srLabel?: string
}>(), {
  role: 'assistant',
  wide: false,
  heading: false,
  id: undefined,
  srLabel: undefined,
})
</script>

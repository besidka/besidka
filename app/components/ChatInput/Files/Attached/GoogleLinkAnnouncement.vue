<template>
  <p
    class="sr-only"
    role="status"
    aria-live="polite"
    aria-atomic="true"
    data-testid="google-link-announcement"
  >
    {{ announcement }}
  </p>
</template>

<script setup lang="ts">
const props = defineProps<{
  count: number
}>()

const announcement = computed<string>(() => {
  if (props.count <= 0) {
    return ''
  }

  return props.count === 1
    ? 'A Google file link in your message can be attached.'
    : `${props.count} Google file links in your message can be attached.`
})
</script>

<template>
  <slot />
</template>

<script setup lang="ts">
const props = defineProps<{
  source: string
  streaming: boolean
}>()

provideMarkdownSource(() => {
  return {
    source: props.source,
    streaming: props.streaming,
  }
})
</script>

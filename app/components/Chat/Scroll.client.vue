<template>
  <div
    class="fixed z-20 bottom-38 sm:bottom-22 max-sm:right-4 sm:left-1/2 -translate-x-1/2 z-50"
  >
    <UiButton
      circle
      icon-name="lucide:chevrons-down"
      icon-only
      title="Scroll to bottom"
       tooltip-position="top"
      class="opacity-50 sm:opacity-20 dark:sm:opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity duration-300 [--depth:0]"
      @click="$emit('click')"
    />
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  click: []
}>()
</script>

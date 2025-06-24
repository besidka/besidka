<template>
  <UiBubble
    role="alert"
    class="sticky z-50 top-0 inset-x-0 !block px-10 max-sm:pl-4 !rounded-none !shadow-none"
  >
    <div class="w-full text-center text-xs sm:text-sm">
      <slot />
    </div>
    <div class="absolute right-4 top-1/2 -translate-y-1/2">
      <UiButton
        circle
        ghost
        size="xs"
        text="Hide"
        icon-only
        icon-name="lucide:x"
        @click="$emit('click')"
      />
    </div>
  </UiBubble>
</template>

<script setup lang="ts">
defineEmits<{
  click: []
}>()
</script>

<style scoped>
@reference '~/assets/css/main.css';

:deep(a) {
  @apply link;
}
</style>

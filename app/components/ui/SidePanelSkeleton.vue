<template>
  <div
    class="grid gap-3 py-4"
    aria-hidden="true"
    data-testid="side-panel-skeleton"
  >
    <div class="skeleton skeleton--default h-5 w-2/3" />
    <div class="skeleton skeleton--default h-4 w-1/3" />
    <div
      v-for="line in lines"
      :key="line"
      class="skeleton skeleton--default h-12 w-full"
    />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  lines?: number
}>(), {
  lines: 3,
})
</script>

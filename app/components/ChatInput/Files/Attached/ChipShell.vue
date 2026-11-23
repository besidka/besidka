<template>
  <div class="carousel-item flex items-center gap-1 relative">
    <slot v-if="isBare" />
    <div
      v-else
      class="flex items-center justify-center gap-1 bg-base-100/70 rounded-box p-1 relative"
    >
      <slot />
    </div>
    <slot name="outside" />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  isBare?: boolean
}>(), {
  isBare: false,
})
</script>

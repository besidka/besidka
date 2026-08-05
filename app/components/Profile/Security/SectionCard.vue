<template>
  <section
    class="bubble rounded-box p-6"
    :class="{ 'bg-error/10 border-error/35': danger }"
  >
    <h2
      class="text-lg font-bold"
      :class="{ 'text-error': danger }"
    >
      {{ heading }}
    </h2>
    <p
      v-if="description"
      class="mt-2 text-sm text-base-content/70"
    >
      {{ description }}
    </p>
    <div class="mt-4">
      <slot />
    </div>
  </section>
</template>
<script setup lang="ts">
withDefaults(defineProps<{
  heading: string
  description?: string
  danger?: boolean
}>(), {
  danger: false,
})
</script>

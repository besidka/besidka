<template>
  <div
    v-if="!isAlertHidden"
    role="alert"
    class="alert alert-info alert-soft sticky z-50 top-0 inset-x-0 !block px-10 max-sm:pl-4 rounded-t-none !shadow"
  >
    <div class="w-full text-center">
      <slot />
    </div>
    <div class="absolute right-4 top-1/2 -translate-y-1/2">
      <UiButton
        mode="info"
        circle
        ghost
        size="xs"
        text="Close"
        icon-only
        icon-name="lucide:x"
        @click="$emit('click')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  click: []
}>()

const isAlertHidden = useCookie('alert-hidden', {
  default: () => false,
})
</script>

<style scoped>
@reference '~/assets/css/main.css';

:deep(a) {
  @apply link;
}
</style>

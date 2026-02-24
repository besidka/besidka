<template>
  <NuxtLink
    to="/"
    class="relative z-10 btn w-35 h-auto max-w-full mb-0 p-0 !no-underline"
    :class="{
      'btn-circle btn-primary': !asLink,
      'btn-link': asLink,
    }"
    :disabled="!asLink && disabled"
  >
    <Logo :short="short" />
  </NuxtLink>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  short?: boolean
  asLink?: boolean
  disabled?: boolean | null
}>(), {
  disabled: null,
  asLink: true,
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.title-enter-active {
  @apply transition-all duration-500;
}

.title-enter-from {
  @apply opacity-0 transform -translate-x-8;
}
</style>

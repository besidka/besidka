<template>
  <component
    :is="logo"
    class="outline-none"
    :class="{
      spinning,
      once,
    }"
  />
</template>

<script setup lang="ts">
const props = defineProps<{
  short?: boolean
  spinning?: boolean
  once?: boolean
}>()

const logo = computed<ReturnType<typeof resolveComponent>>(() => {
  return props.short
    ? resolveComponent('SvgoFavicon')
    : resolveComponent('SvgoLogo')
})
</script>

<style scoped>
@reference "~/assets/css/main.css";

.spinning :deep(#Spin) {
  @apply motion-safe:animate-[spin_2s_ease-in-out_infinite]
        origin-center;
}

.spinning.once :deep(#Spin) {
  @apply motion-safe:animate-[spin_2s_ease-in-out_1]
        origin-center;
}
</style>

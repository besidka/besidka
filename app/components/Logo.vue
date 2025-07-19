<template>
  <component :is="logo" />
</template>

<script setup lang="ts">
const props = defineProps<{
  short?: boolean
}>()

const logo = computed<ReturnType<typeof resolveComponent>>(() => {
  return props.short
    ? resolveComponent('SvgoFavicon')
    : resolveComponent('SvgoLogo')
})
</script>

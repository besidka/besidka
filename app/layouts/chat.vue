<template>
  <NuxtPage/>
  <ClientOnly>
    <LazyNotificationPrompt />
  </ClientOnly>
</template>

<script setup lang="ts">
onMounted(() => {
  useNotificationPrompt().maybeShowProactively()
})
</script>

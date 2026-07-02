<template>
  <ClientOnly>
    <LazyNotificationPrompt />
  </ClientOnly>
  <NuxtPage/>
</template>

<script setup lang="ts">
onMounted(() => {
  useNotificationPrompt().maybeShowProactively()
})
</script>

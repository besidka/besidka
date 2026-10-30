<template>
  <div class="contents">
    <LazyLegalChangeNotice />
    <NuxtPage/>
  </div>
</template>

<script setup lang="ts">
onMounted(() => {
  useNotificationPrompt().maybeShowProactively()
})
</script>

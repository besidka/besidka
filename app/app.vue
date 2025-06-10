<template>
  <NuxtRouteAnnouncer />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <NuxtLoadingIndicator />
  <UiConfirmation />
  <UiMessages />
</template>

<script setup lang="ts">
const { siteName } = useAppConfig()

useHead({
  titleTemplate(titleChunk) {
    return titleChunk ? `${titleChunk} | ${siteName}` : `${siteName}`
  },
})
</script>

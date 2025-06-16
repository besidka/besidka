<template>
  <NuxtRouteAnnouncer />
  <NuxtErrorBoundary @error="onException">
    <template #error>
      <NuxtLayout />
    </template>
    <NuxtLayout />
  </NuxtErrorBoundary>
  <NuxtLoadingIndicator />
  <UiConfirmation />
  <UiMessages />
  <Sidebar />
  <LazyUiCursorGlow v-if="$device.isDesktop" />
</template>

<script setup lang="ts">
const { siteName } = useAppConfig()

useHead({
  titleTemplate(titleChunk) {
    return titleChunk ? `${titleChunk} | ${siteName}` : `${siteName}`
  },
})

function onException(exception: any) {
  useErrorMessage(exception.statusMessage ?? 'An unexpected error occurred.')

  throw exception
}
</script>

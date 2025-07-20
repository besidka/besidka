<template>
  <NuxtPwaManifest />
  <NuxtRouteAnnouncer />
  <NuxtErrorBoundary @error="onException">
    <template #error>
      <NuxtLayout />
    </template>
    <NuxtLayout />
  </NuxtErrorBoundary>
  <NuxtLoadingIndicator />
  <ClientOnly>
    <UiConfirmation />
    <UiMessages />
    <Sidebar />
    <LazyUiCursorGlow v-if="$device.isDesktop" />
    <LazyPwaRefresher v-if="$pwa?.needRefresh" />
  </ClientOnly>
</template>

<script setup lang="ts">
const { siteName } = useAppConfig()

useHead({
  titleTemplate(titleChunk) {
    return titleChunk ? `${titleChunk} | ${siteName}` : `${siteName}`
  },
})

if (import.meta.server) {
  const { baseUrl, description } = useRuntimeConfig().public

  useSeoMeta({
    ogUrl: baseUrl as string,
    robots: 'index, follow',
    title: siteName,
    ogTitle: siteName,
    description: description as string,
    ogDescription: description as string,
    ogImage: `${baseUrl}/og-image.png`,
    twitterCard: 'summary_large_image',
  })
}

function onException(exception: any) {
  useErrorMessage(exception.statusMessage ?? 'An unexpected error occurred.')

  throw exception
}
</script>

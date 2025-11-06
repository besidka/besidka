<template>
  <ClientOnly>
    <LazyPwaRefresher v-if="$pwa?.needRefresh" />
  </ClientOnly>
  <NuxtPwaManifest />
  <NuxtRouteAnnouncer />
  <NuxtLoadingIndicator />
  <div class="flex flex-col h-screen overflow-hidden">
    <div
      :class="{
        'contents': $route.name === 'chats-slug',
        [`
          flex-1 overflow-y-auto
          pt-[var(--sat)]
          pb-[calc(var(--spacing)_*_40_+_var(--sab))]
          [-webkit-overflow-scrolling:touch]
        `]: $route.name !== 'chats-slug',
      }"
    >
      <NuxtErrorBoundary @error="onException">
        <template #error>
          <NuxtLayout />
        </template>
        <NuxtLayout />
      </NuxtErrorBoundary>
    </div>
  </div>
  <ClientOnly>
    <UiConfirmation />
    <UiMessages />
    <Sidebar />
    <LazyUiCursorGlow v-if="$device.isDesktop" />
  </ClientOnly>
</template>

<script setup lang="ts">
const { siteName } = useAppConfig()

useHead({
  titleTemplate(titleChunk) {
    return titleChunk ? `${titleChunk} | ${siteName}` : `${siteName}`
  },
})

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

function onException(exception: any) {
  useErrorMessage(exception.statusMessage ?? 'An unexpected error occurred.')

  throw exception
}
</script>

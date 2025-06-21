<template>
  <NuxtRouteAnnouncer />
  <div
    :class="{
      'grid grid-rows-[auto_1fr] h-svh overflow-hidden': !isAlertHidden
    }"
  >
    <LazyUiAlert
      v-if="!isAlertHidden"
      @click="isAlertHidden = true"
    >
      <NuxtLink to="https://cloneathon.t3.chat" external target="_blank"><strong>T3 Cloneathon</strong></NuxtLink>: The code freeze version, prepared for the hackathon deadline, is available at <NuxtLink to="https://cloneathon.chernenko.chat" external rel="">https://cloneathon.chernenko.chat</NuxtLink>.
    </LazyUiAlert>
    <div
      :class="{
        'overflow-y-auto': !isAlertHidden
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

const isAlertHidden = useCookie('alert-hidden', {
  default: () => false,
})

function onException(exception: any) {
  useErrorMessage(exception.statusMessage ?? 'An unexpected error occurred.')

  throw exception
}
</script>

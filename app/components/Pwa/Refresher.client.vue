<template>
  <UiAlert
    class="-translate-y-full"
    :class="{
      'transition-transform duration-500 ease-in': !mounted,
      'translate-y-0': visible,
      '!hidden': !isVisible,
    }"
    @click="isVisible = false"
  >
    <span>
      The app has been updated. Please refresh it to see the latest changes.
    </span>
    <UiButton
      mode="accent"
      text="Refresh"
      size="xs"
      class="mt-2"
      :disabled="isRefreshing"
      @click="handleRefresh($pwa)"
    />
  </UiAlert>
</template>

<script setup lang="ts">
import type { NuxtApp } from '#app'

const REFRESH_FALLBACK_DELAY_MS = 4000

const { mounted, visible } = useAnimateAppear()
const isVisible = shallowRef<boolean>(true)
const isRefreshing = shallowRef<boolean>(false)

let hasReloaded = false
let fallbackTimeoutId: ReturnType<typeof setTimeout> | undefined

function reloadOnce() {
  if (hasReloaded) {
    return
  }

  hasReloaded = true
  clearTimeout(fallbackTimeoutId)
  navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce)
  window.location.reload()
}

function handleRefresh(pwa: NuxtApp['$pwa']) {
  if (isRefreshing.value) {
    return
  }

  isRefreshing.value = true

  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce)
  fallbackTimeoutId = setTimeout(reloadOnce, REFRESH_FALLBACK_DELAY_MS)

  pwa?.updateServiceWorker(true)
}

onUnmounted(() => {
  clearTimeout(fallbackTimeoutId)
  navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce)
})
</script>

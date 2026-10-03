<template>
  <UiAlert
    class="-translate-y-full"
    :class="{
      'transition-transform duration-500 ease-in': !mounted,
      'translate-y-0': visible,
      '!hidden': !isVisible,
    }"
    @click="handleDismiss"
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
      @click="handleRefresh"
    />
  </UiAlert>
</template>

<script setup lang="ts">
const REFRESH_FALLBACK_DELAY_MS = 4000

const { mounted, visible } = useAnimateAppear()
const pwa = usePWA()
const prefStorage = usePreferenceStorage()
const isChatStreaming = useState<boolean>('chat-streaming', () => false)

const initialDismissedUntil = readPwaRefresherDismissedUntil()
const isVisible = shallowRef<boolean>(initialDismissedUntil <= Date.now())
const isRefreshing = shallowRef<boolean>(false)

let hasReloaded = false
let fallbackTimeoutId: ReturnType<typeof setTimeout> | undefined
let reshowTimeoutId: ReturnType<typeof setTimeout> | undefined

function reloadOnce(): void {
  if (hasReloaded) {
    return
  }

  hasReloaded = true
  clearTimeout(fallbackTimeoutId)
  navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce)
  window.location.reload()
}

function applyUpdate(): void {
  if (isRefreshing.value) {
    return
  }

  isRefreshing.value = true

  navigator.serviceWorker.addEventListener('controllerchange', reloadOnce)
  fallbackTimeoutId = setTimeout(reloadOnce, REFRESH_FALLBACK_DELAY_MS)

  pwa?.updateServiceWorker(true)
}

function handleRefresh(): void {
  applyUpdate()
}

function scheduleReshow(delayMs: number): void {
  clearTimeout(reshowTimeoutId)
  reshowTimeoutId = setTimeout(() => {
    isVisible.value = true
  }, delayMs)
}

// Dismissal defers the banner rather than killing it: `$pwa.needRefresh`
// stays true after a close, so without a re-show the tab would keep running
// stale JS indefinitely (until the next deploy re-triggers the prompt).
function handleDismiss(): void {
  const dismissedUntil = Date.now() + PWA_REFRESHER_DISMISS_INTERVAL_MS

  isVisible.value = false
  writePwaRefresherDismissedUntil(dismissedUntil)
  scheduleReshow(PWA_REFRESHER_DISMISS_INTERVAL_MS)
}

function hasUnsentChatDraft(): boolean {
  return Boolean(prefStorage.getItem('chat_input')?.trim())
}

// Applies the pending update on its own, but only while the tab is hidden
// and nothing would be lost by reloading it: no chat turn is streaming, and
// there's no unsent draft sitting in the composer.
function checkAutoApply(): void {
  if (!pwa?.needRefresh || isRefreshing.value) {
    return
  }

  if (hasRecentPwaAutoApply()) {
    return
  }

  if (!shouldAutoApplyPwaUpdate({
    visibilityState: document.visibilityState,
    isChatStreaming: isChatStreaming.value,
    hasUnsentDraft: hasUnsentChatDraft(),
  })) {
    return
  }

  markPwaAutoApplied()
  applyUpdate()
}

function handleVisibilityChange(): void {
  checkAutoApply()
}

if (initialDismissedUntil > Date.now()) {
  scheduleReshow(initialDismissedUntil - Date.now())
}

onMounted(() => {
  document.addEventListener('visibilitychange', handleVisibilityChange)
  checkAutoApply()
})

onUnmounted(() => {
  clearTimeout(fallbackTimeoutId)
  clearTimeout(reshowTimeoutId)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  navigator.serviceWorker.removeEventListener('controllerchange', reloadOnce)
})
</script>

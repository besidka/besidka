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
      @click="$pwa?.updateServiceWorker(true)"
    />
  </UiAlert>
</template>

<script setup lang="ts">
const { mounted, visible } = useAnimateAppear()
const isVisible = shallowRef<boolean>(true)
</script>

<template>
  <UiAlert
    class="transition-transform -translate-y-full duration-500 ease-in"
    :class="{
      'translate-y-0': mounted,
    }"
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
const mounted = shallowRef<boolean>(false)

onMounted(() => {
  setTimeout(() => {
    mounted.value = true
  }, 2000)
})
</script>

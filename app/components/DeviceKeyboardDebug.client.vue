<template>
  <div
    v-if="isDebugEnabled"
    class="
      fixed top-[calc(var(--sat)_+_var(--spacing)_*_2)] left-2 z-[100]
      max-w-[calc(100%-var(--spacing)_*_4)] rounded-box bg-black/80
      px-3 py-2 text-xs text-white pointer-events-none
    "
  >
    <div>keyboard: {{ metrics.isOpen ? 'open' : 'closed' }}</div>
    <div>height: {{ metrics.keyboardHeight }}</div>
    <div>vvh: {{ metrics.visualViewportHeight }}</div>
    <div>vv offset top: {{ metrics.visualViewportOffsetTop }}</div>
    <div>lvh: {{ metrics.layoutViewportHeight }}</div>
    <div>focus top: {{ metrics.focusedElementTop ?? 'n/a' }}</div>
    <div>focus bottom: {{ metrics.focusedElementBottom ?? 'n/a' }}</div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { metrics } = useDeviceKeyboard()

const isDebugEnabled = computed<boolean>(() => {
  return route.query['keyboard-debug'] === '1'
})
</script>

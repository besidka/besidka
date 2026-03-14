<template>
  <div v-if="false" aria-hidden="true" />
</template>

<script setup lang="ts">
const nuxtApp = useNuxtApp()
const { metrics } = useDeviceKeyboard()

let previousIsOpen: boolean = false

function applyCssVariables(payload: DeviceKeyboardViewportChangedPayload) {
  const rootStyle = document.documentElement.style

  rootStyle.setProperty(
    '--visual-viewport-height',
    `${payload.visualViewportHeight}px`,
  )
  rootStyle.setProperty(
    '--visual-viewport-offset-top',
    `${payload.visualViewportOffsetTop}px`,
  )
  rootStyle.setProperty(
    '--layout-viewport-height',
    `${payload.layoutViewportHeight}px`,
  )
  rootStyle.setProperty(
    '--keyboard-height',
    `${payload.keyboardHeight}px`,
  )
}

function updateMetrics() {
  const activeElement = document.activeElement
  const payload = buildDeviceKeyboardPayload({
    activeElement,
    focusedElementRect: isEditableElement(activeElement)
      ? activeElement.getBoundingClientRect()
      : null,
    layoutViewportHeight: window.innerHeight,
    visualViewport: window.visualViewport,
  })

  metrics.value = payload
  applyCssVariables(payload)

  nuxtApp.callHook('device-keyboard:viewport-changed', payload)

  if (payload.isOpen !== previousIsOpen) {
    previousIsOpen = payload.isOpen
    nuxtApp.callHook('device-keyboard:state-changed', payload.isOpen)
  }
}

onMounted(() => {
  updateMetrics()

  window.addEventListener('resize', updateMetrics)
  window.addEventListener('orientationchange', updateMetrics)
  document.addEventListener('focusin', updateMetrics)
  document.addEventListener('focusout', updateMetrics)
  window.visualViewport?.addEventListener('resize', updateMetrics)
  window.visualViewport?.addEventListener('scroll', updateMetrics)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', updateMetrics)
  window.removeEventListener('orientationchange', updateMetrics)
  document.removeEventListener('focusin', updateMetrics)
  document.removeEventListener('focusout', updateMetrics)
  window.visualViewport?.removeEventListener('resize', updateMetrics)
  window.visualViewport?.removeEventListener('scroll', updateMetrics)
})
</script>

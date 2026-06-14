<script setup lang="ts">
import { computed } from 'vue'
import { useCookieConsentUi } from '../composables/ui'

defineOptions({ inheritAttrs: false })

const ui = useCookieConsentUi()

const isOpen = computed(() => ui.view.value !== 'hidden')

function handleClick(event: MouseEvent): void {
  if (ui.view.value === 'hidden') {
    ui.openPopup(event.currentTarget as HTMLElement)
  } else {
    ui.close()
  }
}
</script>

<template>
  <button
    v-bind="$attrs"
    type="button"
    aria-haspopup="dialog"
    :aria-expanded="isOpen"
    @click="handleClick"
  >
    <slot :is-open="isOpen" />
  </button>
</template>

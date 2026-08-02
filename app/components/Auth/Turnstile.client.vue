<template>
  <div
    v-if="isEnabled"
    ref="containerRef"
  />
</template>

<script setup lang="ts">
const props = defineProps<{
  action: string
}>()

const {
  isEnabled,
  renderWidget,
  execute: executeWidget,
  reset: resetWidget,
  remove,
} = useTurnstile()

const containerRef = shallowRef<HTMLDivElement | null>(null)
const widgetId = shallowRef<string | null>(null)

onMounted(async () => {
  if (!isEnabled.value || !containerRef.value) {
    return
  }

  widgetId.value = await renderWidget(containerRef.value, {
    action: props.action,
  })
})

onUnmounted(() => {
  if (!widgetId.value) {
    return
  }

  remove(widgetId.value)
})

async function execute(): Promise<string> {
  if (!isEnabled.value || !widgetId.value) {
    return ''
  }

  return executeWidget(widgetId.value)
}

function reset(): void {
  if (!widgetId.value) {
    return
  }

  resetWidget(widgetId.value)
}

defineExpose({
  execute,
  reset,
})
</script>

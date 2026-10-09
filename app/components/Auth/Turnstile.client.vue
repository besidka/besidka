<template>
  <div
    v-if="isEnabled"
    class="grid w-full transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none"
    :class="isInteractive
      ? 'grid-rows-[1fr] opacity-100'
      : 'grid-rows-[0fr] opacity-0'"
    :aria-hidden="!isInteractive"
    :inert="!isInteractive"
    :data-interactive="isInteractive"
    data-testid="turnstile-wrapper"
  >
    <div class="min-h-0 overflow-hidden">
      <div class="pt-4">
        <div
          class="relative rounded-[3px]"
          :class="isCompact ? 'mx-auto w-fit' : 'w-full'"
        >
          <div
            ref="containerRef"
            class="w-full leading-[0] [clip-path:inset(1px_round_2px)]"
            data-testid="turnstile-container"
          />
          <div
            class="pointer-events-none absolute inset-0 rounded-[3px] border border-base-content/20"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  </div>
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
const isInteractive = shallowRef<boolean>(false)
const isCompact = shallowRef<boolean>(false)

onMounted(async () => {
  await nextTick()

  if (!isEnabled.value || !containerRef.value) {
    return
  }

  isCompact.value = isNarrowTurnstileWidth(containerRef.value.clientWidth)

  widgetId.value = await renderWidget(containerRef.value, {
    action: props.action,
    size: isCompact.value ? 'compact' : 'flexible',
    onInteractiveChange: (value: boolean) => {
      isInteractive.value = value
    },
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
  isInteractive.value = false

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

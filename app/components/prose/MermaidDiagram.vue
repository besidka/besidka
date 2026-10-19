<template>
  <div>
    <div
      v-if="!svg"
      class="skeleton skeleton--default h-20 w-full"
    />
    <div
      ref="container"
      class="
        js-mermaid-diagram mermaid-diagram
        flex justify-center overflow-x-auto
      "
      data-testid="mermaid-diagram"
      v-html="svg"
    />
  </div>
</template>

<script setup lang="ts">
import type { DiagramRenderError } from '~/types/diagram.d'

const props = defineProps<{
  code: string
}>()

const emit = defineEmits<{
  error: [error: DiagramRenderError]
  rendered: []
}>()

const { renderDiagram } = useDiagramRenderer()

const container = useTemplateRef<HTMLElement>('container')
const svg = shallowRef<string>('')
const isMounted = shallowRef<boolean>(false)
const idPrefix = `mermaid-${useId()}`

watch([() => props.code, isMounted], async ([code], _previous, onCleanup) => {
  if (!isMounted.value) {
    return
  }

  let isStale = false

  onCleanup(() => {
    isStale = true
  })

  const result = await renderDiagram(code, {
    idPrefix,
    maxWidth: container.value?.clientWidth,
  })

  if (isStale) {
    return
  }

  if ('error' in result) {
    emit('error', result.error)

    return
  }

  svg.value = result.svg
  emit('rendered')
})

onMounted(() => {
  isMounted.value = true
})
</script>

<style scoped>
.mermaid-diagram {
  --pele-bg: var(--color-base-100);
  --pele-fg: var(--color-base-content);
  --pele-muted: color-mix(in oklab, var(--color-base-content) 60%, transparent);
  --pele-line: var(--color-base-content);
  --pele-surface: var(--color-base-200);
  --pele-surface-alt: var(--color-base-300);
  --pele-border: color-mix(
    in oklab,
    var(--color-base-content) 35%,
    var(--color-base-100)
  );
  --pele-accent: var(--color-primary);
  --pele-critical: var(--color-error);
  --pele-error: var(--color-error);
  --pele-font: var(--font-display, 'Nunito', sans-serif);
  --pele-font-mono: var(--font-code, 'Atkinson Hyperlegible Mono', monospace);
  --pele-series-1: var(--color-primary);
  --pele-series-2: var(--color-secondary);
  --pele-series-3: var(--color-accent);
  --pele-series-4: var(--color-info);
  --pele-series-5: var(--color-success);
  --pele-series-6: var(--color-warning);
  --pele-series-7: var(--color-error);
  --pele-series-8: var(--color-neutral);
}
</style>

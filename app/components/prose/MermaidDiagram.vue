<template>
  <div class="relative">
    <div
      v-if="!svg"
      class="skeleton skeleton--default h-20 w-full"
    />
    <button
      v-if="isInteractive"
      type="button"
      class="
        js-mermaid-open btn btn-xs
        sr-only focus:not-sr-only focus:absolute focus:right-2 focus:top-2
        focus:z-10
      "
      data-testid="mermaid-diagram-open"
      @click="requestOpen"
    >
      Open diagram in fullscreen
    </button>
    <div
      ref="container"
      class="
        js-mermaid-diagram mermaid-diagram pele-theme
        flex justify-center overflow-x-auto
      "
      :class="{
        'cursor-zoom-in': isInteractive,
        'invisible': isHidden,
      }"
      data-testid="mermaid-diagram"
      @click="requestOpen"
      v-html="svg"
    />
  </div>
</template>

<script setup lang="ts">
import type { DiagramRenderError } from '~/types/diagram.d'

const props = defineProps<{
  code: string
  isHidden?: boolean
}>()

const emit = defineEmits<{
  error: [error: DiagramRenderError]
  rendered: [payload: { svg: string }]
  open: []
}>()

const { renderDiagram } = useDiagramRenderer()

const container = useTemplateRef<HTMLElement>('container')
const svg = shallowRef<string>('')
const isMounted = shallowRef<boolean>(false)
const idPrefix = `mermaid-${useId()}`

const isInteractive = computed<boolean>(() => {
  return !!svg.value
})

function requestOpen() {
  if (!isInteractive.value) {
    return
  }

  emit('open')
}

function getThemeElement(): HTMLElement | null {
  return container.value
}

defineExpose({ getThemeElement })

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
  emit('rendered', { svg: result.svg })
})

onMounted(() => {
  isMounted.value = true
})
</script>

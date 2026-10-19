<template>
  <div
    class="mockup-browser w-full my-4 bg-base-100/50 dark:bg-base-100/50 shadow overflow-x-clip overflow-y-visible"
  >
    <div class="flex items-center justify-between">
      <div class="mockup-browser-toolbar"/>
      <div class="flex gap-2 py-2 pr-4">
        <UiButton
          v-if="isDiagramToggleVisible"
          mode="default"
          ghost
          :icon-name="isDiagramView ? 'lucide:code' : 'lucide:workflow'"
          :icon-size="14"
          size="xs"
          :text="isDiagramView ? 'Code' : 'Diagram'"
          :icon-only-phone="isDiagramView"
          data-testid="mermaid-toggle"
          @click="isCodeViewSelected = !isCodeViewSelected"
        />
        <UiButton
          v-if="isDiagramView"
          mode="default"
          ghost
          icon-name="lucide:maximize"
          :icon-size="14"
          size="xs"
          text="Fullscreen"
          icon-only-phone
          :disabled="!diagramSvg"
          data-testid="mermaid-fullscreen"
          @click="openViewer"
        />
        <ProseMermaidExportMenu
          v-if="isDiagramView"
          :source="trimmedCode"
          :svg="diagramSvg"
          :theme-element="getDiagramThemeElement"
        />
        <UiButton
          v-if="isExpandButtonVisible && !isDiagramView"
          mode="default"
          ghost
          :icon-name="expanded
            ? 'lucide:minimize-2'
            : 'lucide:maximize-2'
          "
          :icon-size="14"
          size="xs"
          :text="expanded ? 'Collapse' : 'Expand'"
          @click="expanded = !expanded"
        />
        <UiButton
          mode="default"
          ghost
          :icon-name="copied ? 'lucide:check' : 'lucide:copy'"
          :icon-size="14"
          size="xs"
          :text="copied ? 'Copied!' : 'Copy'"
          :icon-only-phone="isDiagramView"
          @click="copy"
        />
      </div>
    </div>
    <div
      class="p-4 overflow-x-auto text-sm"
      :class="{
        'overflow-y-auto max-h-30': !expanded && !isDiagramView
      }"
    >
      <ClientOnly>
        <template #fallback>
          <ProsePre v-bind="props" class="motion-safe:animate-pulse">
            {{ trimmedCode }}
          </ProsePre>
        </template>
        <ProseMermaidDiagram
          v-if="isDiagramView"
          ref="diagram"
          :code="trimmedCode"
          :is-hidden="isViewerOpen"
          @error="diagramError = $event"
          @rendered="diagramSvg = $event.svg"
          @open="openViewer"
        />
        <ProsePre v-else v-bind="props">
          <ShikiCachedRenderer
            :key="key"
            :highlighter="highlighter as any"
            :code="trimmedCode"
            :lang="lang"
            :theme="$colorMode.value === 'dark'
              ? 'github-dark'
              : 'github-light'
            "
          >
            Render
          </ShikiCachedRenderer>
        </ProsePre>
      </ClientOnly>
    </div>
    <p
      v-if="diagramError"
      class="px-4 pb-3 text-xs text-base-content/60"
      data-testid="mermaid-error"
    >
      {{ diagramErrorText }}
    </p>
    <LazyProseMermaidViewer
      v-if="isViewerOpen"
      v-model:open="isViewerOpen"
      :source="trimmedCode"
    />
  </div>
</template>

<script setup lang="ts">
import { ShikiCachedRenderer } from 'shiki-stream/vue'
import type { DiagramRenderError } from '~/types/diagram.d'

const props = defineProps<{
  code: string
  language: string
  class?: string
  meta?: string
}>()

const DIAGRAM_ERROR_LIMIT: number = 200

const colorMode = useColorMode()
const clipboard = useClipboard()
const highlighter = await useHighlighter()
const markdownSource = useMarkdownSource()

const trimmedCode = computed<string>(() => {
  try {
    return props.code.trim().replace(/`+$/, '')
  } catch {
    return props.code
  }
})

const isMermaid = computed<boolean>(() => {
  return props.language?.toLowerCase() === 'mermaid'
})

const isMermaidComplete = computed<boolean>(() => {
  const { source, streaming } = markdownSource.value

  return !streaming
    || isFencedBlockClosed(source, 'mermaid', trimmedCode.value)
})

const diagramError = shallowRef<DiagramRenderError | null>(null)
const diagramSvg = shallowRef<string>('')
const isViewerOpen = shallowRef<boolean>(false)
const diagramRef = useTemplateRef<{
  getThemeElement: () => HTMLElement | null
}>('diagram')
const isCodeViewSelected = shallowRef<boolean>(false)
const isMounted = shallowRef<boolean>(false)

const isDiagramCandidate = computed<boolean>(() => {
  return isMermaid.value && isMermaidComplete.value && !diagramError.value
})

const isDiagramToggleVisible = computed<boolean>(() => {
  return isMounted.value && isDiagramCandidate.value
})

const isDiagramView = computed<boolean>(() => {
  return isDiagramCandidate.value && !isCodeViewSelected.value
})

const diagramErrorText = computed<string>(() => {
  const error = diagramError.value

  if (!error) {
    return ''
  }

  const position = error.line
    ? ` (line ${error.line}${error.column ? `, column ${error.column}` : ''})`
    : ''

  const message = error.message.length > DIAGRAM_ERROR_LIMIT
    ? `${error.message.slice(0, DIAGRAM_ERROR_LIMIT)}…`
    : error.message

  return `Couldn't render diagram: ${message}${position}`
})

watch(trimmedCode, () => {
  diagramError.value = null
  diagramSvg.value = ''
})

watch(isDiagramView, (isVisible) => {
  if (!isVisible) {
    diagramSvg.value = ''
  }
})

function getDiagramThemeElement(): HTMLElement | null {
  return diagramRef.value?.getThemeElement() ?? null
}

function openViewer() {
  if (!diagramSvg.value) {
    return
  }

  isViewerOpen.value = true
}

const codeLines = computed<number>(() => {
  const lines = trimmedCode.value.match(/\r?\n/gm)

  return lines ? lines.length + 1 : 1
})

const lang = computed<string>(() => {
  let language = props.language

  switch (props.language) {
    case 'vue':
      language = 'vue'
      break
    case 'javascript':
      language = 'js'
      break
    case 'typescript':
      language = 'ts'
      break
    case 'css':
      language = 'css'
      break
    default:
      language = props.language
  }

  const loadedLanguages = highlighter.getLoadedLanguages()

  return loadedLanguages.includes(language) ? language : 'text'
})

const key = computed<string>(() => {
  return `${lang.value}-${colorMode.value}`
})

const copied = shallowRef(false)

function copy() {
  clipboard.copy(trimmedCode.value)

  copied.value = true

  setTimeout(() => {
    copied.value = false
  }, 2000)
}

const expanded = shallowRef(codeLines.value < 3)
const isExpandButtonVisible = shallowRef(codeLines.value >= 3)
const timer = ref<NodeJS.Timeout | null>(null)
const savedCodeState = shallowRef<string>(props.code)

function updateExpandedState() {
  if (codeLines.value < 3) {
    return
  }

  expanded.value = false
  isExpandButtonVisible.value = true
}

onBeforeMount(() => {
  savedCodeState.value = props.code
})

onMounted(() => {
  isMounted.value = true

  timer.value = setInterval(() => {
    if (props.code.length !== savedCodeState.value.length) {
      savedCodeState.value = props.code

      return
    }

    updateExpandedState()

    if (timer.value) {
      clearTimeout(timer.value)
    }
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer.value) {
    clearTimeout(timer.value)
  }
})
</script>

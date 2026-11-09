<template>
  <div
    class="mockup-browser w-full my-4 bg-base-100/50 dark:bg-base-100/50 shadow overflow-x-clip overflow-y-visible"
    :data-code-source="isDiagramView ? effectiveSource : undefined"
  >
    <div class="js-clipboard-skip flex items-center justify-between">
      <div
        class="mockup-browser-toolbar w-auto! shrink-0 pr-0!"
        :class="{ 'max-sm:hidden': isToolbarCrowded }"
        data-testid="mermaid-window-dots"
      />
      <div
        class="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1 py-2 pr-4 sm:gap-2"
      >
        <span
          v-if="isEdited"
          class="badge badge-sm"
          data-testid="mermaid-edited-badge"
        >
          Edited
        </span>
        <UiButton
          v-if="isEditing"
          mode="default"
          ghost
          icon-name="lucide:check"
          :icon-size="14"
          size="xs"
          text="Done"
          icon-only-phone
          data-testid="mermaid-edit-done"
          @click="finishEditing"
        />
        <UiButton
          v-if="isEditing ? isEditorTextChanged : isEdited"
          mode="default"
          ghost
          icon-name="lucide:rotate-ccw"
          :icon-size="14"
          size="xs"
          text="Reset"
          icon-only-phone
          data-testid="mermaid-edit-reset"
          @click="resetEdits"
        />
        <UiButton
          v-if="isDiagramToggleVisible && !isEditing"
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
          v-if="isEditButtonVisible"
          ref="editButton"
          mode="default"
          ghost
          icon-name="lucide:pencil"
          :icon-size="14"
          size="xs"
          text="Edit"
          icon-only-phone
          data-testid="mermaid-edit"
          @click="startEditing"
        />
        <UiButton
          v-if="isDiagramCandidate"
          mode="default"
          ghost
          icon-name="lucide:maximize"
          :icon-size="14"
          size="xs"
          text="Fullscreen"
          icon-only-phone
          :disabled="!menuInput.svg"
          data-testid="mermaid-fullscreen"
          @click="openViewer"
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
        <ProseMermaidActionMenu
          v-if="isDiagramCandidate"
          label="Download"
          icon="lucide:download"
          test-id="mermaid-download"
          :actions="MERMAID_DOWNLOAD_ACTIONS"
          :input="menuInput"
        />
        <ProseMermaidActionMenu
          v-if="isDiagramCandidate"
          label="Copy"
          icon="lucide:copy"
          test-id="mermaid-copy"
          :actions="MERMAID_COPY_ACTIONS"
          :input="menuInput"
        />
        <UiButton
          v-else
          mode="default"
          ghost
          :icon-name="copied ? 'lucide:check' : 'lucide:copy'"
          :icon-size="14"
          size="xs"
          :text="copied ? 'Copied!' : 'Copy'"
          @click="copy"
        />
      </div>
    </div>
    <div
      ref="themeHost"
      class="p-4 overflow-x-auto text-sm"
      :class="{
        'pele-theme': isMermaid,
        'overflow-y-auto max-h-30': !expanded && !isDiagramView
      }"
      data-testid="mermaid-theme-host"
    >
      <ClientOnly>
        <template #fallback>
          <ProsePre v-bind="props" class="motion-safe:animate-pulse">
            {{ effectiveSource }}
          </ProsePre>
        </template>
        <ProseMermaidEditor
          v-if="isEditing"
          v-model="editorText"
          @exit="finishEditing"
        />
        <p
          v-if="isEditing && diagramError"
          class="js-clipboard-skip pt-2 text-xs text-base-content/60"
          data-testid="mermaid-error"
        >
          {{ diagramErrorText }}
        </p>
        <ProseMermaidDiagram
          v-if="isDiagramView"
          :class="{ 'mt-3': isEditing }"
          :code="effectiveSource"
          :is-hidden="isViewerOpen"
          :has-error="!!diagramError"
          @error="onDiagramError"
          @rendered="onDiagramRendered"
          @open="openViewer"
        />
        <ProsePre v-else v-bind="props">
          <ShikiCachedRenderer
            v-if="highlighter && !sourceOnly"
            :key="key"
            :highlighter="highlighter as any"
            :code="effectiveSource"
            :lang="lang"
            :theme="shikiTheme"
          >
            Render
          </ShikiCachedRenderer>
          <pre
            v-else
            class="shiki shiki-stream"
            data-testid="code-static"
            :data-highlighted="staticTokens ? 'true' : 'false'"
          ><code v-if="staticTokens"><template
            v-for="(line, lineIndex) in staticTokens"
            :key="lineIndex"
          ><span
            v-for="(token, tokenIndex) in line"
            :key="tokenIndex"
            :style="getTokenStyleObject(token)"
          >{{ token.content }}</span>{{
            lineIndex < staticTokens.length - 1 ? '\n' : ''
          }}</template></code><code v-else>{{ effectiveSource }}</code></pre>
        </ProsePre>
      </ClientOnly>
    </div>
    <p
      v-if="diagramError && !isEditing"
      class="js-clipboard-skip px-4 pb-3 text-xs text-base-content/60"
      data-testid="mermaid-error"
    >
      {{ diagramErrorText }}
    </p>
    <LazyProseMermaidViewer
      v-if="isViewerOpen"
      v-model:open="isViewerOpen"
      :source="effectiveSource"
    />
  </div>
</template>

<script setup lang="ts">
import { ShikiCachedRenderer } from 'shiki-stream/vue'
import { getTokenStyleObject } from 'shiki/core'
import type { HighlighterGeneric, ThemedToken } from 'shiki'
import type { DiagramRenderError } from '~/types/diagram.d'
import type { DiagramMenuInput } from '~/types/diagram-export.d'

const props = defineProps<{
  code: string
  language: string
  class?: string
  meta?: string
  sourceOnly?: boolean
  alwaysExpanded?: boolean
}>()

const DIAGRAM_ERROR_LIMIT: number = 200
const EDIT_COMMIT_DELAY_MS: number = 250

const colorMode = useColorMode()
const clipboard = useClipboard()
const highlighter = shallowRef<HighlighterGeneric<any, any> | null>(
  getLoadedHighlighter(),
)
const staticTokens = shallowRef<ThemedToken[][] | null>(null)
const markdownSource = useMarkdownSource()

const trimmedCode = computed<string>(() => {
  try {
    return props.code.trim().replace(/`+$/, '')
  } catch {
    return props.code
  }
})

const isMermaid = computed<boolean>(() => {
  return !props.sourceOnly && props.language?.toLowerCase() === 'mermaid'
})

const isMermaidComplete = computed<boolean>(() => {
  const { source, streaming } = markdownSource.value

  return !streaming
    || isFencedBlockClosed(source, 'mermaid', trimmedCode.value)
})

const diagramError = shallowRef<DiagramRenderError | null>(null)
const diagramSvg = shallowRef<string>('')
const diagramSvgSource = shallowRef<string>('')
const diagramErrorSource = shallowRef<string>('')
const isViewerOpen = shallowRef<boolean>(false)
const themeHostRef = useTemplateRef<HTMLElement>('themeHost')
const editButtonRef = useTemplateRef<{ focus: () => void }>('editButton')
const isCodeViewSelected = shallowRef<boolean>(false)
const isMounted = shallowRef<boolean>(false)
const isEditing = shallowRef<boolean>(false)
const editorText = shallowRef<string>('')
const editedSource = shallowRef<string | null>(null)

const effectiveSource = computed<string>(() => {
  return editedSource.value ?? trimmedCode.value
})

const isEdited = computed<boolean>(() => {
  return editedSource.value !== null
    && editedSource.value !== trimmedCode.value
})

const isToolbarCrowded = computed<boolean>(() => {
  return isEditing.value || isEdited.value
})

const isEditorTextChanged = computed<boolean>(() => {
  return editorText.value !== trimmedCode.value
})

const isDiagramErrorCurrent = computed<boolean>(() => {
  return !!diagramError.value
    && diagramErrorSource.value === effectiveSource.value
})

const isDiagramCandidate = computed<boolean>(() => {
  return isMermaid.value
    && isMermaidComplete.value
    && (isEditing.value || !isDiagramErrorCurrent.value)
})

const isDiagramToggleVisible = computed<boolean>(() => {
  return isMounted.value && isDiagramCandidate.value
})

const isEditButtonVisible = computed<boolean>(() => {
  return isMounted.value
    && isMermaid.value
    && isMermaidComplete.value
    && !isEditing.value
})

const isDiagramView = computed<boolean>(() => {
  return isDiagramCandidate.value
    && (isEditing.value || !isCodeViewSelected.value)
})

const menuInput = computed<DiagramMenuInput>(() => {
  if (isDiagramErrorCurrent.value || !diagramSvg.value) {
    return {
      source: effectiveSource.value,
      svg: '',
      themeElement: getThemeElement,
    }
  }

  return {
    source: diagramSvgSource.value,
    svg: diagramSvg.value,
    themeElement: getThemeElement,
  }
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

watch(trimmedCode, (code, previousCode) => {
  if (isEditing.value && editorText.value === previousCode) {
    editorText.value = code
  }

  if (editedSource.value !== null) {
    return
  }

  diagramSvg.value = ''
  diagramSvgSource.value = ''
})

function commitEditorText() {
  editedSource.value = editorText.value === trimmedCode.value
    ? null
    : editorText.value
}

const { start: startCommitTimer, stop: stopCommitTimer } = useTimeoutFn(
  commitEditorText,
  EDIT_COMMIT_DELAY_MS,
  { immediate: false },
)

watch(editorText, () => {
  if (isEditing.value && editorText.value !== effectiveSource.value) {
    startCommitTimer()
  }
})

function startEditing() {
  editorText.value = effectiveSource.value
  isCodeViewSelected.value = false
  isEditing.value = true
}

async function finishEditing() {
  stopCommitTimer()
  commitEditorText()
  isEditing.value = false

  await nextTick()

  editButtonRef.value?.focus()
}

function resetEdits() {
  stopCommitTimer()
  editorText.value = trimmedCode.value
  editedSource.value = null
}

function onDiagramError(error: DiagramRenderError) {
  diagramError.value = error
  diagramErrorSource.value = effectiveSource.value
}

function onDiagramRendered(payload: { svg: string, source: string }) {
  diagramError.value = null
  diagramSvg.value = payload.svg
  diagramSvgSource.value = payload.source
}

function getThemeElement(): HTMLElement | null {
  return themeHostRef.value
}

function openViewer() {
  if (!menuInput.value.svg) {
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

  const loadedLanguages = highlighter.value?.getLoadedLanguages() ?? []

  return loadedLanguages.includes(language) ? language : 'text'
})

const key = computed<string>(() => {
  return `${lang.value}-${colorMode.value}`
})

const shikiTheme = computed<string>(() => {
  return colorMode.value === 'dark'
    ? 'github-dark-high-contrast'
    : 'github-light-high-contrast'
})

let staticHighlightRun = 0

function readCachedStaticTokens(): ThemedToken[][] | null {
  if (!props.sourceOnly || !highlighter.value) {
    return null
  }

  return getCachedStaticTokens({
    highlighter: highlighter.value,
    code: effectiveSource.value,
    lang: lang.value,
    theme: shikiTheme.value,
  })
}

/**
 * Colours finished code after the plain text has painted: wait for a frame,
 * then a task, so the click that showed this block is never held up by
 * loading the highlighter or tokenizing. A newer request wins.
 */
async function highlightAfterPaint() {
  const run = ++staticHighlightRun

  staticTokens.value = readCachedStaticTokens()

  if (!props.sourceOnly || staticTokens.value) {
    return
  }

  await yieldToNextFrame()

  if (!highlighter.value) {
    highlighter.value = await useHighlighter()
  }

  if (run !== staticHighlightRun) {
    return
  }

  staticTokens.value = highlightStaticCode({
    highlighter: highlighter.value,
    code: effectiveSource.value,
    lang: lang.value,
    theme: shikiTheme.value,
  })
}

async function yieldToNextFrame() {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      setTimeout(resolve, 0)
    })
  })
}

async function loadStreamingHighlighter() {
  if (props.sourceOnly || highlighter.value) {
    return
  }

  highlighter.value = await useHighlighter()
}

watch([effectiveSource, shikiTheme], () => {
  if (!isMounted.value) {
    return
  }

  highlightAfterPaint()
})

const copied = shallowRef(false)

function copy() {
  clipboard.copy(effectiveSource.value)

  copied.value = true

  setTimeout(() => {
    copied.value = false
  }, 2000)
}

const expanded = shallowRef(props.alwaysExpanded || codeLines.value < 3)
const isExpandButtonVisible = shallowRef(
  !props.alwaysExpanded && codeLines.value >= 3,
)
const timer = ref<NodeJS.Timeout | null>(null)
const savedCodeState = shallowRef<string>(props.code)

function updateExpandedState() {
  if (props.alwaysExpanded || codeLines.value < 3) {
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
  highlightAfterPaint()
  loadStreamingHighlighter()

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

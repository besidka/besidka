<template>
  <div
    ref="mirrorRef"
    class="composer-command-mirror pointer-events-none absolute inset-0 z-10 overflow-hidden whitespace-pre-wrap break-words text-transparent"
    :style="metrics"
    aria-hidden="true"
    data-testid="command-mirror"
  ><template v-for="segment in segments" :key="segment.start"><mark
    v-if="segment.kind"
    class="composer-command-token"
    :data-kind="segment.kind"
    :data-caret="readCaretEdge(segment)"
    :data-reveal="isRevealed(segment) ? 'true' : undefined"
    :data-testid="segment.kind === 'command'
      ? 'command-mirror-token'
      : 'command-mirror-link'"
  >{{ segment.text }}</mark
  ><template v-else>{{ segment.text }}</template
  ></template
  ></div>
</template>

<script setup lang="ts">
import type { StyleValue } from 'vue'
import type {
  ComposerMirrorRange,
  ComposerMirrorSegment,
} from '~/utils/composer-mirror-ranges'

const MIRRORED_PROPERTIES = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'letterSpacing',
  'lineHeight',
  'wordSpacing',
  'tabSize',
  'textTransform',
  'textIndent',
  'fontKerning',
  'fontVariantLigatures',
  'fontFeatureSettings',
  'fontStretch',
  'textRendering',
  'hyphens',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
] as const

const props = defineProps<{
  textarea: HTMLTextAreaElement | null | undefined
  text: string
  ranges?: ComposerMirrorRange[]
  start?: number
  end?: number
}>()

const mirrorRef = useTemplateRef<HTMLDivElement>('mirrorRef')
const metrics = shallowRef<StyleValue>({})
const selectionStart = shallowRef<number | null>(null)
const selectionEnd = shallowRef<number | null>(null)

const requestedRanges = computed<ComposerMirrorRange[]>(() => {
  if (props.ranges) {
    return props.ranges
  }

  if (props.start === undefined || props.end === undefined) {
    return []
  }

  return [{ start: props.start, end: props.end, kind: 'command' }]
})

const segments = computed<ComposerMirrorSegment[]>(() => {
  return buildMirrorSegments(props.text, requestedRanges.value)
})

function copyMetrics() {
  const element = props.textarea

  if (!element) {
    return
  }

  const style = getComputedStyle(element)

  metrics.value = Object.fromEntries(
    MIRRORED_PROPERTIES.map((property) => {
      return [property, style[property]]
    }),
  )
}

/**
 * The badge pads its sides with a box-shadow, which paints over the textarea's
 * own caret. While the caret rests exactly at a badge's start or end, that
 * side's padding is dropped (`data-caret`), so the caret stays visible.
 */
function readCaretEdge(
  segment: ComposerMirrorSegment,
): 'start' | 'end' | undefined {
  if (selectionStart.value === null) {
    return undefined
  }

  if (selectionStart.value !== selectionEnd.value) {
    return undefined
  }

  if (selectionStart.value === segment.end) {
    return 'end'
  }

  return selectionStart.value === segment.start ? 'start' : undefined
}

/**
 * The badge is opaque, so a caret strictly inside it or a selection over it
 * would be hidden. While either touches the badge's text (`data-reveal`) the
 * badge is dropped and the textarea's own caret, selection and text show.
 */
function isRevealed(segment: ComposerMirrorSegment): boolean {
  const start = selectionStart.value
  const end = selectionEnd.value

  if (start === null || end === null) {
    return false
  }

  if (start === end) {
    return start > segment.start && start < segment.end
  }

  return start < segment.end && end > segment.start
}

function readSelection() {
  const element = props.textarea

  if (!element || document.activeElement !== element) {
    selectionStart.value = null
    selectionEnd.value = null

    return
  }

  selectionStart.value = element.selectionStart
  selectionEnd.value = element.selectionEnd
}

function syncScroll() {
  if (mirrorRef.value && props.textarea) {
    mirrorRef.value.scrollTop = props.textarea.scrollTop
  }
}

useResizeObserver(() => props.textarea, copyMetrics)
useEventListener(() => props.textarea, 'scroll', syncScroll)
useEventListener(document, 'selectionchange', readSelection)
useEventListener(
  () => props.textarea,
  ['input', 'keyup', 'click', 'focus', 'blur'],
  readSelection,
)

watch(() => props.textarea, copyMetrics, { immediate: true })
watch(() => props.text, async () => {
  await nextTick()
  syncScroll()
  readSelection()
}, { flush: 'post' })

onMounted(() => {
  copyMetrics()
  syncScroll()
  readSelection()
})
</script>

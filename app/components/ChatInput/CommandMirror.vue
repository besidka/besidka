<template>
  <div
    ref="mirrorRef"
    class="pointer-events-none absolute inset-0 z-10 overflow-hidden whitespace-pre-wrap break-words text-transparent"
    :style="metrics"
    aria-hidden="true"
    data-testid="command-mirror"
  >{{ before }}<mark
    class="composer-command-token"
    :data-caret="caretEdge ?? undefined"
    data-testid="command-mirror-token"
  >{{ tokenText }}</mark>{{ after }}</div>
</template>

<script setup lang="ts">
import type { StyleValue } from 'vue'

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
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
] as const

const props = defineProps<{
  textarea: HTMLTextAreaElement | null | undefined
  text: string
  start: number
  end: number
}>()

const mirrorRef = useTemplateRef<HTMLDivElement>('mirrorRef')
const metrics = shallowRef<StyleValue>({})
const caretEdge = shallowRef<'start' | 'end' | null>(null)

const before = computed<string>(() => props.text.slice(0, props.start))
const tokenText = computed<string>(() => {
  return props.text.slice(props.start, props.end)
})
const after = computed<string>(() => `${props.text.slice(props.end)} `)

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
 * own caret. While the caret rests exactly at the token's start or end, that
 * side's padding is dropped (`data-caret`), so the caret stays visible.
 */
function readCaret() {
  const element = props.textarea

  if (
    !element
    || document.activeElement !== element
    || element.selectionStart !== element.selectionEnd
  ) {
    caretEdge.value = null

    return
  }

  if (element.selectionStart === props.end) {
    caretEdge.value = 'end'
  } else if (element.selectionStart === props.start) {
    caretEdge.value = 'start'
  } else {
    caretEdge.value = null
  }
}

function syncScroll() {
  if (mirrorRef.value && props.textarea) {
    mirrorRef.value.scrollTop = props.textarea.scrollTop
  }
}

useResizeObserver(() => props.textarea, copyMetrics)
useEventListener(() => props.textarea, 'scroll', syncScroll)
useEventListener(document, 'selectionchange', readCaret)
useEventListener(
  () => props.textarea,
  ['input', 'keyup', 'click', 'focus', 'blur'],
  readCaret,
)

watch(() => props.textarea, copyMetrics, { immediate: true })
watch([() => props.start, () => props.end], readCaret, { flush: 'post' })
watch(() => props.text, async () => {
  await nextTick()
  syncScroll()
}, { flush: 'post' })

onMounted(() => {
  copyMetrics()
  syncScroll()
  readCaret()
})
</script>

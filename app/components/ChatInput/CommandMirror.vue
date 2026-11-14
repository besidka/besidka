<template>
  <div
    ref="mirrorRef"
    class="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words text-transparent"
    :style="metrics"
    aria-hidden="true"
    data-testid="command-mirror"
  >{{ before }}<mark
    class="rounded-sm bg-accent/25 text-transparent"
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

function syncScroll() {
  if (mirrorRef.value && props.textarea) {
    mirrorRef.value.scrollTop = props.textarea.scrollTop
  }
}

useResizeObserver(() => props.textarea, copyMetrics)
useEventListener(() => props.textarea, 'scroll', syncScroll)

watch(() => props.textarea, copyMetrics, { immediate: true })
watch(() => props.text, async () => {
  await nextTick()
  syncScroll()
}, { flush: 'post' })

onMounted(() => {
  copyMetrics()
  syncScroll()
})
</script>

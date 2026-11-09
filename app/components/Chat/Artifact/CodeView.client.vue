<template>
  <pre
    class="shiki shiki-stream my-3 overflow-x-auto rounded-box border border-base-300 bg-base-100/50 p-4 text-sm"
    :data-highlighted="isHighlighted ? 'true' : 'false'"
    data-testid="artifact-code-view"
  ><code><span
    v-for="line in lines"
    :key="line.key"
    v-memo="[line]"
  ><span
    v-for="(span, spanIndex) in line.spans"
    :key="spanIndex"
    :style="span.style"
  >{{ span.content }}</span>{{ line.newline ? '\n' : '' }}</span></code></pre>
</template>

<script setup lang="ts">
const props = defineProps<{
  code: string
  language: string
}>()

const colorMode = useColorMode()

const theme = computed<string>(() => {
  return colorMode.value === 'dark' ? CODE_THEME_DARK : CODE_THEME_LIGHT
})

const { lines, isHighlighted } = useChunkedCodeHighlight({
  code: () => props.code,
  language: () => props.language,
  theme,
})
</script>

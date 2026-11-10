<template>
  <pre
    class="shiki shiki-stream"
    :data-highlighted="isHighlighted ? 'true' : 'false'"
    data-testid="code-stream"
  ><code data-testid="shiki-code"><span
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
  language?: string
  theme: string
}>()

const { lines, isHighlighted } = useCodeStream({
  code: () => props.code,
  language: () => props.language,
  theme: () => props.theme,
})
</script>

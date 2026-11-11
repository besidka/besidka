<template>
  <pre
    class="shiki shiki-stream my-3 overflow-x-auto rounded-box border border-base-300 bg-base-100/50 p-4 text-sm"
    :data-highlighted="isHighlighted ? 'true' : 'false'"
    data-testid="artifact-code-view"
  ><code class="block"><span
    v-for="block in blocks"
    :key="block.key"
    v-memo="[block]"
    class="block w-max min-w-full [content-visibility:auto]"
    :style="{
      containIntrinsicSize:
        `auto ${block.columnCount}ch auto ${block.lineCount}lh`,
    }"
    data-testid="artifact-code-block"
  ><template v-if="block.tokens"><span
    v-for="(token, tokenIndex) in block.tokens"
    :key="tokenIndex"
    :style="token.style"
  >{{ token.content }}</span></template><template
    v-else
  >{{ block.text }}</template></span></code></pre>
</template>

<script setup lang="ts">
const props = defineProps<{
  code: string
  language: string
  cacheKey?: string | null
}>()

const colorMode = useColorMode()

const theme = computed<string>(() => {
  return colorMode.value === 'dark' ? CODE_THEME_DARK : CODE_THEME_LIGHT
})

const { blocks, isHighlighted } = useChunkedCodeHighlight({
  code: () => props.code,
  language: () => props.language,
  theme,
  cacheKey: () => props.cacheKey,
})
</script>

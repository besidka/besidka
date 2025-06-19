<template>
  <div class="mockup-browser w-full my-4 bg-base-100/50 dark:bg-base-100/50 shadow overflow-x-hidden">
    <div class="flex items-center justify-between">
      <div class="mockup-browser-toolbar"/>
      <div class="flex gap-2 py-2 pr-4">
        <UiButton
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
          @click="copy"
        />
      </div>
    </div>
    <ProsePre v-bind="props">
      <ShikiCachedRenderer
        :key="key"
        :highlighter="highlighter"
        :code="trimmedCode"
        :lang="lang"
        :theme="$colorMode.value === 'dark'
          ? 'github-dark'
          : 'github-light'
        "
        class="p-4 overflow-x-auto"
        :class="{
          'overflow-y-auto max-h-20': !expanded
        }"
      />
    </ProsePre>
  </div>
</template>

<script setup lang="ts">
import { ShikiCachedRenderer } from 'shiki-stream/vue'

const colorMode = useColorMode()
const clipboard = useClipboard()
const highlighter = await useHighlighter()
const props = defineProps<{
  code: string
  language: string
  class?: string
  meta?: string
}>()

const trimmedCode = computed<string>(() => {
  try {
    return props.code.trim().replace(/`+$/, '')
  } catch {
    return props.code
  }
})

const lang = computed<string>(() => {
  switch (props.language) {
    case 'vue':
      return 'vue'
    case 'javascript':
      return 'js'
    case 'typescript':
      return 'ts'
    case 'css':
      return 'css'
    default:
      return props.language
  }
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

const expanded = shallowRef(false)
</script>

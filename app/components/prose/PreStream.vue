<template>
  <div
    class="mockup-browser w-full my-4 bg-base-100/50 dark:bg-base-100/50 shadow overflow-x-hidden overscroll-contain"
  >
    <div class="flex items-center justify-between">
      <div class="mockup-browser-toolbar"/>
      <div class="flex gap-2 py-2 pr-4">
        <UiButton
          v-if="isExpandButtonVisible"
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
    <div
      class="p-4 overflow-x-auto text-sm"
      :class="{
        'overflow-y-auto max-h-30': !expanded
      }"
    >
      <ClientOnly>
        <template #fallback>
          <ProsePre v-bind="props" class="motion-safe:animate-pulse">
            {{ trimmedCode }}
          </ProsePre>
        </template>
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
          >
            Render
          </ShikiCachedRenderer>
        </ProsePre>
      </ClientOnly>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ShikiCachedRenderer } from 'shiki-stream/vue'

const props = defineProps<{
  code: string
  language: string
  class?: string
  meta?: string
}>()

const colorMode = useColorMode()
const clipboard = useClipboard()
const highlighter = await useHighlighter()

const trimmedCode = computed<string>(() => {
  try {
    return props.code.trim().replace(/`+$/, '')
  } catch {
    return props.code
  }
})

const codeLines = computed<number>(() => {
  const lines = trimmedCode.value.match(/\r?\n/gm)

  return lines ? lines.length + 1 : 1
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
  timer.value = setInterval(() => {
    if (props.code.length !== savedCodeState.value.length) {
      savedCodeState.value = props.code
      return
    }

    updateExpandedState()
    timer.value && clearTimeout(timer.value)
  }, 1000)
})

onBeforeUnmount(() => {
  timer.value && clearTimeout(timer.value)
})
</script>

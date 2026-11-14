<template>
  <div
    class="flex min-w-0 flex-col gap-2"
    data-testid="skill-file-viewer"
  >
    <div class="flex items-center justify-between gap-2">
      <p class="min-w-0 truncate font-mono text-xs text-base-content/70">
        {{ path }}
      </p>
      <label class="flex min-h-8 shrink-0 cursor-pointer items-center gap-2 text-xs">
        <input
          v-model="isWrapped"
          type="checkbox"
          class="toggle toggle-xs"
          data-testid="skill-file-viewer-wrap"
        >
        Wrap lines
      </label>
    </div>
    <div
      ref="linesRef"
      class="max-h-[28rem] overflow-auto rounded-box bg-base-200 py-2 font-mono text-xs"
      role="region"
      :aria-label="`Contents of ${path}`"
      tabindex="0"
      data-testid="skill-file-viewer-lines"
    >
      <div
        v-for="line in visibleLines"
        :key="line.number"
        :data-line="line.number"
        class="flex flex-wrap gap-x-2 px-2"
        :class="{ 'bg-warning/20': line.findings.length }"
        :data-testid="line.findings.length
          ? 'skill-file-line-flagged'
          : undefined"
      >
        <span
          class="w-10 shrink-0 select-none text-right text-base-content/60"
          aria-hidden="true"
        >
          {{ line.number }}
        </span>
        <code
          class="min-w-0 flex-1 basis-40"
          :class="isWrapped
            ? 'whitespace-pre-wrap break-words'
            : 'whitespace-pre'"
        >{{ line.text }}</code>
        <span
          v-if="line.findings.length"
          class="flex shrink-0 flex-wrap justify-end gap-1 max-sm:basis-full max-sm:justify-start max-sm:pl-12"
        >
          <span class="sr-only">Highlighted on line {{ line.number }}:</span>
          <span
            v-for="marker in line.markers"
            :key="marker"
            class="badge badge-warning badge-xs"
            data-testid="skill-file-marker"
          >
            {{ marker }}
          </span>
        </span>
      </div>
    </div>
    <button
      v-if="hiddenLineCount > 0"
      type="button"
      class="btn btn-sm btn-ghost self-start"
      data-testid="skill-file-viewer-more"
      @click="isExpanded = true"
    >
      Show the other {{ hiddenLineCount }} lines
    </button>
  </div>
</template>

<script setup lang="ts">
import { showHiddenCharacters } from '#shared/utils/skills/hidden-characters'
import type { SkillFinding } from '#shared/utils/skills/findings'

const INITIAL_LINE_LIMIT = 1500

const props = withDefaults(defineProps<{
  path: string
  text: string
  findings?: SkillFinding[]
  focusLine?: number | null
}>(), {
  findings: () => [],
  focusLine: null,
})

const linesRef = useTemplateRef<HTMLElement>('linesRef')

const isWrapped = shallowRef<boolean>(true)
const isExpanded = shallowRef<boolean>(false)

const lines = computed<string[]>(() => {
  return props.text.split('\n')
})

const findingsByLine = computed(() => {
  return groupFindingsByLine(props.findings, props.path)
})

const renderedLines = computed(() => {
  return lines.value.map((text, index) => {
    const number = index + 1
    const lineFindings = findingsByLine.value.get(number) ?? []

    return {
      number,
      text: showHiddenCharacters(text),
      findings: lineFindings,
      markers: [...new Set(lineFindings.map((finding) => {
        return getFindingMarker(finding.type)
      }))],
    }
  })
})

const visibleLines = computed(() => {
  return isExpanded.value
    ? renderedLines.value
    : renderedLines.value.slice(0, INITIAL_LINE_LIMIT)
})

const hiddenLineCount = computed<number>(() => {
  return renderedLines.value.length - visibleLines.value.length
})

watch(() => props.text, () => {
  isExpanded.value = false
})

watch(() => props.focusLine, async (line) => {
  if (!line) {
    return
  }

  if (line > INITIAL_LINE_LIMIT) {
    isExpanded.value = true
  }

  await nextTick()
  linesRef.value
    ?.querySelector(`[data-line="${line}"]`)
    ?.scrollIntoView({ block: 'center' })
}, { flush: 'post' })
</script>

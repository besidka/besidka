<template>
  <div
    class="flex min-w-0 flex-col gap-3"
    data-testid="skill-diff"
  >
    <p
      class="text-sm"
      data-testid="skill-diff-summary"
    >
      <template v-if="files.length">
        {{ files.length }}
        {{ files.length === 1 ? 'file changes' : 'files change' }}:
        {{ added }} {{ added === 1 ? 'line' : 'lines' }} added,
        {{ removed }} {{ removed === 1 ? 'line' : 'lines' }} removed.
      </template>
      <template v-else>
        No file changes.
      </template>
    </p>
    <p
      v-if="truncated || skipped.length"
      class="text-xs text-base-content/70"
      data-testid="skill-diff-truncated"
    >
      Some changes are not shown because the diff is capped
      at {{ SKILL_DIFF_MAX_LINES }} lines and {{ SKILL_DIFF_MAX_FILES }} files.
      <template v-if="skipped.length">
        Not compared: {{ skipped.map(file => file.path).join(', ') }}.
      </template>
    </p>
    <section
      v-for="file in files"
      :key="file.path"
      class="min-w-0 rounded-box border border-base-300"
      :aria-label="`Changes in ${file.path}`"
      data-testid="skill-diff-file"
    >
      <header class="flex flex-wrap items-center gap-2 border-b border-base-300 px-2 py-1 text-xs">
        <span class="min-w-0 truncate font-mono font-medium">
          {{ file.path }}
        </span>
        <span class="badge badge-soft badge-sm">
          {{ STATUS_LABELS[file.status] }}
        </span>
        <span class="ml-auto font-mono">
          +{{ file.added }} -{{ file.removed }}
        </span>
      </header>
      <div
        class="max-h-80 overflow-auto py-1 font-mono text-xs"
        tabindex="0"
        role="region"
        :aria-label="`Diff of ${file.path}`"
      >
        <p
          v-if="file.truncated && !file.lines.length"
          class="px-2 py-1 text-base-content/70"
        >
          Too large to compare line by line.
        </p>
        <template
          v-for="(line, index) in file.lines"
          :key="index"
        >
          <p
            v-if="line.kind === 'gap'"
            class="px-2 py-0.5 text-base-content/60"
          >
            ... {{ line.text }}
          </p>
          <p
            v-else
            class="flex gap-2 whitespace-pre-wrap break-words px-2"
            :class="{
              'bg-success/15': line.kind === 'add',
              'bg-error/15': line.kind === 'remove',
            }"
            :data-testid="`skill-diff-line-${line.kind}`"
          >
            <span
              class="w-4 shrink-0 select-none font-bold"
              aria-hidden="true"
            >{{ MARKERS[line.kind] }}</span>
            <span class="sr-only">{{ LINE_LABELS[line.kind] }}:</span>
            <span class="min-w-0 grow">{{ showHiddenCharacters(line.text) }}</span>
          </p>
        </template>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import {
  SKILL_DIFF_MAX_FILES,
  SKILL_DIFF_MAX_LINES,
} from '#shared/utils/skills-policy'
import { showHiddenCharacters } from '#shared/utils/skills/hidden-characters'
import type {
  SkillDiffLineKind,
  SkillFileDiff,
  SkillFileDiffStatus,
} from '#shared/utils/skills/diff'

const STATUS_LABELS: Record<SkillFileDiffStatus, string> = {
  added: 'Added',
  removed: 'Removed',
  modified: 'Changed',
}
const MARKERS: Record<SkillDiffLineKind, string> = {
  add: '+',
  remove: '-',
  context: ' ',
  gap: '',
}
const LINE_LABELS: Record<SkillDiffLineKind, string> = {
  add: 'Added',
  remove: 'Removed',
  context: 'Unchanged',
  gap: '',
}

withDefaults(defineProps<{
  files: SkillFileDiff[]
  added: number
  removed: number
  truncated?: boolean
  skipped?: Array<{ path: string, status: SkillFileDiffStatus }>
}>(), {
  truncated: false,
  skipped: () => [],
})
</script>

<template>
  <template
    v-for="(run, runIndex) in runs"
    :key="`run-${runIndex}`"
  >
    <a
      v-if="run.link && isAllowedHyperlink(run.link.href)"
      :href="run.link.href"
      target="_blank"
      rel="noopener noreferrer nofollow"
      class="link"
      :class="getRunClasses(run)"
    >{{ run.text }}</a>
    <code
      v-else-if="run.code"
      class="rounded-sm bg-base-300 px-1 font-mono text-[0.9em]"
      :class="getRunClasses(run)"
    >{{ run.text }}</code>
    <span
      v-else
      :class="getRunClasses(run)"
    >{{ run.text }}</span>
  </template>
</template>

<script setup lang="ts">
import { isAllowedHyperlink } from '@besidka/doc-renderer/spec'
import type { Run } from '@besidka/doc-renderer/spec'

defineProps<{
  runs: Run[]
}>()

function getRunClasses(run: Run): string[] {
  return [
    run.bold ? 'font-bold' : '',
    run.italic ? 'italic' : '',
    run.underline ? 'underline' : '',
  ].filter(Boolean)
}
</script>

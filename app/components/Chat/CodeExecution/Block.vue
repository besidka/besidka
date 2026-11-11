<template>
  <div
    class="min-w-0"
    :data-testid="testId"
    :data-tone="tone"
  >
    <pre
      tabindex="0"
      :aria-label="label"
      class="m-0 max-h-72 overflow-auto rounded-field border border-base-300 bg-base-100 p-2 font-mono text-xs leading-relaxed whitespace-pre"
      :class="tone === 'error' ? 'text-error' : 'text-base-content'"
    ><code>{{ text || emptyText }}</code></pre>
    <p
      v-if="isTruncated"
      class="mt-1 flex items-start gap-1 text-xs text-warning"
      :data-testid="`${testId}-truncated`"
    >
      <Icon
        name="lucide:scissors"
        size="14"
        class="mt-px shrink-0"
        aria-hidden="true"
      />
      {{ truncatedNotice }}
    </p>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  label: string
  text: string
  testId: string
  emptyText?: string
  isTruncated?: boolean
  truncatedNotice?: string
  tone?: 'default' | 'error'
}>(), {
  emptyText: 'No output.',
  isTruncated: false,
  truncatedNotice: '',
  tone: 'default',
})
</script>

<template>
  <div
    class="flex flex-col gap-4 p-4 text-sm"
    data-testid="tool-approval-details"
  >
    <section class="flex flex-col gap-1">
      <h3 class="font-medium">
        {{ title }}
      </h3>
      <p
        v-if="summaryLine"
        class="break-words text-base-content/80"
      >
        {{ summaryLine }}
      </p>
      <p class="break-words text-base-content/70">
        {{ reasonText }}
      </p>
    </section>
    <section
      v-if="preview"
      class="flex flex-col gap-1"
    >
      <h4 class="text-xs font-medium text-base-content/70">
        Text to save
      </h4>
      <p
        class="overflow-auto whitespace-pre-wrap break-words rounded-box bg-base-200 p-3 text-xs"
        data-testid="tool-approval-details-preview"
      >{{ preview }}</p>
    </section>
    <section class="flex flex-col gap-1">
      <h4 class="text-xs font-medium text-base-content/70">
        Tool
      </h4>
      <p
        class="break-all font-mono text-xs"
        data-testid="tool-approval-details-tool"
      >
        {{ toolName }}
      </p>
    </section>
    <section class="flex flex-col gap-1">
      <h4 class="text-xs font-medium text-base-content/70">
        Arguments
        <span
          v-if="isShortened"
          class="font-normal"
        >· Shown shortened</span>
      </h4>
      <pre
        v-if="argumentsText"
        class="overflow-auto whitespace-pre-wrap break-words rounded-box bg-base-200 p-3 text-xs"
        data-testid="tool-approval-details-arguments"
      >{{ argumentsText }}</pre>
      <p
        v-else
        class="text-xs text-base-content/60"
      >
        No arguments
      </p>
    </section>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  title: string
  toolName: string
  summaryLine: string
  reasonText: string
  input: unknown
  isShortened: boolean
  preview?: string
}>()

const argumentsText = computed<string>(() => {
  const { input } = props

  if (input === undefined || input === null) {
    return ''
  }

  if (typeof input === 'string') {
    return input
  }

  try {
    const text = JSON.stringify(input, null, 2)

    return text === '{}' ? '' : text
  } catch {
    return ''
  }
})
</script>

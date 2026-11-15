<template>
  <article
    class="grid grid-cols-[minmax(0,1fr)] gap-4 py-4 text-sm"
    data-testid="code-execution-detail"
  >
    <header class="flex flex-wrap items-center gap-2">
      <span class="badge badge-soft badge-sm">
        {{ languageLabel }}
      </span>
      <span
        v-if="returnCodeLabel"
        class="badge badge-soft badge-sm gap-1"
        :class="view.returnCode === 0 ? 'badge-success' : 'badge-error'"
        :aria-label="`Exit code ${view.returnCode}`"
        data-testid="code-execution-detail-return-code"
      >
        <Icon
          :name="view.returnCode === 0
            ? 'lucide:circle-check'
            : 'lucide:circle-x'"
          size="12"
          aria-hidden="true"
        />
        {{ returnCodeLabel }}
      </span>
    </header>
    <section class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
      <h3 class="text-xs font-semibold text-base-content/60">
        Code
      </h3>
      <ChatCodeExecutionBlock
        label="Code"
        :text="view.code"
        empty-text="No code."
        :is-truncated="view.codeTruncated"
        :truncated-notice="CODE_EXECUTION_CODE_TRUNCATED_NOTICE"
        test-id="code-execution-detail-code"
      />
    </section>
    <section class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
      <h3 class="text-xs font-semibold text-base-content/60">
        Output
      </h3>
      <ChatCodeExecutionBlock
        label="Output"
        :text="view.stdout"
        :is-truncated="view.stdoutTruncated"
        :truncated-notice="CODE_EXECUTION_STREAM_TRUNCATED_NOTICE"
        test-id="code-execution-detail-output"
      />
    </section>
    <section
      v-if="errorsText"
      class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1"
    >
      <h3 class="text-xs font-semibold text-base-content/60">
        Errors
      </h3>
      <ChatCodeExecutionBlock
        label="Errors"
        :text="errorsText"
        tone="error"
        :is-truncated="view.stderrTruncated"
        :truncated-notice="CODE_EXECUTION_STREAM_TRUNCATED_NOTICE"
        test-id="code-execution-detail-errors"
      />
    </section>
  </article>
</template>

<script setup lang="ts">
import type { CodeExecutionView } from '#shared/utils/code-execution'

const props = defineProps<{
  view: CodeExecutionView
}>()

const languageLabel = computed<string>(() => {
  return getCodeExecutionLanguageLabel(props.view.language)
})

const returnCodeLabel = computed<string>(() => {
  return props.view.returnCode === null
    ? ''
    : `Exit ${props.view.returnCode}`
})

const errorsText = computed<string>(() => {
  return [props.view.stderr, props.view.errorText]
    .filter(Boolean)
    .join('\n')
})
</script>

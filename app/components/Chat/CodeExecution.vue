<template>
  <section
    v-if="view"
    class="mt-2 w-full max-w-2xl rounded-box border border-base-300 bg-base-200 text-sm"
    :data-state="view.state"
    aria-label="Code execution"
    data-testid="code-execution-card"
  >
    <div class="flex items-center gap-2 p-2">
      <span class="grid size-8 shrink-0 place-items-center rounded-field bg-base-100 text-base-content/70">
        <Icon
          :name="CODE_EXECUTION_TOOL_ICON"
          size="18"
        />
      </span>
      <div class="flex min-w-0 grow flex-wrap items-center gap-x-2 gap-y-1">
        <span class="font-medium">Code execution</span>
        <span
          class="badge badge-soft badge-sm"
          data-testid="code-execution-language"
        >
          {{ languageLabel }}
        </span>
        <span
          v-if="returnCodeLabel"
          class="badge badge-soft badge-sm gap-1"
          :class="view.returnCode === 0 ? 'badge-success' : 'badge-error'"
          :aria-label="`Exit code ${view.returnCode}`"
          data-testid="code-execution-return-code"
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
        <span
          role="status"
          aria-live="polite"
          class="inline-flex items-center gap-1 text-xs text-base-content/70"
          data-testid="code-execution-status"
        >
          <Icon
            :name="statusIcon"
            size="14"
            aria-hidden="true"
            :class="{ 'motion-safe:animate-spin': view.state === 'running' }"
          />
          {{ statusText }}
        </span>
      </div>
      <button
        type="button"
        class="btn btn-sm btn-circle btn-ghost btn-ghost-legacy shrink-0"
        :aria-expanded="isExpanded"
        :aria-controls="detailsId"
        :aria-label="isExpanded
          ? 'Hide code execution details'
          : 'Show code execution details'"
        :title="isExpanded ? 'Hide details' : 'Show details'"
        data-testid="code-execution-toggle"
        @click="isExpanded = !isExpanded"
      >
        <Icon
          name="lucide:chevron-down"
          size="18"
          class="transition-transform duration-150 motion-reduce:transition-none"
          :class="{ 'rotate-180': isExpanded }"
        />
      </button>
      <button
        type="button"
        class="btn btn-sm btn-soft shrink-0"
        :disabled="view.state === 'running'"
        :aria-current="isPanelOpen ? 'true' : undefined"
        aria-label="Open code and output in the side panel"
        data-testid="code-execution-open"
        @click="onOpen"
      >
        Open
      </button>
    </div>
    <div
      v-if="!isExpanded && preview.text"
      class="px-2 pb-2"
    >
      <pre
        tabindex="0"
        aria-label="Code preview"
        class="m-0 overflow-x-auto rounded-field border border-base-300 bg-base-100 p-2 font-mono text-xs leading-relaxed whitespace-pre"
        data-testid="code-execution-preview"
      ><code>{{ preview.text }}</code></pre>
      <button
        v-if="preview.hiddenLineCount > 0"
        type="button"
        class="mt-1 cursor-pointer rounded-sm text-xs font-medium text-accent hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        data-testid="code-execution-show-more"
        @click="isExpanded = true"
      >
        Show {{ preview.hiddenLineCount }} more
        {{ preview.hiddenLineCount === 1 ? 'line' : 'lines' }}
      </button>
    </div>
    <p
      v-if="!isExpanded && view.errorText"
      class="flex items-start gap-1.5 px-2 pb-2 text-xs text-error"
      data-testid="code-execution-error-summary"
    >
      <Icon
        name="lucide:circle-alert"
        size="14"
        class="mt-px shrink-0"
        aria-hidden="true"
      />
      <span class="line-clamp-2 break-words">{{ view.errorText }}</span>
    </p>
    <div
      v-if="isExpanded"
      :id="detailsId"
      class="grid grid-cols-[minmax(0,1fr)] gap-3 px-2 pb-2"
      data-testid="code-execution-details"
    >
      <div
        v-if="view.code"
        class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1"
      >
        <h4 class="text-xs font-semibold text-base-content/60">
          Code
        </h4>
        <ChatCodeExecutionBlock
          label="Code"
          :text="view.code"
          :is-truncated="view.codeTruncated"
          :truncated-notice="CODE_EXECUTION_CODE_TRUNCATED_NOTICE"
          test-id="code-execution-code"
        />
      </div>
      <div
        v-if="view.state !== 'running'"
        class="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1"
      >
        <div
          v-if="hasErrors"
          role="tablist"
          aria-label="Run result"
          class="tabs tabs-border"
          @keydown="onTabKeydown"
        >
          <button
            v-for="tab in tabs"
            :id="`${tabsId}-tab-${tab.id}`"
            :key="tab.id"
            type="button"
            role="tab"
            class="tab"
            :class="[
              `js-code-execution-tab-${tab.id}`,
              { 'tab-active': activeTab === tab.id },
            ]"
            :aria-selected="activeTab === tab.id"
            :aria-controls="`${tabsId}-panel-${tab.id}`"
            :tabindex="activeTab === tab.id ? 0 : -1"
            :data-testid="`code-execution-tab-${tab.id}`"
            @click="selectedTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </div>
        <h4
          v-else
          class="text-xs font-semibold text-base-content/60"
        >
          Output
        </h4>
        <div
          :id="`${tabsId}-panel-${activeTab}`"
          :role="hasErrors ? 'tabpanel' : undefined"
          :aria-labelledby="hasErrors
            ? `${tabsId}-tab-${activeTab}`
            : undefined"
        >
          <ChatCodeExecutionBlock
            v-if="activeTab === 'output'"
            label="Output"
            :text="view.stdout"
            :is-truncated="view.stdoutTruncated"
            :truncated-notice="CODE_EXECUTION_STREAM_TRUNCATED_NOTICE"
            test-id="code-execution-output"
          />
          <ChatCodeExecutionBlock
            v-else
            label="Errors"
            tone="error"
            :text="errorsText"
            :is-truncated="view.stderrTruncated"
            :truncated-notice="CODE_EXECUTION_STREAM_TRUNCATED_NOTICE"
            test-id="code-execution-errors"
          />
        </div>
      </div>
    </div>
    <div
      v-if="skippedFiles.length"
      class="mx-2 mb-2 rounded-field border border-warning/40 bg-warning/10 p-2 text-xs"
      data-testid="code-execution-skipped"
    >
      <p class="flex items-center gap-1.5 font-medium">
        <Icon
          name="lucide:file-warning"
          size="14"
          class="shrink-0"
          aria-hidden="true"
        />
        {{ skippedHeading }}
      </p>
      <ul class="mt-1 grid gap-0.5">
        <li
          v-for="(skipped, index) in skippedFiles"
          :key="`${skipped.filename}-${index}`"
          data-testid="code-execution-skipped-item"
        >
          <span class="font-medium break-all">{{ skipped.filename }}</span>
          <span class="block text-base-content/70">
            {{ getCodeExecutionSkipReasonText(skipped.reason) }}
          </span>
        </li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import { LazyChatCodeExecutionDetail } from '#components'
import {
  getCodeExecutionSkipReasonText,
  readCodeExecutionView,
} from '#shared/utils/code-execution'
import type {
  CodeExecutionSkippedFile,
  CodeExecutionView,
} from '#shared/utils/code-execution'

type ResultTab = 'output' | 'errors'

const props = withDefaults(defineProps<{
  part: unknown
  skippedFiles?: CodeExecutionSkippedFile[]
  fallbackKey?: string
}>(), {
  skippedFiles: () => [],
  fallbackKey: '',
})

const detailsId = useId()
const tabsId = useId()
const sidePanel = useSidePanel()
const isExpanded = shallowRef<boolean>(false)
const selectedTab = shallowRef<ResultTab | null>(null)

const view = computed<CodeExecutionView | null>(() => {
  return readCodeExecutionView(props.part as Record<string, unknown>)
})

const languageLabel = computed<string>(() => {
  return view.value
    ? getCodeExecutionLanguageLabel(view.value.language)
    : ''
})

const returnCodeLabel = computed<string>(() => {
  return view.value?.returnCode === null || !view.value
    ? ''
    : `Exit ${view.value.returnCode}`
})

const preview = computed(() => {
  return getCodePreview(view.value?.code ?? '')
})

const errorsText = computed<string>(() => {
  return [view.value?.stderr, view.value?.errorText]
    .filter(Boolean)
    .join('\n')
})

const hasErrors = computed<boolean>(() => {
  return errorsText.value.length > 0
})

const tabs: { id: ResultTab, label: string }[] = [
  { id: 'output', label: 'Output' },
  { id: 'errors', label: 'Errors' },
]

const activeTab = computed<ResultTab>(() => {
  if (!hasErrors.value) {
    return 'output'
  }

  if (selectedTab.value) {
    return selectedTab.value
  }

  return view.value?.stdout ? 'output' : 'errors'
})

const statusText = computed<string>(() => {
  if (view.value?.state === 'running') {
    return 'Running code…'
  }

  if (view.value?.state === 'error') {
    return 'The provider did not run this code'
  }

  return 'Finished'
})

const statusIcon = computed<string>(() => {
  if (view.value?.state === 'running') {
    return 'lucide:loader-circle'
  }

  return view.value?.state === 'error'
    ? 'lucide:circle-alert'
    : 'lucide:check'
})

const skippedHeading = computed<string>(() => {
  return props.skippedFiles.length === 1
    ? 'One file was not saved'
    : `${props.skippedFiles.length} files were not saved`
})

const panelViewKey = computed<string>(() => {
  const toolCallId = (props.part as { toolCallId?: unknown })?.toolCallId

  return `code-execution:${
    typeof toolCallId === 'string' && toolCallId
      ? toolCallId
      : props.fallbackKey
  }`
})

const isPanelOpen = computed<boolean>(() => {
  return sidePanel.isOpen.value
    && sidePanel.viewKey.value === panelViewKey.value
})

function onOpen() {
  if (!view.value || view.value.state === 'running') {
    return
  }

  sidePanel.open({
    viewKey: panelViewKey.value,
    title: 'Code execution',
    mode: 'detail',
    component: LazyChatCodeExecutionDetail,
    props: { view: view.value },
  })
}

async function onTabKeydown(event: KeyboardEvent) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']

  if (!keys.includes(event.key)) {
    return
  }

  event.preventDefault()

  const nextTab: ResultTab = event.key === 'ArrowLeft' || event.key === 'Home'
    ? 'output'
    : 'errors'

  selectedTab.value = nextTab

  const tabList = event.currentTarget as HTMLElement

  await nextTick()

  tabList
    .querySelector<HTMLElement>(`.js-code-execution-tab-${nextTab}`)
    ?.focus()
}
</script>

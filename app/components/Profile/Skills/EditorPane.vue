<template>
  <div
    class="flex min-h-[26rem] min-w-0 flex-1 flex-col gap-2"
    data-testid="skill-editor-pane"
  >
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3
        class="min-w-0 truncate font-mono text-xs text-base-content/70"
        data-testid="skill-editor-pane-path"
      >
        {{ file?.path }}
      </h3>
      <div
        v-if="file && !readOnlyReason"
        role="tablist"
        aria-label="File view"
        class="tabs tabs-box tabs-sm"
        @keydown.right.prevent="selectTab('model')"
        @keydown.left.prevent="selectTab('write')"
      >
        <button
          :id="writeTabId"
          type="button"
          role="tab"
          class="tab min-h-11 sm:min-h-8"
          :class="{ 'tab-active': activeTab === 'write' }"
          :aria-selected="activeTab === 'write'"
          :aria-controls="writePanelId"
          :tabindex="activeTab === 'write' ? 0 : -1"
          data-testid="skill-editor-tab-write"
          @click="selectTab('write')"
        >
          Write
        </button>
        <button
          :id="modelTabId"
          type="button"
          role="tab"
          class="tab min-h-11 sm:min-h-8"
          :class="{ 'tab-active': activeTab === 'model' }"
          :aria-selected="activeTab === 'model'"
          :aria-controls="modelPanelId"
          :tabindex="activeTab === 'model' ? 0 : -1"
          data-testid="skill-editor-tab-model"
          @click="selectTab('model')"
        >
          Model view
        </button>
      </div>
    </div>

    <div
      v-if="readOnlyReason"
      class="alert alert-info alert-soft"
      role="status"
      data-testid="skill-editor-read-only"
    >
      <Icon
        name="lucide:lock"
        size="16"
        class="shrink-0"
        aria-hidden="true"
      />
      <span>{{ readOnlyReason }}</span>
    </div>

    <div
      v-if="file?.loadState === 'loading'"
      class="skeleton skeleton--default h-64 w-full"
      role="status"
      aria-label="Loading file"
      data-testid="skill-editor-loading"
    />
    <div
      v-else-if="file?.loadState === 'error'"
      class="alert alert-error alert-soft"
      role="alert"
      data-testid="skill-editor-file-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="16"
        class="shrink-0"
        aria-hidden="true"
      />
      <span>{{ file.loadError }}</span>
      <button
        type="button"
        class="btn btn-sm"
        @click="emit('retry')"
      >
        Retry
      </button>
    </div>
    <template v-else-if="file">
      <ProfileSkillsFileViewer
        v-if="readOnlyReason"
        :path="file.path"
        :text="value"
        :findings="findings"
      />
      <template v-else>
        <div
          v-show="activeTab === 'write'"
          :id="writePanelId"
          class="flex min-h-0 flex-1 flex-col gap-1"
          role="tabpanel"
          :aria-labelledby="writeTabId"
        >
          <label
            :for="textareaId"
            class="sr-only"
          >
            {{ isSkillMd ? 'Instructions' : `Contents of ${file.path}` }}
          </label>
          <textarea
            :id="textareaId"
            ref="textarea"
            v-model="value"
            class="textarea textarea-bordered min-h-64 w-full flex-1 resize-none font-mono text-xs"
            spellcheck="false"
            autocapitalize="none"
            autocorrect="off"
            aria-describedby="skill-editor-counter"
            data-testid="skill-editor-textarea"
            @keydown="onKeydown"
            @beforeinput="onBeforeInput"
            @paste="onPaste"
          />
          <p
            id="skill-editor-counter"
            class="text-xs text-base-content/70"
            data-testid="skill-editor-counter"
          >
            {{ characterCount.toLocaleString() }} characters,
            {{ lineCount.toLocaleString() }} lines
          </p>
        </div>
        <div
          v-if="activeTab === 'model'"
          :id="modelPanelId"
          class="min-w-0"
          role="tabpanel"
          :aria-labelledby="modelTabId"
          tabindex="0"
        >
          <ProfileSkillsModelView
            :path="file.path"
            :text="value"
            :is-skill-md="isSkillMd"
            :catalog-line="catalogLine"
            :catalog-tokens="catalogTokens"
            :body-tokens="bodyTokens"
            :findings="findings"
            :finding-counts="findingCounts"
          />
        </div>
      </template>

      <p
        v-if="findings.length && activeTab === 'write' && !readOnlyReason"
        class="text-xs text-base-content/70"
        data-testid="skill-editor-findings-note"
      >
        Highlighted: {{ describeFindingCounts(findingCounts) }}. They show
        in Model view.
      </p>
    </template>

    <ProfileSkillsProblemList
      :problems="problems"
      @fix="problem => emit('fix', problem)"
    />
  </div>
</template>

<script setup lang="ts">
import type { SkillFinding } from '#shared/utils/skills/findings'

const props = withDefaults(defineProps<{
  file: SkillEditorFile | null
  isSkillMd?: boolean
  readOnlyReason?: string
  problems?: SkillEditorProblem[]
  findings?: SkillFinding[]
  findingCounts?: Record<string, number>
  catalogLine?: string
  catalogTokens?: number
  bodyTokens?: number
}>(), {
  isSkillMd: false,
  readOnlyReason: '',
  problems: () => [],
  findings: () => [],
  findingCounts: () => ({}),
  catalogLine: '',
  catalogTokens: 0,
  bodyTokens: 0,
})

const emit = defineEmits<{
  fix: [problem: SkillEditorProblem]
  retry: []
}>()

const value = defineModel<string>({ required: true })

const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')
const writeTabId = useId()
const modelTabId = useId()
const writePanelId = useId()
const modelPanelId = useId()
const textareaId = useId()
const activeTab = shallowRef<'write' | 'model'>('write')

const isMarkdown = computed<boolean>(() => {
  return !!props.file && isSkillEditorMarkdownPath(props.file.path)
})

const markdownTextarea = useMarkdownTextarea(textarea, {
  continueListsOnEnter: () => isMarkdown.value,
})

const characterCount = computed<number>(() => {
  return value.value.length
})

const lineCount = computed<number>(() => {
  return countTextLines(value.value)
})

function selectTab(tab: 'write' | 'model') {
  activeTab.value = tab
}

function onKeydown(event: KeyboardEvent) {
  if (isMarkdown.value) {
    markdownTextarea.onKeydown(event)
  }
}

function onBeforeInput(event: InputEvent) {
  if (isMarkdown.value) {
    markdownTextarea.onBeforeInput(event)
  }
}

function onPaste(event: ClipboardEvent) {
  if (isMarkdown.value) {
    markdownTextarea.onPaste(event)
  }
}

watch(() => props.file?.key, () => {
  activeTab.value = 'write'
})
</script>

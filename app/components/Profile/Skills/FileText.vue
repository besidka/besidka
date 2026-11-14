<template>
  <div
    v-if="status === 'pending' && !data"
    class="skeleton skeleton--default h-48 w-full"
    role="status"
    aria-label="Loading file"
    data-testid="skill-file-loading"
  />
  <div
    v-else-if="error"
    class="alert alert-error alert-soft"
    role="alert"
    data-testid="skill-file-error"
  >
    <Icon
      name="lucide:circle-alert"
      size="16"
      class="shrink-0"
      aria-hidden="true"
    />
    <span>{{ errorMessage }}</span>
    <button
      type="button"
      class="btn btn-sm"
      @click="refresh()"
    >
      Retry
    </button>
  </div>
  <div
    v-else-if="text !== null"
    class="flex flex-col gap-2"
  >
    <ProfileSkillsFileViewer
      :path="path"
      :text="text"
      :findings="findings"
    />
    <p
      v-if="findings.length"
      class="text-xs text-base-content/70"
      data-testid="skill-file-findings-note"
    >
      Highlighted: {{ describeFindingCounts(findingCounts) }}.
      Besidka highlights links and commands so you can review them. It cannot
      tell whether a skill is safe.
    </p>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import { scanSkillTextWithCounts } from '#shared/utils/skills/findings'

const props = defineProps<{
  skillId: string
  path: string
  version?: number
}>()

const { data, status, error, refresh } = useLazyFetch(
  () => `/api/v1/skills/${props.skillId}/files`,
  {
    key: computed(() => {
      return `${SKILLS_LIBRARY_KEY}-file-${props.skillId}-${
        props.version ?? 'current'
      }-${props.path}`
    }),
    query: computed(() => {
      return {
        path: props.path,
        ...(props.version === undefined ? {} : { version: props.version }),
      }
    }),
  },
)

const text = computed<string | null>(() => {
  return data.value && 'text' in data.value ? data.value.text : null
})

const scan = computed(() => {
  return text.value === null
    ? { findings: [], counts: {} }
    : scanSkillTextWithCounts(props.path, text.value)
})

const findings = computed(() => scan.value.findings)
const findingCounts = computed(() => scan.value.counts)

const errorMessage = computed<string>(() => {
  return error.value
    ? parseError(error.value).message || 'The file could not be loaded.'
    : ''
})
</script>

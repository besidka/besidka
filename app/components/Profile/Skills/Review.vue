<template>
  <div
    class="grid min-w-0 gap-4"
    data-testid="skill-review"
  >
    <div class="grid gap-1">
      <h3
        class="text-lg font-semibold"
        data-testid="skill-review-name"
      >
        {{ preview.skill.name }}
      </h3>
      <p
        class="text-sm"
        data-testid="skill-review-description"
      >
        {{ preview.skill.description }}
      </p>
    </div>

    <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt class="text-base-content/70">
        Source
      </dt>
      <dd
        class="min-w-0 break-words"
        data-testid="skill-review-source"
      >
        {{ sourceLabel }}
      </dd>
      <dt class="text-base-content/70">
        Licence
      </dt>
      <dd
        class="flex min-w-0 flex-wrap items-center gap-2"
        data-testid="skill-review-licence"
      >
        <span
          class="badge badge-soft badge-sm"
          :class="licenceBadgeClass"
          data-testid="skill-review-licence-class"
        >
          {{ licenceLabel }}
        </span>
        <span class="min-w-0 break-words">{{ preview.licence.text }}</span>
      </dd>
      <template v-if="preview.skill.license">
        <dt class="text-base-content/70">
          License field
        </dt>
        <dd
          class="min-w-0 break-words font-mono text-xs"
          data-testid="skill-review-license-field"
        >
          {{ preview.skill.license }}
        </dd>
      </template>
      <template v-if="preview.skill.compatibility">
        <dt class="text-base-content/70">
          Compatibility
        </dt>
        <dd
          class="min-w-0 break-words"
          data-testid="skill-review-compatibility"
        >
          {{ preview.skill.compatibility }}
        </dd>
      </template>
      <template v-if="preview.skill.allowedTools?.length">
        <dt class="text-base-content/70">
          Requested tools
        </dt>
        <dd
          class="min-w-0 break-words"
          data-testid="skill-review-allowed-tools"
        >
          {{ preview.skill.allowedTools.join(', ') }}
          <span class="text-xs text-base-content/70">
            (requested by the author, not granted)
          </span>
        </dd>
      </template>
      <dt class="text-base-content/70">
        Files
      </dt>
      <dd>
        {{ preview.files.length }}
        {{ preview.files.length === 1 ? 'file' : 'files' }},
        {{ formatFileSize(totalBytes) }}
      </dd>
    </dl>

    <details
      v-if="licenceExcerpt"
      class="rounded-box border border-base-300"
      data-testid="skill-review-licence-text"
    >
      <summary class="cursor-pointer px-3 py-2 text-sm font-medium">
        Start of the licence file{{ licenceFileSuffix }}
      </summary>
      <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-base-300 px-3 py-2 font-mono text-xs">{{ licenceExcerpt }}</pre>
    </details>

    <div
      class="alert alert-warning alert-soft items-start"
      role="note"
      data-testid="skill-review-warning"
    >
      <Icon
        name="lucide:triangle-alert"
        size="18"
        class="mt-0.5 shrink-0"
        aria-hidden="true"
      />
      <div class="grid gap-1 text-sm">
        <p class="font-medium">
          Installing a skill is like installing software. Only continue if
          you trust its author.
        </p>
        <p data-testid="skill-review-finding-counts">
          <template v-if="findingSummary">
            Highlighted in the files: {{ findingSummary }}.
          </template>
          <template v-else>
            Nothing was highlighted.
          </template>
          Besidka highlights links and commands so you can review them. It
          cannot tell whether a skill is safe.
        </p>
      </div>
    </div>

    <ul
      v-if="preview.warnings.length"
      class="grid gap-1 text-sm"
      data-testid="skill-review-warnings"
    >
      <li
        v-for="warning in preview.warnings"
        :key="warning"
        class="flex gap-2"
      >
        <Icon
          name="lucide:info"
          size="14"
          class="mt-1 shrink-0"
          aria-hidden="true"
        />
        {{ warning }}
      </li>
    </ul>

    <div class="grid min-w-0 gap-3 md:grid-cols-[14rem_minmax(0,1fr)]">
      <ProfileSkillsFileTree
        v-model="selectedPath"
        :files="preview.files"
        :flagged="flaggedByPath"
      />
      <div class="min-w-0">
        <ProfileSkillsFileViewer
          v-if="selectedText !== null"
          :path="selectedPath"
          :text="selectedText"
          :findings="preview.findings"
          :focus-line="focusLine"
        />
        <p
          v-else
          class="rounded-box bg-base-200 p-3 text-sm"
          data-testid="skill-review-not-previewed"
        >
          This file is not shown before you install. A new skill is installed
          switched off, and you can read every file in the Files tab before
          you turn it on.
        </p>
      </div>
    </div>

    <details
      v-if="preview.findings.length"
      class="rounded-box border border-base-300"
      data-testid="skill-review-findings"
    >
      <summary class="cursor-pointer px-3 py-2 text-sm font-medium">
        Highlights ({{ preview.findings.length }})
      </summary>
      <ul class="grid max-h-64 gap-1 overflow-auto border-t border-base-300 p-2 text-xs">
        <li
          v-for="(finding, index) in preview.findings"
          :key="index"
        >
          <button
            type="button"
            class="flex w-full min-w-0 items-start gap-2 rounded-field px-1 py-1 text-left hover:bg-base-200"
            data-testid="skill-review-finding"
            @click="onSelectFinding(finding.path, finding.line)"
          >
            <span class="badge badge-warning badge-xs shrink-0">
              {{ getFindingMarker(finding.type) }}
            </span>
            <span class="shrink-0 font-mono">
              {{ finding.path }}:{{ finding.line }}
            </span>
            <code class="min-w-0 break-all">{{ finding.snippet || finding.detail }}</code>
          </button>
        </li>
      </ul>
    </details>
  </div>
</template>

<script setup lang="ts">
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import type { SkillImportPreview } from '#shared/types/skills.d'

const LICENCE_EXCERPT_LINES = 12

const props = withDefaults(defineProps<{
  preview: SkillImportPreview
  readFile?: (path: string) => string | null
  fileName?: string | null
}>(), {
  readFile: () => null,
  fileName: null,
})

const selectedPath = shallowRef<string>(SKILL_MD_FILE_NAME)
const focusLine = shallowRef<number | null>(null)

const totalBytes = computed<number>(() => {
  return props.preview.files.reduce((total, file) => {
    return total + file.bytes
  }, 0)
})

const sourceLabel = computed<string>(() => {
  const { source, sourceUrl, sourcePath, sourceVersion } = props.preview

  if (source === 'github' && sourceUrl) {
    const location = sourcePath
      ? `${sourceUrl.replace(/^https?:\/\//, '')}/${sourcePath}`
      : sourceUrl.replace(/^https?:\/\//, '')

    return `${location} @ ${sourceVersion.slice(0, 7)}`
  }

  if (source === 'text') {
    return 'Pasted text'
  }

  return props.fileName ? `Uploaded file ${props.fileName}` : 'Uploaded file'
})

const licenceLabel = computed<string>(() => {
  const label = getSkillLicenceLabel(props.preview.licence.class)

  return props.preview.licence.spdx
    ? `${label} (${props.preview.licence.spdx})`
    : label
})

const licenceBadgeClass = computed<string>(() => {
  if (props.preview.licence.class === 'open') {
    return 'badge-success'
  }

  return props.preview.licence.class === 'none' ? 'badge-warning' : ''
})

const licenceFileSuffix = computed<string>(() => {
  return props.preview.licence.file ? ` (${props.preview.licence.file})` : ''
})

const licenceExcerpt = computed<string>(() => {
  const text = props.preview.licence.licenceText

  return text
    ? text.split('\n').slice(0, LICENCE_EXCERPT_LINES).join('\n')
    : ''
})

const findingSummary = computed<string>(() => {
  return describeFindingCounts(props.preview.findingCounts)
})

const flaggedByPath = computed<Record<string, number>>(() => {
  const counts: Record<string, number> = {}

  for (const finding of props.preview.findings) {
    counts[finding.path] = (counts[finding.path] ?? 0) + 1
  }

  return counts
})

async function onSelectFinding(path: string, line: number) {
  selectedPath.value = path
  focusLine.value = null
  await nextTick()
  focusLine.value = line
}

watch(selectedPath, () => {
  focusLine.value = null
})

const selectedText = computed<string | null>(() => {
  if (selectedPath.value === SKILL_MD_FILE_NAME) {
    return props.preview.skillMd
  }

  return props.readFile(selectedPath.value)
})
</script>

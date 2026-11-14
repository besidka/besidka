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
        class="grid min-w-0 gap-1 break-words"
        data-testid="skill-review-source"
      >
        <span data-testid="skill-review-source-label">{{ sourceLabel }}</span>
        <span
          v-if="releaseNote"
          class="text-xs text-base-content/70"
          data-testid="skill-review-release"
        >
          {{ releaseNote }}
        </span>
        <button
          v-if="switchLabel"
          type="button"
          class="link w-fit text-left text-xs"
          data-testid="skill-review-switch-source"
          @click="emit('switchChannel', switchTarget)"
        >
          {{ switchLabel }}
        </button>
      </dd>
      <dt class="text-base-content/70">
        License
      </dt>
      <dd
        class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
        data-testid="skill-review-license"
      >
        <template v-if="preview.license.spdx">
          <span
            class="font-medium"
            data-testid="skill-review-license-spdx"
          >
            {{ preview.license.spdx }}
          </span>
          <span
            class="text-base-content/70"
            aria-hidden="true"
          >
            &middot;
          </span>
        </template>
        <span
          class="badge badge-soft badge-sm"
          :class="licenseBadgeClass"
          data-testid="skill-review-license-class"
        >
          {{ licenseClassLabel }}
        </span>
        <span
          v-if="preview.license.fromRepositoryRoot"
          class="text-xs text-base-content/70"
          data-testid="skill-review-license-root"
        >
          From the repository root
        </span>
      </dd>
      <template v-if="licenseFieldDiffers">
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
      v-if="licenseExcerpt"
      class="rounded-box border border-base-300"
      data-testid="skill-review-license-text"
    >
      <summary class="cursor-pointer px-3 py-2 text-sm font-medium">
        License text
        <span
          v-if="preview.license.file"
          class="font-normal text-base-content/70"
        >
          &middot; {{ preview.license.file }}
        </span>
      </summary>
      <pre class="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-base-300 px-3 py-2 font-mono text-xs">{{ licenseExcerpt }}</pre>
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

const LICENSE_EXCERPT_LINES = 12

const props = withDefaults(defineProps<{
  preview: SkillImportPreview
  readFile?: (path: string) => string | null
  fileName?: string | null
}>(), {
  readFile: () => null,
  fileName: null,
})

const emit = defineEmits<{
  switchChannel: [channel: 'release' | 'branch']
}>()

const selectedPath = shallowRef<string>(SKILL_MD_FILE_NAME)
const focusLine = shallowRef<number | null>(null)

const totalBytes = computed<number>(() => {
  return props.preview.files.reduce((total, file) => {
    return total + file.bytes
  }, 0)
})

const authorVersion = computed<string | null>(() => {
  const version = props.preview.skill.metadata?.version

  return !props.preview.release?.tag && version ? version : null
})

const sourceLabel = computed<string>(() => {
  const { source, sourceUrl, sourcePath, sourceVersion, release }
    = props.preview

  if (source === 'github' && sourceUrl) {
    const location = sourcePath
      ? `${sourceUrl.replace(/^https?:\/\//, '')}/${sourcePath}`
      : sourceUrl.replace(/^https?:\/\//, '')
    const version = release?.tag ?? sourceVersion.slice(0, 7)

    return `${location} @ ${version}`
  }

  if (source === 'text') {
    return 'Pasted text'
  }

  return props.fileName ? `Uploaded file ${props.fileName}` : 'Uploaded file'
})

const releaseNote = computed<string>(() => {
  const { release } = props.preview

  if (props.preview.source !== 'github') {
    return ''
  }

  if (release?.tag) {
    return release.isLatestRelease
      ? 'Latest release'
      : 'A release, not the latest'
  }

  if (authorVersion.value) {
    return `Version ${authorVersion.value} (from SKILL.md)`
  }

  return release?.channel === 'branch' && release.defaultBranch
    ? `Latest commit on ${release.defaultBranch}`
    : ''
})

const switchTarget = computed<'release' | 'branch'>(() => {
  return props.preview.release?.channel === 'release' ? 'branch' : 'release'
})

const switchLabel = computed<string>(() => {
  const { release } = props.preview

  if (!release?.switchable) {
    return ''
  }

  if (release.channel === 'release') {
    return `Use the latest commit on ${release.defaultBranch ?? 'the default branch'} instead`
  }

  return release.latestTag
    ? `Use the latest release ${release.latestTag} instead`
    : ''
})

const licenseClassLabel = computed<string>(() => {
  const label = getSkillLicenseLabel(props.preview.license.class)

  return props.preview.license.spdx ? label.toLowerCase() : label
})

const licenseFieldDiffers = computed<boolean>(() => {
  const field = props.preview.skill.license?.trim()

  if (!field) {
    return false
  }

  return field.toLowerCase() !== (props.preview.license.spdx ?? '').toLowerCase()
})

const licenseBadgeClass = computed<string>(() => {
  if (props.preview.license.class === 'open') {
    return 'badge-success'
  }

  return props.preview.license.class === 'none' ? 'badge-warning' : ''
})

const licenseExcerpt = computed<string>(() => {
  const text = props.preview.license.licenseText

  return text
    ? text.split('\n').slice(0, LICENSE_EXCERPT_LINES).join('\n')
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

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
          v-if="fileStatus === 'ready' && fileText !== null"
          :path="selectedPath"
          :text="fileText"
          :findings="preview.findings"
          :focus-line="focusLine"
        />
        <div
          v-else-if="fileStatus === 'loading'"
          class="grid gap-2 rounded-box bg-base-200 p-3"
          role="status"
          aria-label="Loading the file"
          data-testid="skill-review-file-loading"
        >
          <div class="skeleton skeleton--default h-4 w-1/2" />
          <div class="skeleton skeleton--default h-4 w-full" />
          <div class="skeleton skeleton--default h-4 w-3/4" />
        </div>
        <p
          v-else
          class="rounded-box bg-base-200 p-3 text-sm"
          role="alert"
          data-testid="skill-review-file-error"
        >
          {{ fileError }}
        </p>
      </div>
    </div>

    <div
      v-if="preview.findings.length"
      class="grid gap-2"
      data-testid="skill-review-findings"
    >
      <details
        v-for="group in findingGroups"
        :key="group.severity"
        class="rounded-box border border-base-300"
        :open="group.isOpenByDefault"
        :data-testid="`skill-review-findings-${group.severity}`"
      >
        <summary class="cursor-pointer px-3 py-2 text-sm font-medium">
          {{ group.title }} ({{ group.findings.length }})
        </summary>
        <ul class="grid max-h-64 gap-1 overflow-auto border-t border-base-300 p-2 text-xs">
          <li
            v-for="(finding, index) in group.findings"
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
              <span
                v-if="describeQuotedMention(finding)"
                class="shrink-0 text-base-content/70"
                data-testid="skill-review-finding-quoted"
              >
                {{ describeQuotedMention(finding) }}
              </span>
            </button>
          </li>
        </ul>
      </details>
    </div>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import type { SkillImportPreview } from '#shared/types/skills.d'

const LICENSE_EXCERPT_LINES = 12

const props = withDefaults(defineProps<{
  preview: SkillImportPreview
  readFile?: (path: string) => string | null
  loadFile?: (path: string) => Promise<string>
  fileName?: string | null
}>(), {
  readFile: () => null,
  loadFile: undefined,
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
  return describeFindingSummary(props.preview.findingCounts)
})

const findingGroups = computed(() => {
  return groupFindingsBySeverity(props.preview.findings)
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

const fileStatus = shallowRef<'ready' | 'loading' | 'error'>('ready')
const fileText = shallowRef<string | null>(null)
const fileError = shallowRef<string>('')
let loadedTexts = new Map<string, string>()
let loadedStageId = ''

function showFile(text: string) {
  fileText.value = text
  fileError.value = ''
  fileStatus.value = 'ready'
}

function describeLoadFailure(exception: unknown): string {
  const parsedException = parseError(exception)

  return [
    parsedException.message || 'The file could not be loaded.',
    parsedException.why,
  ].filter(Boolean).join('. ')
}

/**
 * The text of the selected file: `SKILL.md` comes with the preview, a file of
 * an uploaded archive is read in the browser, anything else is fetched from
 * the staged copy on the server (`loadFile`), once per file. A file that
 * cannot be loaded (expired import, too large) says why in plain text.
 */
async function loadSelectedFile() {
  const path = selectedPath.value

  if (props.preview.stageId !== loadedStageId) {
    loadedStageId = props.preview.stageId
    loadedTexts = new Map()
  }

  const known = path === SKILL_MD_FILE_NAME
    ? props.preview.skillMd
    : props.readFile(path) ?? loadedTexts.get(path) ?? null

  if (known !== null) {
    showFile(known)

    return
  }

  if (!props.loadFile) {
    fileText.value = null
    fileError.value = 'This file cannot be shown here.'
    fileStatus.value = 'error'

    return
  }

  fileText.value = null
  fileStatus.value = 'loading'

  try {
    const text = await props.loadFile(path)

    loadedTexts.set(path, text)

    if (selectedPath.value === path) {
      showFile(text)
    }
  } catch (exception) {
    if (selectedPath.value !== path) {
      return
    }

    fileError.value = describeLoadFailure(exception)
    fileStatus.value = 'error'
  }
}

watch(
  [selectedPath, () => props.preview.stageId],
  loadSelectedFile,
  { immediate: true },
)
</script>

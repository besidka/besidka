<template>
  <div
    v-if="status === 'pending' && !data"
    class="grid gap-2"
    role="status"
    aria-label="Loading versions"
    data-testid="skill-versions-loading"
  >
    <div
      v-for="index in 3"
      :key="index"
      class="skeleton skeleton--default h-14 w-full"
    />
  </div>
  <div
    v-else-if="error"
    class="alert alert-error alert-soft"
    role="alert"
    data-testid="skill-versions-error"
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
  <ul
    v-else-if="data"
    class="divide-y divide-base-300 rounded-box border border-base-300"
    data-testid="skill-versions-list"
  >
    <li
      v-for="version in data.versions"
      :key="version.version"
      class="grid gap-2 p-3"
      :data-testid="`skill-version-${version.version}`"
    >
      <div class="flex flex-wrap items-center gap-2">
        <span class="font-mono font-semibold">v{{ version.version }}</span>
        <span
          v-if="version.isCurrent"
          class="badge badge-soft badge-success badge-sm"
        >
          Current
        </span>
        <span
          v-if="version.isPending"
          class="badge badge-soft badge-info badge-sm"
        >
          Pending
        </span>
        <span class="text-sm">
          {{ describeSkillVersionOrigin(version) }}
        </span>
      </div>
      <p
        v-if="version.note"
        class="text-sm text-base-content/70"
      >
        {{ version.note }}
      </p>
      <p class="text-xs text-base-content/60">
        <UiLocalDate
          :value="version.createdAt"
          with-time
        />
        · {{ version.filesCount }}
        {{ version.filesCount === 1 ? 'file' : 'files' }}
        · {{ formatFileSize(version.bytes) }}
      </p>
      <div
        v-if="!version.isCurrent"
        class="flex flex-wrap gap-2"
      >
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          :aria-expanded="comparedVersion === version.version"
          :disabled="isComparing"
          data-testid="skill-version-compare"
          @click="onCompare(version.version)"
        >
          <span
            v-if="isComparing && comparedVersion === version.version"
            class="loading loading-spinner loading-xs"
          />
          Compare with current
        </button>
        <button
          v-if="!version.isPending"
          type="button"
          class="btn btn-sm btn-ghost"
          :disabled="isRestoring"
          data-testid="skill-version-restore"
          @click="onRestore(version.version)"
        >
          Restore
        </button>
        <button
          v-else
          type="button"
          class="btn btn-sm btn-ghost"
          data-testid="skill-version-review"
          @click="emit('reviewUpdate')"
        >
          Review update
        </button>
      </div>
      <div
        v-if="comparedVersion === version.version && diff"
        class="grid gap-2"
        data-testid="skill-version-diff"
      >
        <p class="text-sm font-medium">
          {{ version.isPending ? 'Accepting' : 'Restoring' }}
          v{{ version.version }} would change:
        </p>
        <ProfileSkillsDiffView
          :files="diff.diff.files"
          :added="diff.diff.added"
          :removed="diff.diff.removed"
          :truncated="diff.diff.truncated"
          :skipped="diff.skipped"
        />
      </div>
      <p
        v-if="comparedVersion === version.version && diffError"
        class="text-sm text-error"
        role="alert"
      >
        {{ diffError }}
      </p>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import type { SkillVersionDiffResponse } from '#shared/types/skills.d'

const props = defineProps<{
  skillId: string
  skillName: string
}>()

const emit = defineEmits<{
  reviewUpdate: []
}>()

const { data, status, error, refresh } = useLazyFetch(
  () => `/api/v1/skills/${props.skillId}/versions`,
  { key: `${SKILLS_LIBRARY_KEY}-versions-${props.skillId}` },
)

const comparedVersion = shallowRef<number | null>(null)
const diff = shallowRef<SkillVersionDiffResponse | null>(null)
const diffError = shallowRef<string>('')
const isComparing = shallowRef<boolean>(false)
const isRestoring = shallowRef<boolean>(false)

const errorMessage = computed<string>(() => {
  return error.value
    ? parseError(error.value).message || 'The versions could not be loaded.'
    : ''
})

async function onCompare(version: number) {
  if (comparedVersion.value === version && diff.value) {
    comparedVersion.value = null
    diff.value = null

    return
  }

  comparedVersion.value = version
  diff.value = null
  diffError.value = ''
  isComparing.value = true

  try {
    diff.value = await $fetch(
      `/api/v1/skills/${props.skillId}/versions/${version}/diff`,
    )
  } catch (exception) {
    diffError.value = parseError(exception).message
      || 'The comparison could not be loaded.'
  } finally {
    isComparing.value = false
  }
}

async function onRestore(version: number) {
  const confirmation = await useConfirm({
    text: `Restore v${version} of "${props.skillName}"?`,
    subtitle: 'The files of that version become a new version. Nothing in '
      + 'the history is deleted.',
    actions: ['Restore'],
  })

  if (!confirmation) {
    return
  }

  isRestoring.value = true

  try {
    await $fetch(
      `/api/v1/skills/${props.skillId}/versions/${version}/restore`,
      { method: 'POST', body: {} },
    )
    comparedVersion.value = null
    diff.value = null
    await refreshSkillData(props.skillId)
    useSuccessMessage(`Restored v${version}`)
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to restore the version',
      parsedException.why,
    )
  } finally {
    isRestoring.value = false
  }
}
</script>

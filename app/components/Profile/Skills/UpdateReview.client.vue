<template>
  <ProfileSkillsWorkspaceDialog
    :title="title"
    size="workspace"
    :is-busy="isSubmitting"
    hook-class="js-skill-update-modal"
    @close="emit('close')"
  >
    <div
      v-if="detailStatus === 'pending' && !skill"
      class="grid gap-3"
      role="status"
      aria-label="Loading the update"
    >
      <div class="skeleton skeleton--default h-6 w-1/2" />
      <div class="skeleton skeleton--default h-40 w-full" />
    </div>
    <div
      v-else-if="detailError && !skill"
      class="alert alert-error alert-soft"
      role="alert"
      data-testid="skill-update-error"
    >
      <span>{{ detailErrorMessage }}</span>
    </div>
    <p
      v-else-if="skill && !pending"
      data-testid="skill-update-none"
    >
      There is no update to review.
    </p>
    <div
      v-else-if="skill && pending"
      class="grid min-w-0 gap-4"
      data-testid="skill-update-review"
    >
      <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt class="text-base-content/70">
          Compared with
        </dt>
        <dd data-testid="skill-update-current">
          v{{ skill.currentVersion }} (the version that is in use)
        </dd>
        <dt class="text-base-content/70">
          Update
        </dt>
        <dd
          class="min-w-0 break-words"
          data-testid="skill-update-pending"
        >
          v{{ pending.version }},
          {{ describeSkillVersionOrigin({ ...pending, isPending: false }) }}
          <a
            v-if="compareUrl"
            :href="compareUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="link ml-1"
          >
            View on GitHub
          </a>
        </dd>
        <dt class="text-base-content/70">
          License
        </dt>
        <dd data-testid="skill-update-license">
          {{ getSkillLicenseLabel(pending.licenseClass) }}
        </dd>
      </dl>

      <div
        class="alert alert-warning alert-soft items-start"
        role="note"
        data-testid="skill-update-warning"
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
          <p data-testid="skill-update-finding-counts">
            <template v-if="pendingFindingSummary">
              Highlighted in the update: {{ pendingFindingSummary }}.
            </template>
            <template v-else>
              Nothing was highlighted in the update.
            </template>
            <template v-if="currentFindingSummary">
              The version in use has: {{ currentFindingSummary }}.
            </template>
            Besidka highlights links and commands so you can review them. It
            cannot tell whether a skill is safe.
            <template v-if="isRescanned">
              Rescanned with newer checks.
            </template>
          </p>
          <p>
            Accepting switches the skill off until you turn it on again.
          </p>
        </div>
      </div>

      <ProfileSkillsJevSection
        :view="jevScreen.view.value"
        @retry="jevScreen.run()"
        @check-rest="jevScreen.checkRest()"
      />
      <ProfileSkillsFindingGroups
        v-if="jevScreen.findings.value.length"
        :findings="jevScreen.findings.value"
        :is-selectable="false"
        test-id="skill-update-jev-findings"
      />

      <div
        v-if="localEdits.length"
        class="alert alert-warning alert-soft items-start"
        role="alert"
        data-testid="skill-update-local-edits"
      >
        <Icon
          name="lucide:history"
          size="18"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <div class="grid gap-1 text-sm">
          <p class="font-medium">
            Accepting replaces your local edits since the import.
          </p>
          <p>
            Edited versions:
            {{ localEdits.map(edit => `v${edit.version}`).join(', ') }}.
            They stay in the history, so you can restore one later.
          </p>
        </div>
      </div>

      <div
        v-if="diff?.license.changed"
        class="alert alert-info alert-soft"
        role="note"
        data-testid="skill-update-license-changed"
      >
        <Icon
          name="lucide:info"
          size="16"
          class="shrink-0"
          aria-hidden="true"
        />
        <span>
          The license changed from
          {{ getSkillLicenseLabel(diff.license.before.class) }} to
          {{ getSkillLicenseLabel(diff.license.after.class) }}.
        </span>
      </div>

      <section
        v-if="changes"
        class="grid gap-3"
        aria-labelledby="skill-update-changes-title"
        data-testid="skill-update-changes"
      >
        <h3
          id="skill-update-changes-title"
          class="text-sm font-semibold"
        >
          What changed since your version
        </h3>
        <div
          class="grid gap-1"
          data-testid="skill-update-new-findings-section"
        >
          <h4 class="text-sm font-medium">
            New since your version
          </h4>
          <ProfileSkillsFindingGroups
            v-if="changes.newFindings.length"
            :findings="changes.newFindings"
            :is-selectable="false"
            test-id="skill-update-new-findings"
          />
          <p
            v-else
            class="text-sm text-base-content/70"
            data-testid="skill-update-new-findings-none"
          >
            Nothing new was highlighted.
          </p>
        </div>
        <div
          v-if="changes.newHosts.length"
          class="grid gap-1"
          data-testid="skill-update-new-hosts"
        >
          <h4 class="text-sm font-medium">
            New addresses
          </h4>
          <ul class="grid gap-0.5 text-xs">
            <li
              v-for="host in changes.newHosts"
              :key="host"
              class="font-mono break-all"
              data-testid="skill-update-new-host"
            >
              {{ host }}
            </li>
          </ul>
        </div>
        <div
          v-if="changes.changedSettings.length"
          class="grid gap-1"
          data-testid="skill-update-changed-settings"
        >
          <h4 class="text-sm font-medium">
            Changed settings
          </h4>
          <ul class="grid gap-1 text-xs">
            <li
              v-for="setting in changes.changedSettings"
              :key="setting.key"
              class="grid gap-0.5"
              data-testid="skill-update-changed-setting"
            >
              <span class="font-mono">{{ setting.key }}</span>
              <span class="break-words text-base-content/70">
                {{ setting.before ?? 'not set' }}
                &rarr;
                {{ setting.after ?? 'not set' }}
              </span>
            </li>
          </ul>
        </div>
        <div
          v-if="changes.newScripts.length"
          class="grid gap-1"
          data-testid="skill-update-new-scripts"
        >
          <h4 class="text-sm font-medium">
            New script files
          </h4>
          <ul class="grid gap-0.5 text-xs">
            <li
              v-for="path in changes.newScripts"
              :key="path"
              class="font-mono break-all"
            >
              {{ path }}
            </li>
          </ul>
        </div>
        <p
          v-if="changes.isPartial"
          class="text-xs text-base-content/70"
          data-testid="skill-update-changes-partial"
        >
          Not every changed file was read, so these lists may be incomplete.
        </p>
      </section>

      <div
        v-if="diffStatus === 'pending' && !diff"
        class="skeleton skeleton--default h-40 w-full"
        role="status"
        aria-label="Loading the changes"
      />
      <div
        v-else-if="diffError"
        class="alert alert-error alert-soft"
        role="alert"
        data-testid="skill-update-diff-error"
      >
        <span>{{ diffErrorMessage }}</span>
        <button
          type="button"
          class="btn btn-sm"
          @click="refreshDiff()"
        >
          Retry
        </button>
      </div>
      <ProfileSkillsDiffView
        v-else-if="diff"
        :files="diff.diff.files"
        :added="diff.diff.added"
        :removed="diff.diff.removed"
        :truncated="diff.diff.truncated"
        :skipped="diff.skipped"
      />

      <p
        v-if="errorMessage"
        class="text-sm text-error"
        role="alert"
        data-testid="skill-update-action-error"
      >
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <template v-if="skill && pending">
        <div class="mr-auto grid gap-1 text-sm max-sm:basis-full">
          <label class="flex min-h-8 cursor-pointer items-center gap-2">
            <input
              v-model="isReviewed"
              type="checkbox"
              class="checkbox checkbox-sm"
              data-testid="skill-update-reviewed"
            >
            I reviewed this update
          </label>
          <label
            v-if="highlightTickLabel"
            class="flex min-h-8 cursor-pointer items-center gap-2"
          >
            <input
              v-model="isHighlightsRead"
              type="checkbox"
              class="checkbox checkbox-sm"
              data-testid="skill-update-highlights"
            >
            {{ highlightTickLabel }}
          </label>
          <label
            v-if="needsLicenseTick"
            class="flex min-h-8 cursor-pointer items-center gap-2"
          >
            <input
              v-model="isLicenseAcknowledged"
              type="checkbox"
              class="checkbox checkbox-sm"
              data-testid="skill-update-license-tick"
            >
            {{ pending.licenseClass === 'none'
              ? 'I have the right to use this skill'
              : 'I read the license and may use this skill' }}
          </label>
        </div>
        <button
          type="button"
          class="btn btn-sm"
          :disabled="isSubmitting"
          data-testid="skill-update-reject"
          @click="onReject"
        >
          Reject
        </button>
        <button
          type="button"
          class="btn btn-sm btn-accent"
          :disabled="!canAccept || isSubmitting"
          data-testid="skill-update-accept"
          @click="onAccept"
        >
          <span
            v-if="isSubmitting"
            class="loading loading-spinner loading-xs"
          />
          Accept update
        </button>
      </template>
      <button
        v-else
        type="button"
        class="btn btn-sm"
        data-testid="skill-update-close"
        @click="emit('close')"
      >
        Close
      </button>
    </template>
  </ProfileSkillsWorkspaceDialog>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import { countStoredHighlights } from '#shared/utils/skills/findings'

const props = defineProps<{
  skillId: string
}>()

const emit = defineEmits<{
  close: []
}>()

const {
  data: skill,
  status: detailStatus,
  error: detailError,
  refresh: refreshDetail,
} = useSkillDetail(() => props.skillId)
const { data: versions, refresh: refreshVersions } = useLazyFetch(
  () => `/api/v1/skills/${props.skillId}/versions`,
  { key: `${SKILLS_LIBRARY_KEY}-versions-${props.skillId}` },
)

const pending = computed(() => {
  return skill.value?.pendingVersionInfo ?? null
})

const {
  data: diff,
  status: diffStatus,
  error: diffError,
  refresh: refreshDiff,
} = useLazyAsyncData(
  () => `skill-update-diff-${props.skillId}-${pending.value?.version ?? 0}`,
  async () => {
    if (!pending.value) {
      return null
    }

    return await $fetch(
      `/api/v1/skills/${props.skillId}/versions/${pending.value.version}/diff`,
      { query: { changes: 'true' } },
    )
  },
  { watch: [pending] },
)

const jevScreen = useSkillJevScreen(() => {
  return pending.value
    ? {
      kind: 'version',
      skillId: props.skillId,
      version: pending.value.version,
    }
    : null
})

const isReviewed = shallowRef<boolean>(false)
const isHighlightsRead = shallowRef<boolean>(false)
const isLicenseAcknowledged = shallowRef<boolean>(false)
const isSubmitting = shallowRef<boolean>(false)
const errorMessage = shallowRef<string>('')

const title = computed<string>(() => {
  return skill.value ? `Review update for ${skill.value.name}` : 'Review update'
})

const detailErrorMessage = computed<string>(() => {
  return detailError.value
    ? parseError(detailError.value).message || 'The skill could not be loaded.'
    : ''
})

const diffErrorMessage = computed<string>(() => {
  return diffError.value
    ? parseError(diffError.value).message || 'The changes could not be loaded.'
    : ''
})

const localEdits = computed(() => {
  return findLocalEditsSinceImport(versions.value?.versions ?? [])
})

const needsLicenseTick = computed<boolean>(() => {
  const next = pending.value?.licenseClass
  const current = skill.value?.currentVersionInfo?.licenseClass

  return (next === 'none' || next === 'custom') && next !== current
})

async function rescanVersion(
  version: number | undefined,
  stored: Record<string, number> | null | undefined,
) {
  return await rescanStoredFindingCounts({
    stored: stored ?? null,
    listPaths: async () => {
      const listing = await $fetch(`/api/v1/skills/${props.skillId}/files`, {
        query: { version },
      })

      if (!('files' in listing) || !listing.files) {
        throw new Error('The version has no file list')
      }

      return listing.files.map((file) => {
        return file.path
      })
    },
    readText: async (path) => {
      const file = await $fetch(`/api/v1/skills/${props.skillId}/files`, {
        query: { version, path },
      })

      if (!('text' in file)) {
        throw new Error('The file has no text')
      }

      return file.text
    },
  })
}

const { data: pendingFindings } = useLazyAsyncData(
  () => `skill-update-findings-${props.skillId}-${pending.value?.version ?? 0}`,
  async () => {
    return await rescanVersion(
      pending.value?.version,
      pending.value?.findings,
    )
  },
  { watch: [pending] },
)

const { data: currentFindings } = useLazyAsyncData(
  () => `skill-update-current-findings-${props.skillId}-${
    skill.value?.currentVersionInfo?.version ?? 0
  }`,
  async () => {
    return await rescanVersion(
      skill.value?.currentVersionInfo?.version,
      skill.value?.currentVersionInfo?.findings,
    )
  },
  { watch: [skill] },
)

const pendingFindingSummary = computed<string>(() => {
  return describeFindingSummary(
    pendingFindings.value?.counts ?? pending.value?.findings,
  )
})

const currentFindingSummary = computed<string>(() => {
  return describeFindingSummary(
    currentFindings.value?.counts ?? skill.value?.currentVersionInfo?.findings,
  )
})

const isRescanned = computed<boolean>(() => {
  return Boolean(
    pendingFindings.value?.isRescanned || currentFindings.value?.isRescanned,
  )
})

const changes = computed(() => {
  return diff.value?.changes ?? null
})

const newHighlightCount = computed<number>(() => {
  if (changes.value && !changes.value.isPartial) {
    return changes.value.newFindings.filter((finding) => {
      return finding.severity === 'high'
    }).length
  }

  return countStoredHighlights(
    pendingFindings.value?.counts ?? pending.value?.findings,
  )
})

const highlightTickLabel = computed<string>(() => {
  return describeHighlightTick(
    newHighlightCount.value,
    changes.value?.newFindings ?? [],
  )
})

const canAccept = computed<boolean>(() => {
  return isReviewed.value
    && diffStatus.value !== 'pending'
    && (!highlightTickLabel.value || isHighlightsRead.value)
    && (!needsLicenseTick.value || isLicenseAcknowledged.value)
})

const compareUrl = computed<string | null>(() => {
  const current = skill.value
  const next = pending.value

  if (
    current?.sourceKind !== 'github'
    || !current.sourceUrl?.startsWith('https://')
    || !current.sourceVersion
    || !next?.sourceVersion
  ) {
    return null
  }

  return `${current.sourceUrl}/compare/${current.sourceVersion}...${
    next.sourceVersion
  }`
})

watch(() => pending.value?.sha256, () => {
  isReviewed.value = false
  isHighlightsRead.value = false
  isLicenseAcknowledged.value = false
})

async function reload() {
  await Promise.all([refreshDetail(), refreshVersions()])
  await refreshSkillData(props.skillId)
}

async function onAccept() {
  const next = pending.value

  if (!next || !canAccept.value || isSubmitting.value) {
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    const result = await $fetch(
      `/api/v1/skills/${props.skillId}/update/accept`,
      {
        method: 'POST',
        body: {
          version: next.version,
          sha256: next.sha256,
          ...(needsLicenseTick.value ? { licenseAcknowledged: true } : {}),
        },
      },
    )

    await refreshSkillData(props.skillId)
    useSuccessMessage(
      `${skill.value?.name ?? 'The skill'} is now v${result.version}`,
      'It is switched off until you turn it on again.',
    )
    emit('close')
  } catch (exception) {
    const parsedException = parseError(exception)

    errorMessage.value = parsedException.why
      ? `${parsedException.message}. ${parsedException.why}`
      : parsedException.message || 'The update could not be accepted.'

    if (parsedException.code === 'pending-changed') {
      await reload()
    }
  } finally {
    isSubmitting.value = false
  }
}

async function onReject() {
  const next = pending.value

  if (!next || isSubmitting.value) {
    return
  }

  isSubmitting.value = true
  errorMessage.value = ''

  try {
    await $fetch(`/api/v1/skills/${props.skillId}/update/reject`, {
      method: 'POST',
      body: { version: next.version, sha256: next.sha256 },
    })
    await refreshSkillData(props.skillId)
    emit('close')
  } catch (exception) {
    const parsedException = parseError(exception)

    errorMessage.value = parsedException.message
      || 'The update could not be rejected.'

    if (parsedException.code === 'pending-changed') {
      await reload()
    }
  } finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="mb-8 text-center">
    <h1 class="text-4xl font-bold">Labs</h1>
    <h2 class="mt-2">
      Experimental features on your account. They may change or be removed.
    </h2>
  </div>
  <div class="grid gap-6">
    <template v-if="status === 'pending' && !data">
      <div
        v-for="index in 2"
        :key="index"
        class="skeleton skeleton--default h-36 w-full rounded-box"
        data-testid="labs-skeleton"
      />
    </template>
    <div
      v-else-if="!data"
      role="alert"
      class="alert alert-error alert-soft"
      data-testid="labs-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="16"
        class="shrink-0"
        aria-hidden="true"
      />
      <span>Labs did not load.</span>
      <UiButton
        text="Retry"
        size="sm"
        mode="default"
        outline
        normal-case
        data-testid="labs-retry"
        @click="refresh()"
      />
    </div>
    <template v-else>
      <ProfileSecuritySectionCard
        v-for="group in featureGroups"
        :key="group.feature.key"
        :heading="group.feature.title"
        :data-testid="`labs-feature-${group.feature.key}`"
      >
        <template #icon>
          <Icon
            :name="getLabsFeatureIcon(group.feature.key)"
            size="20"
            class="shrink-0"
            aria-hidden="true"
          />
        </template>
        <ul class="grid gap-4">
          <li
            v-for="feature in [group.feature, ...group.children]"
            :key="feature.key"
            class="flex items-start justify-between gap-4"
            :class="{ 'border-t border-base-content/10 pt-4': feature.parent }"
            :data-testid="`labs-row-${feature.key}`"
          >
            <span class="grid min-w-0 gap-1">
              <span class="inline-flex flex-wrap items-center gap-2">
                <span
                  :id="`labs-title-${feature.key}`"
                  class="font-bold"
                  :class="{ 'sr-only': !feature.parent }"
                >{{ feature.title }}</span>
                <span class="badge badge-soft badge-sm">
                  {{ getLabsStageLabel(feature.stage) }}
                </span>
              </span>
              <span
                :id="`labs-description-${feature.key}`"
                class="text-sm text-base-content/70"
              >
                {{ feature.description }}
              </span>
              <span
                v-if="getLabsSpendNote(feature.spend)"
                class="inline-flex items-center gap-1 text-xs text-base-content/60"
                :data-testid="`labs-spend-${feature.key}`"
              >
                <Icon
                  name="lucide:wallet"
                  size="14"
                  class="shrink-0"
                  aria-hidden="true"
                />
                {{ getLabsSpendNote(feature.spend) }}
              </span>
              <span
                v-if="findBlockingParentTitle(feature)"
                class="inline-flex items-center gap-1 text-xs text-base-content/60"
                :data-testid="`labs-parent-hint-${feature.key}`"
              >
                <Icon
                  name="lucide:corner-left-up"
                  size="14"
                  class="shrink-0"
                  aria-hidden="true"
                />
                Works once {{ findBlockingParentTitle(feature) }} is on
              </span>
              <NuxtLink
                v-for="kind in missingKeyKinds(feature)"
                :key="kind"
                to="/profile/keys"
                class="link link-hover inline-flex items-center gap-1 text-xs"
                :data-testid="`labs-readiness-${feature.key}-${kind}`"
              >
                <Icon
                  name="lucide:key-round"
                  size="14"
                  class="shrink-0"
                  aria-hidden="true"
                />
                {{ describeMissingKeyKind(kind) }}
              </NuxtLink>
            </span>
            <input
              v-if="feature.optIn === 'required'"
              type="checkbox"
              class="toggle mt-1 shrink-0"
              :aria-labelledby="`labs-title-${feature.key}`"
              :aria-describedby="`labs-description-${feature.key}`"
              :checked="isOptedIn(feature)"
              :aria-busy="isSaving(feature.key)"
              :data-testid="`labs-toggle-${feature.key}`"
              @change="toggleOptIn(feature, $event)"
            >
            <span
              v-else
              class="mt-1 inline-flex shrink-0 items-center gap-1 text-xs text-base-content/60"
            >
              <Icon
                :name="feature.active ? 'lucide:check' : 'lucide:minus'"
                size="14"
                aria-hidden="true"
              />
              {{ feature.active ? 'On' : 'Off' }}
            </span>
          </li>
        </ul>
      </ProfileSecuritySectionCard>
      <div
        v-if="!featureGroups.length"
        class="bubble rounded-box p-6 text-center text-sm text-base-content/70"
        data-testid="labs-empty"
      >
        No experimental features are available for your account yet.
      </div>
      <ProfileSecuritySectionCard heading="Rollouts and experiments">
        <template #icon>
          <Icon
            name="lucide:test-tubes"
            size="20"
            class="shrink-0"
            aria-hidden="true"
          />
        </template>
        <label
          class="flex items-start justify-between gap-4"
          :class="isSavingExperiments ? 'opacity-60' : 'cursor-pointer'"
        >
          <span class="grid gap-1">
            <span
              id="labs-experiments-title"
              class="font-bold"
            >Include my account in gradual rollouts and experiments</span>
            <span
              id="labs-experiments-description"
              class="text-sm text-base-content/70"
              data-testid="labs-experiments-notice"
            >
              New features are sometimes switched on for a share of accounts
              first, or tried in two versions. You can object to this at any
              time by turning it off. Features given to your account directly
              stay on.
            </span>
          </span>
          <input
            type="checkbox"
            class="toggle mt-1 shrink-0"
            aria-labelledby="labs-experiments-title"
            aria-describedby="labs-experiments-description"
            data-testid="labs-experiments-toggle"
            :checked="isIncludedInExperiments"
            :aria-busy="isSavingExperiments"
            @change="toggleExperiments($event)"
          >
        </label>
      </ProfileSecuritySectionCard>
    </template>
  </div>
</template>
<script setup lang="ts">
import type { LabsFeature } from '#shared/types/features.d'
import type { FeatureKeyKind } from '#shared/utils/features/registry'
import { parseError } from 'evlog'

definePageMeta({
  layout: 'profile',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Labs',
  robots: 'noindex, nofollow',
})

const { data, status, refresh } = await useFetch(
  '/api/v1/profiles/features',
  { key: 'labs-features' },
)
const { keyStatusForProvider } = useUserKeys()
const { refreshFeatures } = useFeatures()

const optInOverrides = shallowRef<Record<string, boolean>>({})
const savingFlags = shallowRef<string[]>([])
const experimentsOverride = shallowRef<boolean | null>(null)
const isSavingExperiments = shallowRef<boolean>(false)

const featureGroups = computed(() => {
  return groupLabsFeatures(data.value?.features ?? [])
})

const isIncludedInExperiments = computed<boolean>(() => {
  if (experimentsOverride.value !== null) {
    return experimentsOverride.value
  }

  return data.value?.objectedToExperiments !== true
})

function isOptedIn(feature: LabsFeature): boolean {
  return optInOverrides.value[feature.key] ?? feature.optedIn
}

function isSaving(flag: string): boolean {
  return savingFlags.value.includes(flag)
}

function findBlockingParentTitle(feature: LabsFeature): string | null {
  if (feature.optIn !== 'required' || !feature.parent) {
    return null
  }

  const parent = data.value?.features.find((candidate) => {
    return candidate.key === feature.parent
  })

  if (!parent || parent.optIn !== 'required' || isOptedIn(parent)) {
    return null
  }

  return parent.title
}

function restoreCheckbox(event: Event, checked: boolean) {
  if (event.target instanceof HTMLInputElement) {
    event.target.checked = checked
  }
}

function missingKeyKinds(feature: LabsFeature): FeatureKeyKind[] {
  return findMissingKeyKinds(feature, keyStatusForProvider)
}

function setOverride(flag: string, value: boolean | null) {
  const next = { ...optInOverrides.value }

  if (value === null) {
    Reflect.deleteProperty(next, flag)
  } else {
    next[flag] = value
  }

  optInOverrides.value = next
}

async function toggleOptIn(feature: LabsFeature, event: Event) {
  if (isSaving(feature.key)) {
    restoreCheckbox(event, isOptedIn(feature))

    return
  }

  const optedIn = !isOptedIn(feature)

  savingFlags.value = [...savingFlags.value, feature.key]
  setOverride(feature.key, optedIn)

  try {
    await $fetch(`/api/v1/profiles/features/${feature.key}/opt-in`, {
      method: 'POST',
      body: { optedIn },
    })
    await Promise.all([refresh(), refreshFeatures()])
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to save your choice',
      parsedException.why,
    )
  } finally {
    setOverride(feature.key, null)
    savingFlags.value = savingFlags.value.filter((flag) => {
      return flag !== feature.key
    })
  }
}

async function toggleExperiments(event: Event) {
  if (isSavingExperiments.value) {
    restoreCheckbox(event, isIncludedInExperiments.value)

    return
  }

  const included = !isIncludedInExperiments.value

  isSavingExperiments.value = true
  experimentsOverride.value = included

  try {
    await $fetch('/api/v1/profiles/features/experiments', {
      method: 'POST',
      body: { objected: !included },
    })
    await Promise.all([refresh(), refreshFeatures()])
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to save your choice',
      parsedException.why,
    )
  } finally {
    experimentsOverride.value = null
    isSavingExperiments.value = false
  }
}
</script>

<template>
  <div class="grid gap-6">
    <NuxtLink
      to="/admin/features"
      class="link link-hover inline-flex items-center gap-1 text-sm w-fit"
    >
      <Icon
        name="lucide:arrow-left"
        size="16"
        aria-hidden="true"
      />
      All features
    </NuxtLink>
    <div
      v-if="status === 'pending' && !data"
      class="grid gap-3"
      data-testid="admin-feature-loading"
    >
      <div class="skeleton skeleton--default h-24 w-full" />
      <div class="skeleton skeleton--default h-64 w-full" />
    </div>
    <div
      v-else-if="error || !data"
      role="alert"
      class="alert alert-error alert-soft"
      data-testid="admin-feature-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="16"
        class="shrink-0"
        aria-hidden="true"
      />
      <span>This feature did not load.</span>
      <UiButton
        text="Retry"
        size="sm"
        mode="default"
        outline
        normal-case
        @click="refresh()"
      />
    </div>
    <template v-else>
      <header class="grid gap-2">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-2xl font-bold">{{ feature.title }}</h2>
          <span class="badge badge-soft badge-sm">{{ feature.stage }}</span>
          <AdminFeatureStateBadge :state="featureState" />
          <span
            v-if="feature.spend !== 'none'"
            class="badge badge-soft badge-warning badge-sm"
          >
            Uses the user's API keys
          </span>
        </div>
        <code class="text-xs opacity-70 break-all">{{ feature.key }}</code>
        <p class="text-sm text-base-content/70">{{ feature.description }}</p>
        <p
          v-if="feature.killSwitched"
          class="text-sm"
        >
          Turned off for everyone by <code>NUXT_FEATURES_DISABLED</code>.
          The settings below apply once it is removed.
        </p>
      </header>
      <AdminRolloutNotice
        v-if="!data.rolloutEnabled"
        :gate="data.rolloutGate"
      />
      <form
        class="bubble rounded-box grid gap-6 p-6"
        data-testid="admin-feature-rule-form"
        @submit.prevent="saveRule"
      >
        <h3 class="text-lg font-bold">Access rule</h3>
        <label class="flex items-center justify-between gap-4">
          <span class="grid">
            <span class="font-medium">Feature on</span>
            <span class="text-sm text-base-content/70">
              Off turns it off for everyone, admins included.
            </span>
          </span>
          <input
            v-model="draft.enabled"
            type="checkbox"
            class="toggle toggle-success"
            data-testid="admin-feature-enabled"
          >
        </label>
        <fieldset class="fieldset">
          <legend class="fieldset-legend">Roles that get it</legend>
          <div class="flex flex-wrap gap-4">
            <label
              v-for="role in roleOptions"
              :key="role.value"
              class="label gap-2"
            >
              <input
                v-model="draft.allowRoles"
                type="checkbox"
                class="checkbox checkbox-sm"
                :value="role.value"
                :data-testid="`admin-feature-role-${role.value}`"
              >
              {{ role.label }}
            </label>
          </div>
          <p class="label">
            Registry default: {{ describeAllowedRoles(feature.allowRoles) }}.
          </p>
        </fieldset>
        <fieldset
          class="fieldset"
          :disabled="!data.rolloutEnabled"
        >
          <legend class="fieldset-legend">
            Gradual rollout: {{ formatBasisPoints(draft.rolloutBps) }}
            <span class="font-normal opacity-70">
              ({{ draft.rolloutBps }} bps)
            </span>
          </legend>
          <input
            v-model.number="rolloutPercent"
            type="range"
            min="0"
            max="100"
            step="1"
            class="range range-sm w-full"
            aria-label="Rollout percentage"
            data-testid="admin-feature-rollout"
          >
          <p class="label">
            {{
              data.rolloutEnabled
                ? 'Share of all accounts that get the feature.'
                : 'Disabled while gradual rollouts are off.'
            }}
          </p>
        </fieldset>
        <fieldset
          v-if="feature.variants.length"
          class="fieldset"
          :disabled="!data.rolloutEnabled"
        >
          <legend class="fieldset-legend">Variants (bps, total 10000)</legend>
          <div class="grid gap-2 sm:grid-cols-2">
            <label
              v-for="variant in draft.variants"
              :key="variant.key"
              class="input input-sm w-full"
            >
              <span class="label">{{ variant.key }}</span>
              <input
                v-model.number="variant.weightBps"
                type="number"
                min="0"
                max="10000"
                step="1"
              >
            </label>
          </div>
          <p class="label">
            Total {{ variantTotal }} of 10000.
            {{
              data.rolloutEnabled
                ? 'Variants apply only inside the rollout share.'
                : 'Disabled while gradual rollouts are off.'
            }}
          </p>
        </fieldset>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs text-base-content/70">
            Changes take effect within 5 minutes.
          </p>
          <div class="flex gap-2">
            <UiButton
              text="Reset"
              size="sm"
              mode="default"
              ghost
              normal-case
              :disabled="!isDirty || isSaving"
              @click="resetDraft"
            />
            <UiButton
              type="submit"
              text="Save rule"
              size="sm"
              normal-case
              :disabled="!canSave"
              data-testid="admin-feature-save"
            />
          </div>
        </div>
      </form>
      <AdminFeatureSchedules
        :flag="feature.key"
        :schedules="data.schedules ?? []"
        :rollout-gate="data.rolloutGate"
        @changed="refresh()"
      />
      <AdminFeatureGrants
        :flag="feature.key"
        :variants="feature.variants"
        @changed="refresh()"
      />
    </template>
  </div>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import { FEATURE_BASIS_POINTS_TOTAL } from '#shared/utils/features/admin-schemas'

interface RuleDraft {
  enabled: boolean
  allowRoles: string[]
  rolloutBps: number
  variants: { key: string, weightBps: number }[]
}

definePageMeta({
  layout: 'admin',
  middleware: ['admin'],
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Feature · Admin',
  robots: 'noindex, nofollow',
})

const route = useRoute()
const flagKey = computed<string>(() => {
  return String(route.params.flag ?? '')
})

const { data, status, error, refresh } = await useLazyFetch(() => {
  return `/api/v1/admin/features/${encodeURIComponent(flagKey.value)}`
})

const roleOptions = [
  { value: 'admin', label: 'Admins' },
  { value: 'tester', label: 'Testers' },
]

const draft = ref<RuleDraft>(createDraft())
const isSaving = shallowRef<boolean>(false)

const feature = computed(() => {
  return data.value!.flag
})

const featureState = computed(() => {
  return getAdminFeatureState(feature.value, {
    rolloutEnabled: data.value!.rolloutEnabled,
    hostMode: data.value!.hostMode,
  })
})

const rolloutPercent = computed<number>({
  get() {
    return Math.round(draft.value.rolloutBps / 100)
  },
  set(value) {
    draft.value.rolloutBps = Math.round(Number(value) * 100)
  },
})

const variantTotal = computed<number>(() => {
  return draft.value.variants.reduce((total, variant) => {
    return total + (Number(variant.weightBps) || 0)
  }, 0)
})

const savedDraft = computed<RuleDraft>(() => {
  return createDraft()
})

const isDirty = computed<boolean>(() => {
  return JSON.stringify(normaliseDraft(draft.value))
    !== JSON.stringify(normaliseDraft(savedDraft.value))
})

const canSave = computed<boolean>(() => {
  if (!isDirty.value || isSaving.value) {
    return false
  }

  return !draft.value.variants.length
    || variantTotal.value === FEATURE_BASIS_POINTS_TOTAL
    || variantTotal.value === 0
})

watch(() => data.value?.flag.key, () => {
  resetDraft()
})

function createDraft(): RuleDraft {
  const flag = data.value?.flag

  if (!flag) {
    return { enabled: true, allowRoles: [], rolloutBps: 0, variants: [] }
  }

  const ruleVariants = new Map((flag.rule?.variants ?? []).map((variant) => {
    return [variant.key, variant.weightBps]
  }))

  return {
    enabled: flag.rule?.enabled ?? true,
    allowRoles: [...(flag.rule?.allowRoles ?? flag.allowRoles)],
    rolloutBps: flag.rule?.rolloutBps ?? 0,
    variants: flag.variants.map((key) => {
      return { key, weightBps: ruleVariants.get(key) ?? 0 }
    }),
  }
}

function normaliseDraft(value: RuleDraft) {
  return {
    ...value,
    allowRoles: [...value.allowRoles].sort(),
  }
}

function resetDraft() {
  draft.value = createDraft()
}

function buildPatch() {
  const saved = savedDraft.value
  const next = draft.value
  const patch: Record<string, unknown> = {}

  if (next.enabled !== saved.enabled) {
    patch.enabled = next.enabled
  }

  if (
    JSON.stringify([...next.allowRoles].sort())
    !== JSON.stringify([...saved.allowRoles].sort())
  ) {
    patch.allowRoles = next.allowRoles
  }

  if (next.rolloutBps !== saved.rolloutBps) {
    patch.rolloutBps = next.rolloutBps
  }

  if (JSON.stringify(next.variants) !== JSON.stringify(saved.variants)) {
    patch.variants = variantTotal.value
      ? next.variants.map((variant) => {
        return { key: variant.key, weightBps: Number(variant.weightBps) || 0 }
      })
      : null
  }

  return patch
}

async function confirmTurningOff(): Promise<boolean> {
  if (draft.value.enabled || !savedDraft.value.enabled) {
    return true
  }

  const result = await useConfirm({
    text: `Turn off ${feature.value.key}?`,
    subtitle: 'This turns it off for everyone, admins included. It takes '
      + 'effect within 5 minutes.',
    actions: ['Turn off'],
    labelDecline: 'Cancel',
  })

  return result !== null
}

async function saveRule() {
  if (!canSave.value || !(await confirmTurningOff())) {
    return
  }

  isSaving.value = true

  try {
    await $fetch(
      `/api/v1/admin/features/${encodeURIComponent(flagKey.value)}/rule`,
      { method: 'PATCH', body: buildPatch() },
    )
    await refresh()
    resetDraft()
    useSuccessMessage('Rule saved')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to save the rule',
      parsedException.why,
    )
  } finally {
    isSaving.value = false
  }
}
</script>

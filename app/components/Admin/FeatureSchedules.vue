<template>
  <section
    class="bubble rounded-box grid gap-6 p-6"
    data-testid="admin-feature-schedules"
  >
    <div class="grid gap-1">
      <h3 class="text-lg font-bold">Schedule</h3>
      <p class="text-sm text-base-content/70">
        Plan changes to the access rule once. Each step applies on its own
        at the time you set, through the same audited path as a manual edit,
        and you get an email when it runs or fails. Times are your local time
        <span
          v-if="timeZone"
          data-testid="admin-schedule-timezone"
        >({{ timeZone }})</span>, stored as UTC.
      </p>
      <p
        v-if="rolloutGate"
        class="text-sm"
        data-testid="admin-schedule-gate"
      >
        <span
          class="badge badge-soft badge-sm mr-1"
          :class="rolloutGate.open ? 'badge-success' : 'badge-warning'"
        >
          {{ rolloutGate.open ? 'Rollout open' : 'Rollout closed' }}
        </span>
        {{ rolloutGate.description }}
      </p>
    </div>
    <p
      v-if="!schedules.length"
      class="text-sm text-base-content/70"
      data-testid="admin-schedule-empty"
    >
      Nothing is scheduled for this feature.
    </p>
    <ul
      v-else
      class="grid divide-y divide-base-300"
      data-testid="admin-schedule-list"
    >
      <li
        v-for="schedule in orderedSchedules"
        :key="schedule.id"
        class="flex flex-wrap items-start justify-between gap-3 py-3"
        :data-testid="`admin-schedule-step-${schedule.id}`"
      >
        <span class="grid min-w-0 gap-1">
          <span class="flex flex-wrap items-center gap-2">
            <span class="font-medium">
              <UiLocalDate
                :value="schedule.runAt * 1000"
                with-time
              />
            </span>
            <span
              class="badge badge-soft badge-sm"
              :class="statusClass(schedule.status)"
              :data-testid="`admin-schedule-status-${schedule.id}`"
            >
              {{ schedule.status }}
            </span>
          </span>
          <span class="flex flex-wrap gap-1">
            <span
              v-for="label in describeScheduleChange(schedule.change)"
              :key="label"
              class="badge badge-outline badge-sm"
            >
              {{ label }}
            </span>
          </span>
          <span
            v-if="gateHint(schedule)"
            class="text-xs text-base-content/70"
          >
            {{ gateHint(schedule) }}
          </span>
          <span
            v-else-if="schedule.error"
            class="text-xs text-base-content/70 break-words"
          >
            {{ schedule.error }}
          </span>
        </span>
        <UiButton
          v-if="isOpen(schedule)"
          text="Cancel"
          size="sm"
          mode="error"
          outline
          normal-case
          :disabled="isSaving"
          :data-testid="`admin-schedule-cancel-${schedule.id}`"
          @click="cancelStep(schedule)"
        />
      </li>
    </ul>
    <form
      class="grid gap-4"
      data-testid="admin-schedule-form"
      @submit.prevent="submitSteps"
    >
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h4 class="font-medium">New steps</h4>
        <div class="flex flex-wrap gap-2">
          <UiButton
            text="Staged plan"
            size="sm"
            mode="default"
            ghost
            normal-case
            data-testid="admin-schedule-staged-plan"
            @click="prefillStagedPlan"
          />
          <UiButton
            text="Add step"
            size="sm"
            mode="default"
            outline
            normal-case
            data-testid="admin-schedule-add-step"
            @click="addStep"
          />
        </div>
      </div>
      <p
        v-if="!rows.length"
        class="text-sm text-base-content/70"
      >
        Add a step, or prefill a staged plan and edit it.
      </p>
      <fieldset
        v-for="(row, rowIndex) in rows"
        :key="row.key"
        class="grid gap-3 rounded-box border border-base-300 p-4"
        :data-testid="`admin-schedule-row-${rowIndex}`"
      >
        <legend class="px-1 text-sm font-medium">
          Step {{ rowIndex + 1 }}
        </legend>
        <div class="grid gap-3 md:grid-cols-2">
          <label class="grid gap-1">
            <span class="text-sm font-medium">Date and time</span>
            <input
              v-model="row.runAtLocal"
              type="datetime-local"
              class="input w-full"
              :data-testid="`admin-schedule-run-at-${rowIndex}`"
            >
          </label>
          <label class="grid gap-1">
            <span class="text-sm font-medium">Feature</span>
            <select
              v-model="row.enabled"
              class="select w-full"
              :data-testid="`admin-schedule-enabled-${rowIndex}`"
            >
              <option value="keep">Leave as is</option>
              <option value="on">Turn on</option>
              <option value="off">Turn off for everyone</option>
            </select>
          </label>
        </div>
        <label class="label gap-2 justify-start">
          <input
            v-model="row.grantTesters"
            type="checkbox"
            class="checkbox checkbox-sm"
            :data-testid="`admin-schedule-testers-${rowIndex}`"
          >
          Give it to all testers
        </label>
        <div class="grid gap-2">
          <label class="label gap-2 justify-start">
            <input
              v-model="row.changeRollout"
              type="checkbox"
              class="checkbox checkbox-sm"
              :data-testid="`admin-schedule-rollout-toggle-${rowIndex}`"
            >
            Set the gradual rollout
          </label>
          <div
            v-if="row.changeRollout"
            class="flex flex-wrap items-center gap-3"
          >
            <input
              v-model.number="row.rolloutPercent"
              type="range"
              min="0"
              max="100"
              step="1"
              class="range range-sm min-w-40 flex-1"
              :aria-label="`Rollout percentage for step ${rowIndex + 1}`"
            >
            <label class="input input-sm w-28">
              <input
                v-model.number="row.rolloutPercent"
                type="number"
                min="0"
                max="100"
                step="1"
                :data-testid="`admin-schedule-rollout-${rowIndex}`"
              >
              <span class="label">%</span>
            </label>
          </div>
          <p
            v-if="waitsForGate(row)"
            class="text-xs text-base-content/70"
            :data-testid="`admin-schedule-gate-hint-${rowIndex}`"
          >
            {{ draftGateHint }}
          </p>
        </div>
        <p
          v-for="message in rowMessages(row)"
          :key="message"
          class="text-xs text-error"
          :data-testid="`admin-schedule-error-${rowIndex}`"
        >
          {{ message }}
        </p>
        <div class="flex justify-end">
          <UiButton
            text="Remove step"
            size="xs"
            mode="default"
            ghost
            normal-case
            :data-testid="`admin-schedule-remove-${rowIndex}`"
            @click="removeStep(row.key)"
          />
        </div>
      </fieldset>
      <div class="flex justify-end">
        <UiButton
          type="submit"
          :text="submitLabel"
          size="sm"
          normal-case
          :disabled="!canSubmit"
          data-testid="admin-schedule-submit"
        />
      </div>
    </form>
  </section>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import { validateScheduleSteps } from '#shared/utils/features/schedule-schemas'
import type {
  FeatureScheduleStepInput,
  FeatureScheduleStepView,
} from '#shared/utils/features/schedule-schemas'
import type {
  AdminRolloutGateView,
  DraftScheduleStep,
} from '~/utils/admin-schedule'

const props = defineProps<{
  flag: string
  schedules: FeatureScheduleStepView[]
  rolloutGate?: AdminRolloutGateView
}>()

const emit = defineEmits<{
  changed: []
}>()

const rows = ref<DraftScheduleStep[]>([])
const isSaving = shallowRef<boolean>(false)
const timeZone = shallowRef<string>('')
const nextKey = shallowRef<number>(1)
const now = shallowRef<Date>(new Date())

const openSchedules = computed<FeatureScheduleStepView[]>(() => {
  return props.schedules.filter(isOpen)
})

const orderedSchedules = computed<FeatureScheduleStepView[]>(() => {
  const upcoming = props.schedules.filter(isOpen)
  const finished = props.schedules
    .filter((schedule) => {
      return !isOpen(schedule)
    })
    .sort((first, second) => {
      return second.runAt - first.runAt
    })

  return [...upcoming, ...finished]
})

const draftGateHint = computed<string>(() => {
  const gate = props.rolloutGate

  if (!gate || gate.reason === 'override_off' || !gate.effectiveAt) {
    return 'This step waits: gradual rollouts are switched off by the '
      + 'environment.'
  }

  return `Applies after ${gate.effectiveAt}, when the Privacy notice takes `
    + 'effect.'
})

const issuesByKey = computed<Map<number, string[]>>(() => {
  const result = new Map<number, string[]>()
  const keyedInputs: { key: number, input: FeatureScheduleStepInput }[] = []

  for (const row of rows.value) {
    const input = draftStepToInput(row)

    if (input) {
      keyedInputs.push({ key: row.key, input })
    }
  }

  const issues = validateScheduleSteps(
    keyedInputs.map((entry) => {
      return entry.input
    }),
    {
      now: now.value,
      existingRunAtMs: openSchedules.value.map((schedule) => {
        return schedule.runAt * 1000
      }),
    },
  )

  for (const issue of issues) {
    const key = keyedInputs[issue.index]!.key

    result.set(key, [...(result.get(key) ?? []), issue.message])
  }

  return result
})

const canSubmit = computed<boolean>(() => {
  return !isSaving.value
    && rows.value.length > 0
    && rows.value.every((row) => {
      return parseLocalInputValue(row.runAtLocal) !== null
        && draftStepHasChange(row)
    })
    && issuesByKey.value.size === 0
})

const submitLabel = computed<string>(() => {
  return rows.value.length > 1
    ? `Schedule ${rows.value.length} steps`
    : 'Schedule step'
})

function isOpen(schedule: FeatureScheduleStepView): boolean {
  return schedule.status === 'pending' || schedule.status === 'blocked'
}

function statusClass(status: FeatureScheduleStepView['status']): string {
  const tone = scheduleStatusTone(status)

  return tone === 'neutral' ? '' : `badge-${tone}`
}

function gateHint(schedule: FeatureScheduleStepView): string | null {
  return describeScheduleGateHint(schedule, props.rolloutGate)
}

function waitsForGate(row: DraftScheduleStep): boolean {
  return draftStepWaitsForGate(row, props.rolloutGate)
}

function rowMessages(row: DraftScheduleStep): string[] {
  return issuesByKey.value.get(row.key) ?? []
}

function addStep() {
  now.value = new Date()
  rows.value.push(createDraftStep(nextKey.value))
  nextKey.value += 1
}

function removeStep(key: number) {
  rows.value = rows.value.filter((row) => {
    return row.key !== key
  })
}

function prefillStagedPlan() {
  now.value = new Date()

  const planned = buildStagedPlanRows(
    now.value,
    props.rolloutGate,
    nextKey.value,
  )

  rows.value = planned
  nextKey.value += planned.length
}

function describeDraftStep(row: DraftScheduleStep): string {
  const input = draftStepToInput(row)
  const when = parseLocalInputValue(row.runAtLocal)?.toLocaleString() ?? ''
  const labels: string[] = []

  if (row.enabled !== 'keep') {
    labels.push(row.enabled === 'on' ? 'turn on' : 'turn off')
  }

  if (row.grantTesters) {
    labels.push('all testers get it')
  }

  if (input?.rolloutBps !== undefined) {
    labels.push(`rollout ${row.rolloutPercent}%`)
  }

  return `${when}: ${labels.join(', ')}`
}

async function confirmSchedule(): Promise<boolean> {
  const result = await useConfirm({
    text: `Schedule ${rows.value.length === 1 ? 'this change' : 'these changes'}`
      + ` for ${props.flag}?`,
    subtitle: rows.value.map(describeDraftStep).join('\n')
      + '\nEach step changes the feature for every account it covers.',
    actions: ['Schedule'],
    labelDecline: 'Cancel',
  })

  return result !== null
}

async function submitSteps() {
  now.value = new Date()

  if (!canSubmit.value || !(await confirmSchedule())) {
    return
  }

  const steps = rows.value
    .map(draftStepToInput)
    .filter((step): step is FeatureScheduleStepInput => {
      return step !== null
    })

  isSaving.value = true

  try {
    await $fetch(
      `/api/v1/admin/features/${encodeURIComponent(props.flag)}/schedules`,
      { method: 'POST', body: { steps } },
    )
    rows.value = []
    emit('changed')
    useSuccessMessage(
      steps.length === 1 ? 'Step scheduled' : 'Steps scheduled',
    )
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to schedule the steps',
      parsedException.why,
    )
  } finally {
    isSaving.value = false
  }
}

async function cancelStep(schedule: FeatureScheduleStepView) {
  const result = await useConfirm({
    text: 'Cancel this scheduled step?',
    subtitle: 'It will not run.',
    actions: ['Cancel step'],
    labelDecline: 'Keep',
  })

  if (result === null) {
    return
  }

  isSaving.value = true

  try {
    await $fetch(
      `/api/v1/admin/features/${encodeURIComponent(props.flag)}`
      + `/schedules/${schedule.id}/cancel`,
      { method: 'POST' },
    )
    emit('changed')
    useSuccessMessage('Step cancelled')
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to cancel the step',
      parsedException.why,
    )
  } finally {
    isSaving.value = false
  }
}

onMounted(() => {
  timeZone.value = Intl.DateTimeFormat().resolvedOptions().timeZone
})
</script>

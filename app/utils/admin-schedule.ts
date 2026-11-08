import type { FeatureRulePatch } from '#shared/utils/features/admin-schemas'
import type {
  FeatureScheduleStepInput,
  FeatureScheduleStepView,
} from '#shared/utils/features/schedule-schemas'
import { scheduleChangeNeedsRolloutGate } from '#shared/utils/features/schedule-schemas'

export interface AdminRolloutGateView {
  open: boolean
  reason: string
  override: string
  noticeId: string
  effectiveAt: string | null
  effectiveAtMs: number | null
  description: string
}

export interface DraftScheduleStep {
  key: number
  runAtLocal: string
  enabled: 'keep' | 'on' | 'off'
  grantTesters: boolean
  changeRollout: boolean
  rolloutPercent: number
}

export type ScheduleStatusTone = 'info' | 'warning' | 'success' | 'error'
  | 'neutral'

const MILLISECONDS_PER_DAY = 86_400_000
const STAGED_PLAN_ROLLOUT_PERCENTS = [25, 100]
const STAGED_PLAN_HOUR = 10

export function createDraftStep(key: number): DraftScheduleStep {
  return {
    key,
    runAtLocal: '',
    enabled: 'keep',
    grantTesters: false,
    changeRollout: false,
    rolloutPercent: 10,
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function toLocalInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
    + `-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function parseLocalInputValue(value: string): Date | null {
  if (!value) {
    return null
  }

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

export function draftStepToInput(
  step: DraftScheduleStep,
): FeatureScheduleStepInput | null {
  const runAt = parseLocalInputValue(step.runAtLocal)

  if (!runAt) {
    return null
  }

  const input: FeatureScheduleStepInput = { runAt: runAt.toISOString() }

  if (step.enabled !== 'keep') {
    input.enabled = step.enabled === 'on'
  }

  if (step.grantTesters) {
    input.grantRoles = ['tester']
  }

  if (step.changeRollout) {
    input.rolloutBps = Math.round(Number(step.rolloutPercent) * 100)
  }

  return input
}

export function draftStepHasChange(step: DraftScheduleStep): boolean {
  return step.enabled !== 'keep' || step.grantTesters || step.changeRollout
}

export function draftStepWaitsForGate(
  step: DraftScheduleStep,
  gate: AdminRolloutGateView | undefined,
): boolean {
  const runAt = parseLocalInputValue(step.runAtLocal)

  if (!gate || gate.open || !step.changeRollout || step.rolloutPercent <= 0) {
    return false
  }

  if (gate.effectiveAtMs === null || gate.reason === 'override_off') {
    return true
  }

  return runAt === null || runAt.getTime() < gate.effectiveAtMs
}

export function describeScheduleChange(change: FeatureRulePatch): string[] {
  const labels: string[] = []

  if (change.enabled !== undefined) {
    labels.push(change.enabled ? 'Turn on' : 'Turn off')
  }

  if (change.allowRoles) {
    labels.push(
      change.allowRoles.includes('tester')
        ? 'All testers get it'
        : 'Testers lose it',
    )
  }

  if (change.rolloutBps !== undefined) {
    labels.push(`Rollout ${Number((change.rolloutBps / 100).toFixed(2))}%`)
  }

  if (change.variants) {
    labels.push(`${change.variants.length} variant weights`)
  }

  return labels
}

export function describeScheduleGateHint(
  schedule: FeatureScheduleStepView,
  gate: AdminRolloutGateView | undefined,
): string | null {
  if (
    !gate
    || gate.open
    || (schedule.status !== 'pending' && schedule.status !== 'blocked')
    || !scheduleChangeNeedsRolloutGate(schedule.change)
  ) {
    return null
  }

  if (gate.reason === 'override_off' || !gate.effectiveAt) {
    return 'Waits: gradual rollouts are switched off by the environment.'
  }

  return `Applies after ${gate.effectiveAt}, when the Privacy notice takes `
    + 'effect.'
}

export function scheduleStatusTone(
  status: FeatureScheduleStepView['status'],
): ScheduleStatusTone {
  switch (status) {
    case 'applied':
      return 'success'
    case 'failed':
      return 'error'
    case 'blocked':
      return 'warning'
    case 'cancelled':
      return 'neutral'
    default:
      return 'info'
  }
}

/**
 * Rows for the "Staged plan" helper: testers first, then a 25% rollout and
 * 100%, a week apart, starting on the notice date at 10:00 local time (or
 * tomorrow when the gate is already open). It only fills the form: the owner
 * edits or removes any row before saving.
 */
export function buildStagedPlanRows(
  now: Date,
  gate: AdminRolloutGateView | undefined,
  firstKey: number,
): DraftScheduleStep[] {
  const earliest = new Date(now.getTime() + MILLISECONDS_PER_DAY)
  const gateStart = gate?.effectiveAtMs ? new Date(gate.effectiveAtMs) : null
  const start = new Date(
    gateStart && gateStart.getTime() > earliest.getTime()
      ? gateStart
      : earliest,
  )

  start.setHours(STAGED_PLAN_HOUR, 0, 0, 0)

  if (start.getTime() <= now.getTime()) {
    start.setDate(start.getDate() + 1)
  }

  const rows: DraftScheduleStep[] = [
    {
      ...createDraftStep(firstKey),
      runAtLocal: toLocalInputValue(start),
      grantTesters: true,
    },
  ]

  STAGED_PLAN_ROLLOUT_PERCENTS.forEach((percent, index) => {
    const date = new Date(start)

    date.setDate(date.getDate() + 7 * (index + 1))
    rows.push({
      ...createDraftStep(firstKey + index + 1),
      runAtLocal: toLocalInputValue(date),
      changeRollout: true,
      rolloutPercent: percent,
    })
  })

  return rows
}

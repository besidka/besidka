import { z } from 'zod'
import type { FeatureRulePatch } from '#shared/utils/features/admin-schemas'
import {
  ASSIGNABLE_FEATURE_ROLES,
  FEATURE_BASIS_POINTS_TOTAL,
  featureRulePatchSchema,
} from '#shared/utils/features/admin-schemas'

export const FEATURE_SCHEDULE_MAX_STEPS = 12
export const FEATURE_SCHEDULE_MAX_OPEN_PER_FLAG = 24
export const FEATURE_SCHEDULE_STALE_CLAIM_MS = 10 * 60 * 1000
export const FEATURE_SCHEDULE_ALWAYS_ALLOWED_ROLES = ['admin'] as const

export const FEATURE_SCHEDULE_OPEN_STATUSES = ['pending', 'blocked'] as const

const basisPoints = z.number().int().min(0).max(FEATURE_BASIS_POINTS_TOTAL)

export const featureScheduleStepSchema = z.object({
  runAt: z.iso.datetime({ offset: true }),
  enabled: z.boolean().optional(),
  rolloutBps: basisPoints.optional(),
  grantRoles: z
    .array(z.enum(ASSIGNABLE_FEATURE_ROLES))
    .max(ASSIGNABLE_FEATURE_ROLES.length)
    .optional(),
  variants: z
    .array(z.object({
      key: z.string().trim().min(1).max(64),
      weightBps: basisPoints,
    }))
    .max(20)
    .nullable()
    .optional(),
}).strict()

export type FeatureScheduleStepInput = z.infer<
  typeof featureScheduleStepSchema
>

export const featureScheduleCreateSchema = z.object({
  steps: z
    .array(featureScheduleStepSchema)
    .min(1)
    .max(FEATURE_SCHEDULE_MAX_STEPS),
}).strict()

export type FeatureScheduleCreateInput = z.infer<
  typeof featureScheduleCreateSchema
>

export interface FeatureScheduleStepView {
  id: number
  flag: string
  change: FeatureRulePatch
  runAt: number
  status: 'pending' | 'blocked' | 'applying' | 'applied' | 'failed'
    | 'cancelled'
  requiresNoticeId: string | null
  appliedAt: number | null
  error: string | null
}

export function scheduleChangeNeedsRolloutGate(
  change: Pick<FeatureRulePatch, 'rolloutBps' | 'variants'>,
): boolean {
  return (change.rolloutBps ?? 0) > 0 || (change.variants?.length ?? 0) > 0
}

export function hasScheduleChange(change: FeatureRulePatch): boolean {
  return Object.values(change).some((value) => {
    return value !== undefined
  })
}

/**
 * Turns a step into the rule patch the applier hands to `setFeatureRule`.
 * Granting a role keeps admins in the allowed list, because a rule's
 * `allowRoles` replaces the registry default rather than adding to it.
 */
export function toScheduleRulePatch(
  step: Omit<FeatureScheduleStepInput, 'runAt'>,
): FeatureRulePatch {
  const patch: FeatureRulePatch = {}

  if (step.enabled !== undefined) {
    patch.enabled = step.enabled
  }

  if (step.rolloutBps !== undefined) {
    patch.rolloutBps = step.rolloutBps
  }

  if (step.grantRoles !== undefined) {
    patch.allowRoles = [
      ...new Set([
        ...FEATURE_SCHEDULE_ALWAYS_ALLOWED_ROLES,
        ...step.grantRoles,
      ]),
    ]
  }

  if (step.variants !== undefined) {
    patch.variants = step.variants
  }

  return featureRulePatchSchema.parse(patch)
}

export type FeatureScheduleIssueCode
  = | 'empty_step'
    | 'past'
    | 'not_increasing'
    | 'duplicate_time'

export interface FeatureScheduleIssue {
  index: number
  code: FeatureScheduleIssueCode
  message: string
}

/**
 * Checks a batch of steps in the order given: every step changes something,
 * runs in the future, comes strictly after the step before it and shares no
 * minute-precise timestamp with an open step of the same flag. A rollout step
 * dated before the notice gate is valid: it waits and is flagged in the UI.
 */
export function validateScheduleSteps(
  steps: readonly FeatureScheduleStepInput[],
  options: { now: Date, existingRunAtMs: readonly number[] },
): FeatureScheduleIssue[] {
  const issues: FeatureScheduleIssue[] = []
  const takenSeconds = new Set(options.existingRunAtMs.map(toEpochSeconds))
  let previousSeconds: number | null = null

  steps.forEach((step, index) => {
    const seconds = toEpochSeconds(Date.parse(step.runAt))

    if (!hasScheduleChange(toScheduleRulePatch(step))) {
      issues.push({
        index,
        code: 'empty_step',
        message: 'Choose something to change in this step.',
      })
    }

    if (seconds * 1000 <= options.now.getTime()) {
      issues.push({
        index,
        code: 'past',
        message: 'Pick a date and time in the future.',
      })
    }

    if (takenSeconds.has(seconds)) {
      issues.push({
        index,
        code: 'duplicate_time',
        message: 'Another step already runs at this time.',
      })
    } else if (previousSeconds !== null && seconds <= previousSeconds) {
      issues.push({
        index,
        code: 'not_increasing',
        message: 'Steps must run in increasing order.',
      })
    }

    takenSeconds.add(seconds)
    previousSeconds = seconds
  })

  return issues
}

function toEpochSeconds(milliseconds: number): number {
  return Math.floor(milliseconds / 1000)
}

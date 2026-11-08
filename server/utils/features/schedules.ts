import {
  and, asc, eq, inArray, lt, lte, notExists, or,
} from 'drizzle-orm'
import { createRequestLogger } from 'evlog'
import type {
  FeatureScheduleCreateInput,
  FeatureScheduleStepView,
} from '#shared/utils/features/schedule-schemas'
import type { FeatureRulePatch } from '#shared/utils/features/admin-schemas'
import type { FeatureAdminContext } from '~~/server/utils/features/admin'
import type { shipWideEventToAxiom } from '~~/server/utils/evlog-drains'
import {
  FEATURE_SCHEDULE_MAX_OPEN_PER_FLAG,
  FEATURE_SCHEDULE_OPEN_STATUSES,
  FEATURE_SCHEDULE_STALE_CLAIM_MS,
  scheduleChangeNeedsRolloutGate,
  toScheduleRulePatch,
  validateScheduleSteps,
} from '#shared/utils/features/schedule-schemas'
import { featureRulePatchSchema } from '#shared/utils/features/admin-schemas'
import {
  computeFeatureRolloutGate,
  FEATURES_ROLLOUT_NOTICE_ID,
} from '#shared/utils/features/rollout-gate'
import * as schema from '~~/server/db/schema'
import {
  buildAuditInsert,
  logFeatureAccess,
  requireKnownFlag,
  setFeatureRule,
  throwAdminError,
} from '~~/server/utils/features/admin'
import { emitScheduledJobEvent } from '~~/server/utils/scheduled-job-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

export const FEATURE_SCHEDULE_APPLY_BATCH_SIZE = 20
const STALE_CLAIM_ERROR = 'The change may or may not have been written: '
  + 'check the rule and the audit log before scheduling it again.'
const ERROR_MAX_LENGTH = 500
const ROLLOUT_DISABLED_WHY = 'rollout_disabled'

type ScheduleDatabase = FeatureAdminContext['db']

type ScheduleRow = typeof schema.featureRuleSchedules.$inferSelect

export type FeatureScheduleOutcome = 'applied' | 'failed'

export interface FeatureScheduleNotification {
  outcome: FeatureScheduleOutcome
  schedule: FeatureScheduleStepView
  appliedAt: Date
}

export interface ApplyDueFeatureSchedulesInput {
  db: ScheduleDatabase
  kv: FeatureAdminContext['kv']
  now: Date
  rolloutOverride: unknown
  notify?: (notification: FeatureScheduleNotification) => Promise<void>
  createLogger?: typeof createRequestLogger
  shipWideEvent?: typeof shipWideEventToAxiom
}

export interface ApplyDueFeatureSchedulesResult {
  applied: number
  failed: number
  blocked: number
  skipped: number
  staleClaims: number
}

function toUnixSeconds(date: Date | null): number | null {
  return date ? Math.floor(date.getTime() / 1000) : null
}

function truncateError(message: string): string {
  return message.slice(0, ERROR_MAX_LENGTH)
}

function toPatch(row: ScheduleRow): FeatureRulePatch | null {
  const parsed = featureRulePatchSchema.safeParse(row.change)

  return parsed.success ? parsed.data : null
}

export function toScheduleView(row: ScheduleRow): FeatureScheduleStepView {
  return {
    id: row.id,
    flag: row.flag,
    change: toPatch(row) ?? {},
    runAt: Math.floor(row.runAt.getTime() / 1000),
    status: row.status,
    requiresNoticeId: row.requiresNoticeId,
    appliedAt: toUnixSeconds(row.appliedAt),
    error: row.error,
  }
}

export async function listFeatureSchedules(
  db: Pick<ScheduleDatabase, 'select'>,
  flag: string,
): Promise<FeatureScheduleStepView[]> {
  const rows = await db
    .select()
    .from(schema.featureRuleSchedules)
    .where(eq(schema.featureRuleSchedules.flag, flag))
    .orderBy(
      asc(schema.featureRuleSchedules.runAt),
      asc(schema.featureRuleSchedules.id),
    )

  return rows.map(toScheduleView)
}

/**
 * Stores a batch of scheduled steps for a flag, with one audit row for the
 * batch. Steps must change something, run in the future, in increasing
 * order and not at the time of another open step. A step that raises the
 * rollout or sets variants records the Privacy notice it waits for; before
 * that notice is in force it stays blocked, never refused.
 */
export async function createFeatureSchedules(
  context: FeatureAdminContext,
  flag: string,
  input: FeatureScheduleCreateInput,
) {
  requireKnownFlag(flag)

  const now = context.now ?? new Date()
  const open = await context.db
    .select({ runAt: schema.featureRuleSchedules.runAt })
    .from(schema.featureRuleSchedules)
    .where(and(
      eq(schema.featureRuleSchedules.flag, flag),
      inArray(
        schema.featureRuleSchedules.status,
        [...FEATURE_SCHEDULE_OPEN_STATUSES],
      ),
    ))

  if (open.length + input.steps.length > FEATURE_SCHEDULE_MAX_OPEN_PER_FLAG) {
    throwAdminError(
      409,
      'Too many scheduled steps',
      'schedule_limit',
      'Cancel steps you no longer need first',
    )
  }

  const issues = validateScheduleSteps(input.steps, {
    now,
    existingRunAtMs: open.map((row) => {
      return row.runAt.getTime()
    }),
  })

  if (issues.length) {
    throwAdminError(
      400,
      'Invalid schedule',
      issues.map((issue) => {
        return `step ${issue.index + 1}: ${issue.code}`
      }).join(', '),
      issues[0]!.message,
    )
  }

  const steps = input.steps.map((step) => {
    const { runAt, ...change } = step
    const patch = toScheduleRulePatch(change)

    return {
      runAt: new Date(Math.floor(Date.parse(runAt) / 1000) * 1000),
      patch,
      requiresNoticeId: scheduleChangeNeedsRolloutGate(patch)
        ? FEATURES_ROLLOUT_NOTICE_ID
        : null,
    }
  })
  const inserts = steps.map((step) => {
    return context.db
      .insert(schema.featureRuleSchedules)
      .values({
        flag,
        change: step.patch,
        runAt: step.runAt,
        requiresNoticeId: step.requiresNoticeId,
        createdBy: context.actor.userId,
        createdAt: now,
      })
      .returning({ id: schema.featureRuleSchedules.id })
  })
  const results = await context.db.batch([
    ...inserts,
    buildAuditInsert(context, {
      action: 'schedule.create',
      flag,
      targetUserId: null,
      before: null,
      after: {
        steps: steps.map((step) => {
          return {
            runAt: Math.floor(step.runAt.getTime() / 1000),
            ...step.patch,
          }
        }),
      },
    }),
  ] as unknown as Parameters<typeof context.db.batch>[0])
  const ids = (results as unknown as { id: number }[][])
    .slice(0, steps.length)
    .map((rows) => {
      return rows[0]!.id
    })

  logFeatureAccess(context, {
    action: 'schedule.create',
    flag,
    targetUserId: null,
    effect: null,
    expiresAt: null,
    scheduleRunAt: steps.map((step) => {
      return step.runAt.toISOString()
    }),
  })

  return { flag, ids }
}

/**
 * Cancels one open step. A step the applier already claimed or finished is
 * refused, so a cancel never races a write that is in flight.
 */
export async function cancelFeatureSchedule(
  context: FeatureAdminContext,
  flag: string,
  scheduleId: number,
) {
  requireKnownFlag(flag)

  const [cancelled] = await context.db
    .update(schema.featureRuleSchedules)
    .set({ status: 'cancelled', error: null })
    .where(and(
      eq(schema.featureRuleSchedules.id, scheduleId),
      eq(schema.featureRuleSchedules.flag, flag),
      inArray(
        schema.featureRuleSchedules.status,
        [...FEATURE_SCHEDULE_OPEN_STATUSES],
      ),
    ))
    .returning()

  if (!cancelled) {
    throwAdminError(
      409,
      'This step can no longer be cancelled',
      'schedule_not_open',
      'Only steps that have not started can be cancelled',
    )
  }

  await context.db.batch([
    buildAuditInsert(context, {
      action: 'schedule.cancel',
      flag,
      targetUserId: null,
      before: {
        runAt: Math.floor(cancelled.runAt.getTime() / 1000),
        ...cancelled.change,
      },
      after: null,
    }),
  ])
  logFeatureAccess(context, {
    action: 'schedule.cancel',
    flag,
    targetUserId: null,
    effect: null,
    expiresAt: null,
    scheduleRunAt: [cancelled.runAt.toISOString()],
  })

  return { id: scheduleId, flag }
}

async function markStaleClaimsFailed(
  db: ScheduleDatabase,
  now: Date,
): Promise<ScheduleRow[]> {
  return await db
    .update(schema.featureRuleSchedules)
    .set({ status: 'failed', error: STALE_CLAIM_ERROR })
    .where(and(
      eq(schema.featureRuleSchedules.status, 'applying'),
      lt(
        schema.featureRuleSchedules.claimedAt,
        new Date(now.getTime() - FEATURE_SCHEDULE_STALE_CLAIM_MS),
      ),
    ))
    .returning()
}

async function claimSchedule(
  db: ScheduleDatabase,
  row: ScheduleRow,
  now: Date,
): Promise<ScheduleRow | null> {
  const [claimed] = await db
    .update(schema.featureRuleSchedules)
    .set({ status: 'applying', claimedAt: now, error: null })
    .where(and(
      eq(schema.featureRuleSchedules.id, row.id),
      inArray(
        schema.featureRuleSchedules.status,
        [...FEATURE_SCHEDULE_OPEN_STATUSES],
      ),
      notExists(
        db
          .select({ id: schema.featureRuleSchedules.id })
          .from(schema.featureRuleSchedules)
          .where(and(
            eq(schema.featureRuleSchedules.flag, row.flag),
            eq(schema.featureRuleSchedules.status, 'applying'),
          )),
      ),
    ))
    .returning()

  return claimed ?? null
}

async function finishSchedule(
  db: ScheduleDatabase,
  scheduleId: number,
  values: Partial<typeof schema.featureRuleSchedules.$inferInsert>,
): Promise<ScheduleRow | null> {
  const [row] = await db
    .update(schema.featureRuleSchedules)
    .set(values)
    .where(eq(schema.featureRuleSchedules.id, scheduleId))
    .returning()

  return row ?? null
}

function describeBlockedReason(gate: ReturnType<
  typeof computeFeatureRolloutGate
>): string {
  if (gate.reason === 'override_off') {
    return 'Waiting: NUXT_FEATURES_ROLLOUT_ENABLED forces rollouts off.'
  }

  return gate.effectiveAt
    ? `Waiting for the Privacy notice ${gate.noticeId} to take effect on `
    + `${gate.effectiveAt}.`
    : `Waiting: the notice ${gate.noticeId} is not in the registry.`
}

function isRolloutDisabledError(exception: unknown): boolean {
  return (exception as { why?: unknown } | null)?.why === ROLLOUT_DISABLED_WHY
}

function describeFailure(exception: unknown): string {
  const why = (exception as { why?: unknown } | null)?.why
  const message = exceptionMessage(exception)

  return truncateError(
    typeof why === 'string' && why ? `${message} (${why})` : message,
  )
}

/**
 * Applies every open step whose time has come, oldest first, one at a time,
 * through `setFeatureRule`: the same validation, audit row, Axiom ledger line
 * and KV cache bust as a manual edit. A step is claimed with a conditional
 * update first, so two overlapping runs can never apply it twice, and the
 * claim is refused while another step of the same flag is being applied, so
 * steps of one flag never run out of order or race on the rule row. A rollout
 * step that comes due before the notice gate opens becomes `blocked` and is
 * picked up again on every run once the gate is open. A failed step is
 * terminal: it is marked `failed` and reported, never retried. A claim older
 * than ten minutes means the Worker died mid-write and is marked `failed`
 * with a note, not re-run. Uses no request context, so it also runs from cron.
 */
export async function applyDueFeatureSchedules(
  input: ApplyDueFeatureSchedulesInput,
): Promise<ApplyDueFeatureSchedulesResult> {
  const createLogger = input.createLogger || createRequestLogger
  const result: ApplyDueFeatureSchedulesResult = {
    applied: 0,
    failed: 0,
    blocked: 0,
    skipped: 0,
    staleClaims: 0,
  }
  const gate = computeFeatureRolloutGate(input.rolloutOverride, input.now)

  async function deliver(
    notification: FeatureScheduleNotification,
    logger?: { set: (data: Record<string, unknown>) => void },
  ) {
    try {
      await input.notify?.(notification)
    } catch (exception) {
      logger?.set({
        attributes: {
          featureScheduleNotify: { error: exceptionMessage(exception) },
        },
      })
    }
  }

  const staleRows = await markStaleClaimsFailed(input.db, input.now)

  result.staleClaims = staleRows.length
  result.failed += staleRows.length

  for (const stale of staleRows) {
    await deliver({
      outcome: 'failed',
      schedule: toScheduleView(stale),
      appliedAt: input.now,
    })
  }

  const due = await input.db
    .select()
    .from(schema.featureRuleSchedules)
    .where(and(
      or(
        eq(schema.featureRuleSchedules.status, 'pending'),
        eq(schema.featureRuleSchedules.status, 'blocked'),
      ),
      lte(schema.featureRuleSchedules.runAt, input.now),
    ))
    .orderBy(
      asc(schema.featureRuleSchedules.runAt),
      asc(schema.featureRuleSchedules.id),
    )
    .limit(FEATURE_SCHEDULE_APPLY_BATCH_SIZE)

  for (const row of due) {
    const patch = toPatch(row)

    if (patch && scheduleChangeNeedsRolloutGate(patch) && !gate.open) {
      if (row.status !== 'blocked') {
        await finishSchedule(input.db, row.id, {
          status: 'blocked',
          error: describeBlockedReason(gate),
        })
      }

      result.blocked += 1

      continue
    }

    const claimed = await claimSchedule(input.db, row, input.now)

    if (!claimed) {
      result.skipped += 1

      continue
    }

    const logger = createLogger({
      method: 'CRON',
      path: '/internal/jobs/feature-schedule-apply',
      requestId: `feature-schedule-${claimed.id}-${input.now.getTime()}`,
    })
    let status = 200

    logger.set({
      attributes: {
        featureSchedule: {
          scheduleId: claimed.id,
          flag: claimed.flag,
          runAt: claimed.runAt.toISOString(),
          scheduledTime: input.now.toISOString(),
        },
      },
    })

    try {
      if (!patch) {
        throwAdminError(400, 'The stored change is invalid', 'change_invalid')
      }

      await setFeatureRule(
        {
          db: input.db,
          kv: input.kv,
          actor: {
            userId: null,
            kind: 'schedule',
            scheduleId: claimed.id,
          },
          rolloutEnabled: gate.open,
          logger,
          now: input.now,
        },
        claimed.flag,
        patch,
      )

      const applied = await finishSchedule(input.db, claimed.id, {
        status: 'applied',
        appliedAt: input.now,
        error: null,
      })

      result.applied += 1
      logger.set({ attributes: { featureSchedule: { outcome: 'applied' } } })

      if (applied) {
        await deliver({
          outcome: 'applied',
          schedule: toScheduleView(applied),
          appliedAt: input.now,
        }, logger)
      }
    } catch (exception) {
      if (isRolloutDisabledError(exception)) {
        await finishSchedule(input.db, claimed.id, {
          status: 'blocked',
          error: describeBlockedReason(gate),
        })
        result.blocked += 1
        logger.set({ attributes: { featureSchedule: { outcome: 'blocked' } } })
      } else {
        status = 500

        const failed = await finishSchedule(input.db, claimed.id, {
          status: 'failed',
          error: describeFailure(exception),
        })

        result.failed += 1
        logger.set({
          attributes: {
            featureSchedule: {
              outcome: 'failed',
              error: describeFailure(exception),
            },
          },
        })

        if (failed) {
          await deliver({
            outcome: 'failed',
            schedule: toScheduleView(failed),
            appliedAt: input.now,
          }, logger)
        }
      }
    }

    await emitScheduledJobEvent(logger, status, input.shipWideEvent)
  }

  return result
}

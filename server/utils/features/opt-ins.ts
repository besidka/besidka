import type { FeatureOptInState } from '~~/server/utils/features/provider'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { and, eq } from 'drizzle-orm'
import { EXPERIMENTS_OPT_IN_KEY } from '#shared/utils/features/registry'
import * as schema from '~~/server/db/schema'

const MILLISECONDS_PER_SECOND = 1000

type FeatureOptInDatabase = Pick<
  ReturnType<typeof useDb>,
  'batch' | 'select' | 'insert'
>

export interface FeatureOptInWriteContext {
  db: FeatureOptInDatabase
  userId: number
  logger: LoggerLike
  now?: Date
}

type FeatureOptInAction = 'opt_in.set' | 'experiments.set'

function toUnixSeconds(date: Date | null | undefined): number | null {
  return date ? Math.floor(date.getTime() / MILLISECONDS_PER_SECOND) : null
}

function toSnapshot(row: FeatureOptInState | undefined) {
  if (!row) {
    return null
  }

  return {
    optedInAt: toUnixSeconds(row.optedInAt),
    optedOutAt: toUnixSeconds(row.optedOutAt),
  }
}

async function readOptInRow(
  context: FeatureOptInWriteContext,
  flag: string,
): Promise<FeatureOptInState | undefined> {
  const [row] = await context.db
    .select({
      optedInAt: schema.featureOptIns.optedInAt,
      optedOutAt: schema.featureOptIns.optedOutAt,
    })
    .from(schema.featureOptIns)
    .where(and(
      eq(schema.featureOptIns.userId, context.userId),
      eq(schema.featureOptIns.flag, flag),
    ))
    .limit(1)

  return row
}

function toWholeSecond(date: Date): number {
  return Math.floor(date.getTime() / MILLISECONDS_PER_SECOND)
    * MILLISECONDS_PER_SECOND
}

/**
 * D1 keeps whole seconds and an equal pair of timestamps reads as "off", so
 * switching on within the same second as the last switch-off stamps one
 * second later, and switching off never stamps earlier than the last
 * switch-on.
 */
function resolveStamp(
  existing: FeatureOptInState | undefined,
  switchedOn: boolean,
  now: Date,
): Partial<FeatureOptInState> {
  const nowSecond = toWholeSecond(now)

  if (switchedOn) {
    const lastOff = existing?.optedOutAt
      ? toWholeSecond(existing.optedOutAt)
      : null
    const onSecond = lastOff !== null && lastOff >= nowSecond
      ? lastOff + MILLISECONDS_PER_SECOND
      : nowSecond

    return { optedInAt: new Date(onSecond) }
  }

  const lastOn = existing?.optedInAt ? toWholeSecond(existing.optedInAt) : null

  return { optedOutAt: new Date(Math.max(nowSecond, lastOn ?? nowSecond)) }
}

/**
 * Stamps `optedInAt` (switched on) or `optedOutAt` (switched off) on the
 * user's row for `flag`, keeping the other timestamp as evidence, and writes
 * the audit row in the same D1 batch. Whichever timestamp is newer decides.
 */
async function writeOptInTimestamp(
  context: FeatureOptInWriteContext,
  input: { flag: string, switchedOn: boolean, action: FeatureOptInAction },
): Promise<void> {
  const now = context.now ?? new Date()
  const existing = await readOptInRow(context, input.flag)
  const stamp = resolveStamp(existing, input.switchedOn, now)
  const next: FeatureOptInState = {
    optedInAt: existing?.optedInAt ?? null,
    optedOutAt: existing?.optedOutAt ?? null,
    ...stamp,
  }

  await context.db.batch([
    context.db
      .insert(schema.featureOptIns)
      .values({ userId: context.userId, flag: input.flag, ...next })
      .onConflictDoUpdate({
        target: [schema.featureOptIns.userId, schema.featureOptIns.flag],
        set: stamp,
      }),
    context.db.insert(schema.featureAuditLog).values({
      actorUserId: context.userId,
      actorKind: 'ui',
      clientId: null,
      action: input.action,
      flag: input.flag,
      targetUserId: context.userId,
      before: toSnapshot(existing),
      after: toSnapshot(next),
      createdAt: now,
    }),
  ])
}

/**
 * The Labs toggle writer: an opt-in for a feature that needs one, an opt-out
 * (`optedIn: false`) for any other. The caller has already checked that the
 * user has access to `flag`. Logs the C8 replay-ledger
 * line, so a D1 restore can never silently revive a withdrawn opt-in.
 */
export async function setFeatureOptIn(
  context: FeatureOptInWriteContext,
  flag: string,
  optedIn: boolean,
): Promise<void> {
  await writeOptInTimestamp(context, {
    flag,
    switchedOn: optedIn,
    action: 'opt_in.set',
  })

  context.logger.set({
    attributes: {
      featureAccess: { action: 'opt_in.set', flag, optedIn },
    },
  })
}

/**
 * The GDPR Art. 21 objection switch (pre-check C3). Objecting stamps
 * `optedOutAt` on the reserved `experiments` row; withdrawing the objection
 * stamps `optedInAt`. `hasObjectedToExperiments` reads the newer one.
 */
export async function setExperimentsObjection(
  context: FeatureOptInWriteContext,
  objected: boolean,
): Promise<void> {
  await writeOptInTimestamp(context, {
    flag: EXPERIMENTS_OPT_IN_KEY,
    switchedOn: !objected,
    action: 'experiments.set',
  })

  context.logger.set({
    attributes: {
      featureAccess: { action: 'experiments.set', objected },
    },
  })
}

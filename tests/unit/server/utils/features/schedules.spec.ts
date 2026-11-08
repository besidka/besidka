import { readdirSync, readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FeatureAdminContext } from '~~/server/utils/features/admin'
import { FEATURES_ROLLOUT_NOTICE_ID } from '#shared/utils/features/rollout-gate'
import {
  applyDueFeatureSchedules,
  cancelFeatureSchedule,
  createFeatureSchedules,
  listFeatureSchedules,
} from '~~/server/utils/features/schedules'

const migrationsDirectory = new URL(
  '../../../../../.drizzle/migrations/',
  import.meta.url,
)

function readMigration(suffix: string): string {
  const directory = readdirSync(migrationsDirectory).find((name) => {
    return name.endsWith(suffix)
  })

  return readFileSync(
    new URL(`${directory}/migration.sql`, migrationsDirectory),
    'utf8',
  )
}

const createdAt = 1_762_560_000
const afterNotice = new Date('2026-12-20T09:00:00Z')
const beforeNotice = new Date('2026-11-20T09:00:00Z')

function secondsOf(value: string): number {
  return Math.floor(Date.parse(value) / 1000)
}

describe('feature schedules', () => {
  let sqlite: InstanceType<typeof Database>
  let db: ReturnType<typeof drizzle>
  let kv: Record<'get' | 'put' | 'delete', ReturnType<typeof vi.fn>>
  let events: { status: number, data: Record<string, any> }[]
  let notify: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sqlite = new Database(':memory:')

    for (const suffix of [
      '_feature_access_tables',
      '_feature_rule_schedules',
    ]) {
      for (const statement of readMigration(suffix).split(
        '--> statement-breakpoint',
      )) {
        sqlite.exec(statement)
      }
    }

    const base = drizzle({ client: sqlite })

    db = Object.assign(base, {
      batch: async (queries: PromiseLike<unknown>[]) => {
        const results: unknown[] = []

        for (const query of queries) {
          results.push(await query)
        }

        return results
      },
    }) as never
    kv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() }
    events = []
    notify = vi.fn(async () => {})
  })

  afterEach(() => {
    sqlite.close()
  })

  function createLogger() {
    const data: Record<string, any> = {}

    return {
      set(value: Record<string, any>) {
        Object.assign(data, value, {
          attributes: { ...data.attributes, ...value.attributes },
        })
      },
      emit({ status }: { status: number }) {
        events.push({ status, data })

        return { status }
      },
    } as never
  }

  function run(now: Date, rolloutOverride: unknown = '') {
    return applyDueFeatureSchedules({
      db: db as never,
      kv,
      now,
      rolloutOverride,
      notify,
      createLogger,
      shipWideEvent: vi.fn(async () => {}),
    })
  }

  function seedStep(
    runAt: string,
    change: Record<string, unknown>,
    overrides: { flag?: string, status?: string, claimedAt?: number } = {},
  ) {
    sqlite.prepare(`
      insert into feature_rule_schedules
        (flag, change, run_at, status, requires_notice_id, claimed_at,
          created_by, created_at)
        values (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      overrides.flag ?? 'artifacts',
      JSON.stringify(change),
      secondsOf(runAt),
      overrides.status ?? 'pending',
      change.rolloutBps ? FEATURES_ROLLOUT_NOTICE_ID : null,
      overrides.claimedAt ?? null,
      createdAt,
    )
  }

  function statuses(): string[] {
    return (sqlite.prepare(
      'select status from feature_rule_schedules order by id',
    ).all() as { status: string }[]).map((row) => {
      return row.status
    })
  }

  function auditRows() {
    return sqlite.prepare(
      'select actor_user_id as actor, actor_kind as kind, action, flag '
      + 'from feature_audit_log order by id',
    ).all()
  }

  it('applies a due step through the rule writer', async () => {
    seedStep('2026-12-20T08:55:00Z', { allowRoles: ['admin', 'tester'] })

    const result = await run(afterNotice)

    expect(result).toMatchObject({ applied: 1, failed: 0, blocked: 0 })
    expect(statuses()).toEqual(['applied'])
    expect(sqlite.prepare(
      'select allow_roles as allowRoles, updated_by as updatedBy '
      + 'from feature_flag_rules where flag = ?',
    ).get('artifacts')).toEqual({
      allowRoles: '["admin","tester"]',
      updatedBy: null,
    })
    expect(auditRows()).toEqual([
      { actor: null, kind: 'schedule', action: 'rule.set', flag: 'artifacts' },
    ])
    expect(kv.delete).toHaveBeenCalledWith('features:config:v1')
    expect(events).toHaveLength(1)
    expect(events[0]!.status).toBe(200)
    expect(events[0]!.data.attributes.featureAccess).toMatchObject({
      action: 'rule.set',
      actorKind: 'schedule',
      scheduleId: 1,
    })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'applied',
    }))
  })

  it('leaves a step in the future alone', async () => {
    seedStep('2026-12-21T10:00:00Z', { enabled: false })

    const result = await run(afterNotice)

    expect(result).toMatchObject({ applied: 0 })
    expect(statuses()).toEqual(['pending'])
    expect(auditRows()).toEqual([])
  })

  it('applies a staged plan in order and never a cancelled step', async () => {
    seedStep('2026-12-20T08:00:00Z', { allowRoles: ['admin', 'tester'] })
    seedStep('2026-12-20T08:30:00Z', { rolloutBps: 2500 })
    seedStep('2026-12-20T08:45:00Z', { rolloutBps: 10000 }, {
      status: 'cancelled',
    })
    seedStep('2026-12-20T08:50:00Z', { rolloutBps: 5000 })

    const result = await run(afterNotice)

    expect(result.applied).toBe(3)
    expect(statuses()).toEqual(['applied', 'applied', 'cancelled', 'applied'])
    expect(sqlite.prepare(
      'select rollout_bps as bps from feature_flag_rules',
    ).get()).toEqual({ bps: 5000 })
    expect(sqlite.prepare(
      'select json_extract(after, \'$.rolloutBps\') as bps '
      + 'from feature_audit_log order by id',
    ).all()).toEqual([{ bps: 0 }, { bps: 2500 }, { bps: 5000 }])
  })

  it('blocks a rollout step before the notice and applies it after', async () => {
    seedStep('2026-11-20T08:00:00Z', { rolloutBps: 1000 })

    const first = await run(beforeNotice)

    expect(first).toMatchObject({ applied: 0, blocked: 1 })
    expect(statuses()).toEqual(['blocked'])
    expect(sqlite.prepare(
      'select error from feature_rule_schedules',
    ).get()).toEqual({
      error: expect.stringContaining('2026-12-19'),
    })
    expect(auditRows()).toEqual([])
    expect(notify).not.toHaveBeenCalled()

    const second = await run(afterNotice)

    expect(second).toMatchObject({ applied: 1, blocked: 0 })
    expect(statuses()).toEqual(['applied'])
    expect(sqlite.prepare(
      'select error from feature_rule_schedules',
    ).get()).toEqual({ error: null })
  })

  it('does not block a step that does not raise the rollout', async () => {
    seedStep('2026-11-20T08:00:00Z', { allowRoles: ['admin', 'tester'] })
    seedStep('2026-11-20T08:10:00Z', { rolloutBps: 0 })

    const result = await run(beforeNotice)

    expect(result).toMatchObject({ applied: 2, blocked: 0 })
  })

  it('keeps rollouts blocked while the environment forces them off', async () => {
    seedStep('2026-12-20T08:00:00Z', { rolloutBps: 1000 })

    const result = await run(afterNotice, 'off')

    expect(result).toMatchObject({ applied: 0, blocked: 1 })
    expect(sqlite.prepare(
      'select error from feature_rule_schedules',
    ).get()).toEqual({ error: expect.stringContaining('forces rollouts off') })
  })

  it('marks a failing step failed, tells the admins and never retries it', async () => {
    seedStep('2026-12-20T08:00:00Z', { enabled: true }, { flag: 'no-flag' })

    const first = await run(afterNotice)

    expect(first).toMatchObject({ applied: 0, failed: 1 })
    expect(statuses()).toEqual(['failed'])
    expect(sqlite.prepare(
      'select error from feature_rule_schedules',
    ).get()).toEqual({ error: expect.stringContaining('Feature not found') })
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed',
    }))
    expect(events[0]!.status).toBe(500)

    const second = await run(afterNotice)

    expect(second).toMatchObject({ applied: 0, failed: 0 })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('fails a step whose stored change is invalid', async () => {
    seedStep('2026-12-20T08:00:00Z', { rolloutBps: 99999 }, { status: 'pending' })

    const result = await run(afterNotice)

    expect(result.failed).toBe(1)
    expect(statuses()).toEqual(['failed'])
  })

  it('cannot apply a step twice when two runs overlap', async () => {
    seedStep('2026-12-20T08:00:00Z', { allowRoles: ['admin', 'tester'] })
    seedStep('2026-12-20T08:10:00Z', { enabled: false })

    const results = await Promise.all([
      run(afterNotice),
      run(afterNotice),
      run(afterNotice),
    ])

    expect(results.reduce((total, result) => {
      return total + result.applied
    }, 0)).toBe(2)
    expect(statuses()).toEqual(['applied', 'applied'])
    expect(auditRows()).toHaveLength(2)
    expect(sqlite.prepare(
      'select count(*) as total from feature_audit_log',
    ).get()).toEqual({ total: 2 })
  })

  it('fails a stale claim instead of re-running it', async () => {
    seedStep('2026-12-20T07:00:00Z', { enabled: false }, {
      status: 'applying',
      claimedAt: secondsOf('2026-12-20T08:00:00Z'),
    })
    seedStep('2026-12-20T08:55:00Z', { enabled: false }, {
      status: 'applying',
      claimedAt: secondsOf('2026-12-20T08:55:00Z'),
    })

    const result = await run(afterNotice)

    expect(result).toMatchObject({ staleClaims: 1, applied: 0 })
    expect(statuses()).toEqual(['failed', 'applying'])
    expect(auditRows()).toEqual([])
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failed',
    }))
  })

  it('does not fail the step when the notification throws', async () => {
    seedStep('2026-12-20T08:00:00Z', { enabled: false })
    notify.mockRejectedValue(new Error('mail down'))

    const result = await run(afterNotice)

    expect(result.applied).toBe(1)
    expect(statuses()).toEqual(['applied'])
    expect(events[0]!.data.attributes.featureScheduleNotify).toEqual({
      error: 'mail down',
    })
  })

  describe('createFeatureSchedules and cancelFeatureSchedule', () => {
    function createContext(now = beforeNotice): FeatureAdminContext {
      return {
        db: db as never,
        kv,
        actor: { userId: 1, kind: 'ui' },
        rolloutEnabled: false,
        logger: { set: vi.fn() },
        now,
      }
    }

    it('stores steps in UTC with the notice for rollout steps', async () => {
      const context = createContext()
      const created = await createFeatureSchedules(context, 'artifacts', {
        steps: [
          { runAt: '2026-12-19T10:00:00.000Z', grantRoles: ['tester'] },
          { runAt: '2026-12-26T10:00:00.000Z', rolloutBps: 2500 },
        ],
      })

      expect(created.ids).toEqual([1, 2])
      expect(await listFeatureSchedules(db as never, 'artifacts'))
        .toEqual([
          expect.objectContaining({
            change: { allowRoles: ['admin', 'tester'] },
            requiresNoticeId: null,
            status: 'pending',
          }),
          expect.objectContaining({
            change: { rolloutBps: 2500 },
            requiresNoticeId: FEATURES_ROLLOUT_NOTICE_ID,
          }),
        ])
      expect(sqlite.prepare(
        'select actor_user_id as actor, action from feature_audit_log',
      ).all()).toEqual([{ actor: 1, action: 'schedule.create' }])
    })

    it('refuses a past step, an unknown flag and a repeated time', async () => {
      const context = createContext()

      await expect(createFeatureSchedules(context, 'artifacts', {
        steps: [{ runAt: '2026-11-01T10:00:00.000Z', enabled: true }],
      })).rejects.toMatchObject({ status: 400 })
      await expect(createFeatureSchedules(context, 'no-flag', {
        steps: [{ runAt: '2026-12-01T10:00:00.000Z', enabled: true }],
      })).rejects.toMatchObject({ status: 404 })

      await createFeatureSchedules(context, 'artifacts', {
        steps: [{ runAt: '2026-12-01T10:00:00.000Z', enabled: true }],
      })

      await expect(createFeatureSchedules(context, 'artifacts', {
        steps: [{ runAt: '2026-12-01T10:00:00.000Z', enabled: false }],
      })).rejects.toMatchObject({ status: 400 })
    })

    it('cancels an open step once and refuses a step that already ran', async () => {
      const context = createContext()

      await createFeatureSchedules(context, 'artifacts', {
        steps: [{ runAt: '2026-12-01T10:00:00.000Z', enabled: true }],
      })
      await cancelFeatureSchedule(context, 'artifacts', 1)

      expect(statuses()).toEqual(['cancelled'])
      await expect(cancelFeatureSchedule(context, 'artifacts', 1))
        .rejects.toMatchObject({ status: 409 })

      seedStep('2026-11-01T10:00:00Z', { enabled: true }, {
        status: 'applied',
      })

      await expect(cancelFeatureSchedule(context, 'artifacts', 2))
        .rejects.toMatchObject({ status: 409 })
    })
  })
})

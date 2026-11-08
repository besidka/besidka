import { describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'
import type { Table } from 'drizzle-orm'
import {
  hasObjectedToExperiments,
  isActiveOptIn,
} from '~~/server/utils/features/evaluate'
import {
  setExperimentsObjection,
  setFeatureOptIn,
} from '~~/server/utils/features/opt-ins'

interface RecordedInsert {
  table: string
  values: Record<string, any>
  conflictSet?: Record<string, any>
}

function createFakeDb(existing: Record<string, Date | null> | null) {
  const inserts: RecordedInsert[] = []
  const db = {
    inserts,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (existing ? [existing] : []),
        }),
      }),
    }),
    insert: (table: Table) => ({
      values: (values: Record<string, any>) => {
        const entry: RecordedInsert = { table: getTableName(table), values }

        inserts.push(entry)

        const chain = {
          onConflictDoUpdate: (input: { set: Record<string, any> }) => {
            entry.conflictSet = input.set

            return chain
          },
        }

        return chain
      },
    }),
    batch: vi.fn(async (statements: unknown[]) => statements.map(() => [])),
  }

  return db
}

function findOptInWrite(db: ReturnType<typeof createFakeDb>) {
  return db.inserts.find(entry => entry.table === 'feature_opt_ins')
}

const logger = { set: vi.fn() }

describe('feature opt-in writers', () => {
  it('stamps an opt-in one second after a same-second opt-out', async () => {
    const optedOutAt = new Date('2026-11-08T10:00:00.000Z')
    const db = createFakeDb({ optedInAt: optedOutAt, optedOutAt })

    await setFeatureOptIn(
      {
        db: db as never,
        userId: 7,
        logger,
        now: new Date('2026-11-08T10:00:00.400Z'),
      },
      'research.custom',
      true,
    )

    const write = findOptInWrite(db)
    const next = { optedInAt: write?.conflictSet?.optedInAt, optedOutAt }

    expect(write?.conflictSet?.optedInAt)
      .toEqual(new Date('2026-11-08T10:00:01.000Z'))
    expect(isActiveOptIn(next)).toBe(true)
  })

  it('never stamps an opt-out earlier than the last opt-in', async () => {
    const optedInAt = new Date('2026-11-08T10:00:01.000Z')
    const db = createFakeDb({ optedInAt, optedOutAt: null })

    await setFeatureOptIn(
      {
        db: db as never,
        userId: 7,
        logger,
        now: new Date('2026-11-08T10:00:00.900Z'),
      },
      'research.custom',
      false,
    )

    const write = findOptInWrite(db)

    expect(write?.conflictSet?.optedOutAt).toEqual(optedInAt)
    expect(isActiveOptIn({
      optedInAt,
      optedOutAt: write?.conflictSet?.optedOutAt,
    })).toBe(false)
  })

  it('withdraws an objection made in the same second', async () => {
    const optedOutAt = new Date('2026-11-08T10:00:00.000Z')
    const db = createFakeDb({ optedInAt: null, optedOutAt })

    await setExperimentsObjection(
      {
        db: db as never,
        userId: 7,
        logger,
        now: new Date('2026-11-08T10:00:00.200Z'),
      },
      false,
    )

    const write = findOptInWrite(db)

    expect(write?.values.flag).toBe('experiments')
    expect(hasObjectedToExperiments({
      userId: 7,
      email: null,
      emailVerified: true,
      twoFactorEnabled: false,
      roles: [],
      grants: {},
      optIns: {
        experiments: {
          optedInAt: write?.conflictSet?.optedInAt,
          optedOutAt,
        },
      },
    })).toBe(false)
  })

  it('writes the opt-in row and the audit row in one batch', async () => {
    const db = createFakeDb(null)

    await setFeatureOptIn(
      { db: db as never, userId: 7, logger, now: new Date() },
      'research.custom',
      true,
    )

    expect(db.batch).toHaveBeenCalledTimes(1)
    expect(db.inserts.map(entry => entry.table))
      .toEqual(['feature_opt_ins', 'feature_audit_log'])
  })
})

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireImageGenerationLease,
  IMAGE_GENERATION_COOLDOWN_MS,
  IMAGE_GENERATION_LEASE_MS,
  releaseImageGenerationLease,
} from '../../../server/utils/ai/image-generation-lock'

describe('image generation lease', () => {
  let sqlite: InstanceType<typeof Database>
  let database: ReturnType<typeof drizzle>

  beforeEach(() => {
    sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE image_generation_locks (
        created_at integer NOT NULL,
        updated_at integer NOT NULL,
        user_id integer PRIMARY KEY,
        token text NOT NULL,
        expires_at integer NOT NULL
      )
    `)
    database = drizzle({ client: sqlite })
  })

  afterEach(() => {
    sqlite.close()
  })

  it('allows only one concurrent acquisition for a user', async () => {
    const now = new Date('2026-07-15T12:00:00.000Z')
    const attempts = await Promise.allSettled([
      acquireImageGenerationLease(42, {
        database: database as never,
        now,
      }),
      acquireImageGenerationLease(42, {
        database: database as never,
        now,
      }),
    ])

    expect(attempts.filter(attempt => attempt.status === 'fulfilled'))
      .toHaveLength(1)
    expect(attempts.filter(attempt => attempt.status === 'rejected'))
      .toHaveLength(1)
  })

  it('allows a new owner after the crash lease expires', async () => {
    const startedAt = new Date('2026-07-15T12:00:00.000Z')
    const firstLease = await acquireImageGenerationLease(42, {
      database: database as never,
      now: startedAt,
    })
    const secondLease = await acquireImageGenerationLease(42, {
      database: database as never,
      now: new Date(startedAt.getTime() + IMAGE_GENERATION_LEASE_MS + 1000),
    })

    expect(secondLease.token).not.toBe(firstLease.token)
  })

  it('holds a short cooldown after the current owner releases', async () => {
    const startedAt = new Date('2026-07-15T12:00:00.000Z')
    const lease = await acquireImageGenerationLease(42, {
      database: database as never,
      now: startedAt,
    })

    await expect(releaseImageGenerationLease(lease, {
      database: database as never,
      now: startedAt,
    })).resolves.toBe(true)
    await expect(acquireImageGenerationLease(42, {
      database: database as never,
      now: new Date(startedAt.getTime() + IMAGE_GENERATION_COOLDOWN_MS - 1000),
    })).rejects.toMatchObject({ status: 429 })
    await expect(acquireImageGenerationLease(42, {
      database: database as never,
      now: new Date(startedAt.getTime() + IMAGE_GENERATION_COOLDOWN_MS + 1000),
    })).resolves.toMatchObject({ userId: 42 })
  })

  it('prevents a stale owner from shortening a reacquired lease', async () => {
    const startedAt = new Date('2026-07-15T12:00:00.000Z')
    const firstLease = await acquireImageGenerationLease(42, {
      database: database as never,
      now: startedAt,
    })
    const reacquiredAt = new Date(
      startedAt.getTime() + IMAGE_GENERATION_LEASE_MS + 1000,
    )
    const secondLease = await acquireImageGenerationLease(42, {
      database: database as never,
      now: reacquiredAt,
    })

    await expect(releaseImageGenerationLease(firstLease, {
      database: database as never,
      now: reacquiredAt,
    })).resolves.toBe(false)
    await expect(acquireImageGenerationLease(42, {
      database: database as never,
      now: new Date(
        reacquiredAt.getTime() + IMAGE_GENERATION_COOLDOWN_MS + 1000,
      ),
    })).rejects.toMatchObject({ status: 429 })
    await expect(releaseImageGenerationLease(secondLease, {
      database: database as never,
      now: reacquiredAt,
    })).resolves.toBe(true)
  })
})

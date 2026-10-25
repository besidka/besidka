import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { describe, expect, it } from 'vitest'

const TEST_SECRET = 'test-secret-with-more-than-32-characters-0000'
const TEST_BASE_URL = 'http://localhost:3000'

function createSecondaryStorage() {
  const store = new Map<string, string>()

  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null
    },
    async set(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
}

async function createFixture() {
  const secondaryStorage = createSecondaryStorage()
  const memoryDatabase: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  }

  const auth = betterAuth({
    secret: TEST_SECRET,
    baseURL: TEST_BASE_URL,
    database: memoryAdapter(memoryDatabase),
    secondaryStorage,
    session: {
      storeSessionInDatabase: true,
    },
  })

  const context = await auth.$context
  const user = await context.internalAdapter.createUser({
    name: 'Restore Runbook',
    email: 'restore-runbook@example.com',
    emailVerified: true,
  })
  const session = await context.internalAdapter.createSession(user.id)

  return {
    internalAdapter: context.internalAdapter,
    memoryDatabase,
    secondaryStorage,
    session,
    user,
  }
}

describe(
  'Better Auth session database fallback (D1 restore runbook premise)',
  () => {
    it('stores a new session in both secondary storage and the database',
      async () => {
        const { memoryDatabase, secondaryStorage, session }
          = await createFixture()

        expect(secondaryStorage.store.has(session.token)).toBe(true)
        expect(memoryDatabase.session).toHaveLength(1)
        expect(memoryDatabase.session[0]?.token).toBe(session.token)
      })

    it('still resolves a session whose secondary storage entry is gone '
      + 'but whose database row exists', async () => {
      const { internalAdapter, secondaryStorage, session, user }
        = await createFixture()

      secondaryStorage.store.delete(session.token)

      const resolved = await internalAdapter.findSession(session.token)

      expect(resolved).not.toBeNull()
      expect(resolved?.session.token).toBe(session.token)
      expect(resolved?.user.id).toBe(user.id)
    })

    it('returns null once the database row is gone as well', async () => {
      const { internalAdapter, memoryDatabase, secondaryStorage, session }
        = await createFixture()

      secondaryStorage.store.delete(session.token)
      memoryDatabase.session.length = 0

      const resolved = await internalAdapter.findSession(session.token)

      expect(resolved).toBeNull()
    })

    it('does not re-create the secondary storage entry when updating a '
      + 'session that only exists in the database', async () => {
      const { internalAdapter, memoryDatabase, secondaryStorage, session }
        = await createFixture()

      secondaryStorage.store.delete(session.token)

      const updatedAt = new Date('2030-01-01T00:00:00Z')

      await internalAdapter.updateSession(session.token, { updatedAt })

      expect(secondaryStorage.store.has(session.token)).toBe(false)
      expect(memoryDatabase.session).toHaveLength(1)
      expect(memoryDatabase.session[0]?.updatedAt).toEqual(updatedAt)
    })

    it('removes both the secondary storage entry and the database row '
      + 'when a session is deleted', async () => {
      const { internalAdapter, memoryDatabase, secondaryStorage, session }
        = await createFixture()

      await internalAdapter.deleteSession(session.token)

      expect(secondaryStorage.store.has(session.token)).toBe(false)
      expect(memoryDatabase.session).toHaveLength(0)
      expect(await internalAdapter.findSession(session.token)).toBeNull()
    })
  },
)

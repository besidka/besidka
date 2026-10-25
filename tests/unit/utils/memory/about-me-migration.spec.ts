import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'evlog'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import {
  buildAboutMeDescription,
  migrateAboutMeToProfileEntry,
} from '~~/server/utils/memory/about-me-migration'
import { createMemoryTestDb } from '../../../setup/helpers/memory-db'
import type { MemoryTestDb } from '../../../setup/helpers/memory-db'

const createOverride = vi.hoisted(() => ({
  current: null as null | (() => Promise<never>),
}))

vi.mock('~~/server/utils/memory/entries', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/memory/entries')
  >()

  return {
    ...actual,
    createMemoryEntry: (
      ...args: Parameters<typeof actual.createMemoryEntry>
    ) => {
      if (createOverride.current) {
        return createOverride.current()
      }

      return actual.createMemoryEntry(...args)
    },
  }
})

const USER_ID = 1
const OTHER_USER_ID = 2
const ABOUT_ME = 'I am a backend developer. I write TypeScript.'
const CARD_NUMBER = '4111 1111 1111 1111'
const HEALTH_TEXT = 'I have type 2 diabetes and take metformin daily.'
const CYRILLIC_BYTES = 2

describe('migrateAboutMeToProfileEntry', () => {
  let testDb: MemoryTestDb
  let loggerSet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    testDb = createMemoryTestDb()
    loggerSet = vi.fn()
    createOverride.current = null
  })

  afterEach(() => {
    testDb.close()
  })

  function migrate(
    userId: number = USER_ID,
    extra: Partial<Parameters<typeof migrateAboutMeToProfileEntry>[0]> = {},
  ) {
    return migrateAboutMeToProfileEntry({
      db: testDb.db,
      userId,
      logger: { set: loggerSet },
      ...extra,
    })
  }

  function fillAccountMemory(count: number, userId: number = USER_ID) {
    for (let index = 0; index < count; index += 1) {
      testDb.insertEntry({
        userId,
        category: 'topics',
        slug: `topic-${index}`,
      })
    }
  }

  function readAboutMe(userId: number = USER_ID): string | null {
    const row = testDb.sqlite
      .prepare('select about_me as aboutMe from user_settings where user_id = ?')
      .get(userId) as { aboutMe: string | null } | undefined

    return row?.aboutMe ?? null
  }

  function readProfileEntries(userId: number = USER_ID) {
    return testDb.sqlite
      .prepare(
        'select title, description, body, origin, slug, sensitivity'
        + ' from memory_entries where user_id = ? and category = ?'
        + ' and project_id is null',
      )
      .all(userId, 'profile') as Array<{
      title: string
      description: string
      body: string
      origin: string
      slug: string
      sensitivity: string
    }>
  }

  function loggedOutcomes(): unknown[] {
    return loggerSet.mock.calls
      .map(([fields]) => {
        return (fields as {
          attributes?: { memoryMigration?: { aboutMe?: string } }
        }).attributes?.memoryMigration?.aboutMe
      })
      .filter((label) => {
        return label !== undefined
      })
  }

  describe('success', () => {
    it('creates exactly one profile entry and clears the column', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: `  ${ABOUT_ME}\n` })

      expect(await migrate()).toEqual({ status: 'migrated' })

      expect(readProfileEntries()).toEqual([{
        title: 'About me',
        description: 'I am a backend developer. I write TypeScript.',
        body: ABOUT_ME,
        origin: 'user',
        slug: 'profile',
        sensitivity: 'none',
      }])
      expect(testDb.countEntries(USER_ID)).toBe(1)
      expect(readAboutMe()).toBeNull()
    })

    it('migrates when memoryEnabled is null and defaults to on', async () => {
      testDb.insertUserSettings({
        userId: USER_ID,
        memoryEnabled: null,
        aboutMe: ABOUT_ME,
      })

      expect(await migrate()).toEqual({ status: 'migrated' })
    })

    it('is idempotent: a second call finds nothing to do', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })

      await migrate()

      expect(await migrate()).toEqual({ status: 'skipped', reason: 'empty' })
      expect(testDb.countEntries(USER_ID)).toBe(1)
      expect(readProfileEntries()[0]?.body).toBe(ABOUT_ME)
    })

    it('only touches the requesting user', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })
      testDb.insertUserSettings({ userId: OTHER_USER_ID, aboutMe: 'Other' })

      await migrate()

      expect(readAboutMe(OTHER_USER_ID)).toBe('Other')
      expect(testDb.countEntries(OTHER_USER_ID)).toBe(0)
    })

    it('logs only the outcome label, never the text', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })

      await migrate()

      expect(loggedOutcomes()).toEqual(['migrated'])
      expect(JSON.stringify(loggerSet.mock.calls)).not.toContain('backend')
    })
  })

  describe('skips leave the column untouched and create nothing', () => {
    function expectUntouched(expectedAboutMe: string | null) {
      expect(readAboutMe()).toBe(expectedAboutMe)
      expect(testDb.countEntries(USER_ID)).toBe(0)
    }

    it('empty: no settings row', async () => {
      expect(await migrate()).toEqual({ status: 'skipped', reason: 'empty' })
      expectUntouched(null)
    })

    it('empty: null and whitespace-only text', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: '  \n\t ' })
      testDb.insertUserSettings({ userId: OTHER_USER_ID, aboutMe: null })

      expect(await migrate()).toEqual({ status: 'skipped', reason: 'empty' })
      expect(await migrate(OTHER_USER_ID))
        .toEqual({ status: 'skipped', reason: 'empty' })
      expectUntouched('  \n\t ')
      expect(loggedOutcomes()).toEqual([])
    })

    it('memory-off: leaves the text to keep being injected', async () => {
      testDb.insertUserSettings({
        userId: USER_ID,
        memoryEnabled: false,
        aboutMe: ABOUT_ME,
      })

      expect(await migrate())
        .toEqual({ status: 'skipped', reason: 'memory-off' })
      expectUntouched(ABOUT_ME)
      expect(loggedOutcomes()).toEqual(['memory-off'])
    })

    it('too-long: text over the always-injected body cap', async () => {
      const aboutMe = 'a'.repeat(
        MEMORY_LIMITS.maxAlwaysInjectedBodyBytes + 1,
      )

      testDb.insertUserSettings({ userId: USER_ID, aboutMe })

      expect(await migrate())
        .toEqual({ status: 'skipped', reason: 'too-long' })
      expectUntouched(aboutMe)
      expect(loggedOutcomes()).toEqual(['too-long'])
    })

    it('profile-exists: never overwrites the existing entry', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })
      testDb.insertEntry({
        userId: USER_ID,
        category: 'profile',
        slug: 'profile',
        title: 'Me',
        description: 'Existing profile',
        body: 'Existing body',
      })

      expect(await migrate())
        .toEqual({ status: 'skipped', reason: 'profile-exists' })
      expect(readAboutMe()).toBe(ABOUT_ME)
      expect(readProfileEntries()).toEqual([{
        title: 'Me',
        description: 'Existing profile',
        body: 'Existing body',
        origin: 'user',
        slug: 'profile',
        sensitivity: 'none',
      }])
      expect(loggedOutcomes()).toEqual(['profile-exists'])
    })

    it('ignores project profile entries and other users', async () => {
      testDb.insertProject({ id: 7, userId: USER_ID })
      testDb.insertEntry({
        userId: USER_ID,
        projectId: 7,
        category: 'profile',
        slug: 'profile',
      })
      testDb.insertEntry({
        userId: OTHER_USER_ID,
        category: 'profile',
        slug: 'profile',
      })
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })

      expect(await migrate()).toEqual({ status: 'migrated' })
      expect(readProfileEntries()).toHaveLength(1)
    })

    it('rejected: a payment card number, without logging it', async () => {
      const aboutMe = `I am a dev, my card is ${CARD_NUMBER}`

      testDb.insertUserSettings({ userId: USER_ID, aboutMe })

      expect(await migrate())
        .toEqual({ status: 'skipped', reason: 'rejected' })
      expectUntouched(aboutMe)
      expect(JSON.stringify(loggerSet.mock.calls))
        .not.toContain(CARD_NUMBER)
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          memoryCompliance: {
            origin: 'about-me-migration',
            blocked: { 'payment-card': 1 },
            blockedTotal: 1,
          },
        },
      })
      expect(loggedOutcomes()).toEqual(['rejected'])
    })

    it('rejected: a health sentence, logging categories only', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: HEALTH_TEXT })

      expect(await migrate())
        .toEqual({ status: 'skipped', reason: 'rejected' })
      expectUntouched(HEALTH_TEXT)
      expect(JSON.stringify(loggerSet.mock.calls)).not.toContain('diabetes')
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          memoryCompliance: {
            sensitive: {
              origin: 'about-me-migration',
              categories: expect.arrayContaining(['health']),
            },
          },
        },
      })
    })
  })

  describe('entries-full', () => {
    const accountCap = MEMORY_LIMITS.maxAccountEntries

    it('skips at the account cap and keeps the text', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })
      fillAccountMemory(accountCap)

      expect(await migrate())
        .toEqual({ status: 'skipped', reason: 'entries-full' })
      expect(readAboutMe()).toBe(ABOUT_ME)
      expect(testDb.countEntries(USER_ID)).toBe(accountCap)
      expect(readProfileEntries()).toEqual([])
      expect(loggedOutcomes()).toEqual(['entries-full'])
    })

    it('does not count project entries toward the account cap', async () => {
      testDb.insertProject({ id: 7, userId: USER_ID })
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })

      for (let index = 0; index < accountCap; index += 1) {
        testDb.insertEntry({
          userId: USER_ID,
          projectId: 7,
          category: 'topics',
          slug: `project-topic-${index}`,
        })
      }

      expect(await migrate()).toEqual({ status: 'migrated' })
    })

    it('converts on a later call once an entry is freed', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })
      fillAccountMemory(accountCap)

      await migrate()

      testDb.sqlite
        .prepare('delete from memory_entries where slug = ?')
        .run('topic-0')

      expect(await migrate()).toEqual({ status: 'migrated' })
      expect(readAboutMe()).toBeNull()
      expect(readProfileEntries()).toHaveLength(1)
    })

    it('keeps the profile-exists outcome for a full account with a profile',
      async () => {
        testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })
        fillAccountMemory(accountCap - 1)
        testDb.insertEntry({
          userId: USER_ID,
          category: 'profile',
          slug: 'profile',
          title: 'Me',
        })

        expect(await migrate())
          .toEqual({ status: 'skipped', reason: 'profile-exists' })
      })
  })

  describe('caller-provided settings and compliance logging', () => {
    it('does not read user_settings when the settings are passed',
      async () => {
        testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })

        const findFirst = vi.spyOn(testDb.db.query.userSettings, 'findFirst')

        expect(await migrate(USER_ID, {
          settings: { aboutMe: ABOUT_ME, memoryEnabled: true },
        })).toEqual({ status: 'migrated' })
        expect(findFirst).not.toHaveBeenCalled()
        expect(readAboutMe()).toBeNull()
      })

    it('reads user_settings once when no settings are passed', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })

      const findFirst = vi.spyOn(testDb.db.query.userSettings, 'findFirst')

      await migrate()

      expect(findFirst).toHaveBeenCalledTimes(1)
    })

    it('treats null settings as no row', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })

      expect(await migrate(USER_ID, { settings: null }))
        .toEqual({ status: 'skipped', reason: 'empty' })
      expect(readAboutMe()).toBe(ABOUT_ME)
    })

    it('trusts the passed memoryEnabled and aboutMe over the stored row',
      async () => {
        testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })

        expect(await migrate(USER_ID, {
          settings: { aboutMe: ABOUT_ME, memoryEnabled: false },
        })).toEqual({ status: 'skipped', reason: 'memory-off' })
      })

    it('logs only the outcome for a rejected text without compliance',
      async () => {
        const aboutMe = `I am a dev, my card is ${CARD_NUMBER}`

        testDb.insertUserSettings({ userId: USER_ID, aboutMe })

        expect(await migrate(USER_ID, {
          settings: { aboutMe, memoryEnabled: true },
          recordCompliance: false,
        })).toEqual({ status: 'skipped', reason: 'rejected' })
        expect(loggerSet).toHaveBeenCalledTimes(1)
        expect(loggerSet).toHaveBeenCalledWith({
          attributes: { memoryMigration: { aboutMe: 'rejected' } },
        })
      })

    it('records the compliance counts by default', async () => {
      const aboutMe = `I am a dev, my card is ${CARD_NUMBER}`

      testDb.insertUserSettings({ userId: USER_ID, aboutMe })

      await migrate()

      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          memoryCompliance: expect.objectContaining({
            origin: 'about-me-migration',
          }),
        },
      })
    })
  })

  describe('size boundary is in bytes', () => {
    it('migrates ASCII text of exactly the byte limit', async () => {
      const aboutMe = 'a'.repeat(MEMORY_LIMITS.maxAlwaysInjectedBodyBytes)

      testDb.insertUserSettings({ userId: USER_ID, aboutMe })

      expect(await migrate()).toEqual({ status: 'migrated' })
      expect(readProfileEntries()[0]?.body).toBe(aboutMe)
    })

    it('migrates multi-byte text that lands exactly on the byte limit',
      async () => {
        const aboutMe = 'я'.repeat(
          MEMORY_LIMITS.maxAlwaysInjectedBodyBytes / CYRILLIC_BYTES,
        )

        testDb.insertUserSettings({ userId: USER_ID, aboutMe })

        expect(await migrate()).toEqual({ status: 'migrated' })
        expect(readProfileEntries()[0]?.body).toBe(aboutMe)
      })

    it('skips multi-byte text over the byte limit even when its character '
      + 'count is under the limit', async () => {
      const aboutMe = 'я'.repeat(
        MEMORY_LIMITS.maxAlwaysInjectedBodyBytes / CYRILLIC_BYTES + 1,
      )

      testDb.insertUserSettings({ userId: USER_ID, aboutMe })

      expect(aboutMe.length)
        .toBeLessThan(MEMORY_LIMITS.maxAlwaysInjectedBodyBytes)
      expect(await migrate())
        .toEqual({ status: 'skipped', reason: 'too-long' })
      expect(readAboutMe()).toBe(aboutMe)
      expect(testDb.countEntries(USER_ID)).toBe(0)
    })

    it('measures the trimmed text, not the stored padding', async () => {
      const aboutMe = 'a'.repeat(MEMORY_LIMITS.maxAlwaysInjectedBodyBytes)

      testDb.insertUserSettings({ userId: USER_ID, aboutMe: `  ${aboutMe}  ` })

      expect(await migrate()).toEqual({ status: 'migrated' })
    })
  })

  describe('concurrency and recovery', () => {
    it('reports profile-exists when the insert loses a 409 race',
      async () => {
        testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })
        createOverride.current = async () => {
          testDb.insertEntry({
            userId: USER_ID,
            category: 'profile',
            slug: 'profile',
            title: 'Me',
            body: 'Written by someone else',
          })

          throw createError({
            message: 'The profile entry already exists, edit it instead',
            status: 409,
          })
        }

        expect(await migrate())
          .toEqual({ status: 'skipped', reason: 'profile-exists' })
        expect(readAboutMe()).toBe(ABOUT_ME)
        expect(readProfileEntries()).toHaveLength(1)
        expect(readProfileEntries()[0]?.body).toBe('Written by someone else')
      })

    it('rethrows a 409 that is neither a singleton conflict nor the cap',
      async () => {
        testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })
        createOverride.current = async () => {
          throw createError({
            message: 'The memory entry could not be saved',
            status: 409,
          })
        }

        await expect(migrate()).rejects.toMatchObject({ status: 409 })
        expect(readAboutMe()).toBe(ABOUT_ME)
      })

    it('rethrows unexpected failures and keeps the column', async () => {
      testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })
      createOverride.current = async () => {
        throw new Error('D1 unavailable')
      }

      await expect(migrate()).rejects.toThrow('D1 unavailable')
      expect(readAboutMe()).toBe(ABOUT_ME)
    })

    it('completes an interrupted migration without a duplicate entry',
      async () => {
        testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })
        testDb.insertEntry({
          userId: USER_ID,
          category: 'profile',
          slug: 'profile',
          title: 'About me',
          description: 'I am a backend developer.',
          body: ABOUT_ME,
        })

        expect(await migrate()).toEqual({ status: 'migrated' })
        expect(readAboutMe()).toBeNull()
        expect(testDb.countEntries(USER_ID)).toBe(1)
      })

    it('two parallel calls leave one entry and a cleared column',
      async () => {
        testDb.insertUserSettings({ userId: USER_ID, aboutMe: ABOUT_ME })

        const outcomes = await Promise.all([migrate(), migrate()])

        expect(outcomes.some((outcome) => {
          return outcome.status === 'migrated'
        })).toBe(true)
        expect(testDb.countEntries(USER_ID)).toBe(1)
        expect(readAboutMe()).toBeNull()
      })
  })
})

describe('buildAboutMeDescription', () => {
  const limit = MEMORY_LIMITS.maxDescriptionChars

  it('uses the first non-empty line', () => {
    expect(buildAboutMeDescription('\n  \nBackend dev.\nSecond line.'))
      .toBe('Backend dev.')
  })

  it('collapses inner whitespace to a single line', () => {
    expect(buildAboutMeDescription('Backend \t  dev')).toBe('Backend dev')
  })

  it('keeps a line of exactly the limit untouched', () => {
    const line = 'a'.repeat(limit)

    expect(buildAboutMeDescription(line)).toBe(line)
  })

  it('cuts a longer line at the last word boundary with an ellipsis', () => {
    const description = buildAboutMeDescription(
      `${'word '.repeat(30)}tail`,
    )

    expect(description.length).toBeLessThanOrEqual(limit)
    expect(description.endsWith('word…')).toBe(true)
    expect(description).not.toContain('\n')
  })

  it('hard-cuts a long line without spaces', () => {
    const description = buildAboutMeDescription('я'.repeat(300))

    expect(description).toBe(`${'я'.repeat(limit - 1)}…`)
  })

  it('does not leave half of a surrogate pair', () => {
    const description = buildAboutMeDescription('😀'.repeat(100))

    expect(description.length).toBeLessThanOrEqual(limit)
    expect(description).not.toMatch(/[\uD800-\uDBFF]…$/)
  })

  it('falls back when there is no text', () => {
    expect(buildAboutMeDescription('  \n ')).toBe('Things I wrote about myself')
  })
})

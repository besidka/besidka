import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMemoryInstructions,
  loadMemorySettingsFailClosed,
  readUserMessageText,
} from '~~/server/utils/memory/chat-context'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { migrateAboutMeToProfileEntry } from '~~/server/utils/memory/about-me-migration'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import { createMemoryTestDb } from '../../../setup/helpers/memory-db'

const USER_ID = 1
const ABOUT_ME = 'I am a backend developer.'
const REJECTED_ABOUT_ME = 'I have type 2 diabetes and take metformin daily.'
const TOO_LONG_ABOUT_ME = 'a'.repeat(
  MEMORY_LIMITS.maxAlwaysInjectedBodyBytes + 1,
)

describe('chat memory context', () => {
  let testDb: ReturnType<typeof createMemoryTestDb>
  let loggerSet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    testDb = createMemoryTestDb()
    loggerSet = vi.fn()
  })

  afterEach(() => {
    testDb.close()
  })

  function throwingDb(message: string) {
    return new Proxy(testDb.db, {
      get(target, property) {
        if (property === 'query') {
          throw new Error(message)
        }

        return Reflect.get(target, property)
      },
    })
  }

  describe('loadMemorySettingsFailClosed', () => {
    it('returns the stored settings with the defaults applied', async () => {
      testDb.insertUserSettings({
        userId: USER_ID,
        memoryEnabled: true,
        aboutMe: `  ${ABOUT_ME}  `,
      })

      const settings = await loadMemorySettingsFailClosed(
        testDb.db,
        USER_ID,
        { set: loggerSet },
      )

      expect(settings).toEqual({
        memoryEnabled: true,
        chatSearchEnabled: true,
      })
      expect(loggerSet).not.toHaveBeenCalled()
    })

    it('uses the defaults when the user has no settings row', async () => {
      const settings = await loadMemorySettingsFailClosed(
        testDb.db,
        USER_ID,
        { set: loggerSet },
      )

      expect(settings).toEqual({
        memoryEnabled: true,
        chatSearchEnabled: true,
      })
    })

    it('turns everything off and logs the error when the read throws',
      async () => {
        const settings = await loadMemorySettingsFailClosed(
          throwingDb('d1 unavailable'),
          USER_ID,
          { set: loggerSet },
        )

        expect(settings).toEqual({
          memoryEnabled: false,
          chatSearchEnabled: false,
        })
        expect(loggerSet).toHaveBeenCalledWith({
          attributes: {
            memorySettings: { error: 'd1 unavailable' },
          },
        })
      })
  })

  describe('readUserMessageText', () => {
    it('joins the text parts and ignores the rest', () => {
      expect(readUserMessageText([
        { type: 'text', text: 'First.' },
        { type: 'file' },
        { type: 'text', text: 'Second.' },
      ])).toBe('First.\nSecond.')
    })

    it('returns null without usable text', () => {
      expect(readUserMessageText([])).toBeNull()
      expect(readUserMessageText([{ type: 'file' }])).toBeNull()
      expect(readUserMessageText([{ type: 'text', text: '  \n' }]))
        .toBeNull()
    })
  })

  describe('buildMemoryInstructions', () => {
    function instructionsFor(input: {
      memoryEnabled: boolean
      db?: typeof testDb.db
    }) {
      return buildMemoryInstructions({
        db: input.db ?? testDb.db,
        userId: USER_ID,
        projectId: null,
        projectMemoryDisabled: false,
        useAccountMemory: null,
        settings: {
          memoryEnabled: input.memoryEnabled,
          chatSearchEnabled: true,
        },
        hasMemoryTools: true,
        logger: { set: loggerSet },
      })
    }

    it('returns null when there is nothing to inject', async () => {
      expect(await instructionsFor({ memoryEnabled: true })).toBeNull()
      expect(await instructionsFor({ memoryEnabled: false })).toBeNull()
    })

    it('returns the index alone and logs the index figures', async () => {
      testDb.insertEntry({ userId: USER_ID, slug: 'cooking' })

      const instructions = await instructionsFor({ memoryEnabled: true })

      expect(instructions?.startsWith('<memory>')).toBe(true)
      expect(instructions?.endsWith('</memory>')).toBe(true)
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          memoryIndex: {
            tokens: expect.any(Number),
            entryCount: 1,
            trimSteps: [],
            overBudget: false,
          },
        },
      })
    })

    it('injects nothing while memory is off', async () => {
      testDb.insertEntry({ userId: USER_ID, slug: 'cooking' })

      expect(await instructionsFor({ memoryEnabled: false })).toBeNull()
    })

    it('drops the index and logs it when the load throws',
      async () => {
        const instructions = await instructionsFor({
          memoryEnabled: true,
          db: throwingDb('memory read failed'),
        })

        expect(instructions).toBeNull()
        expect(loggerSet).toHaveBeenCalledWith({
          attributes: {
            memoryIndex: { error: 'memory read failed' },
          },
        })
      })

    describe('after the about-me migration', () => {
      const PROFILE_BODY = 'I am a backend developer.'
      const ABOUT_ME_HEADER = 'wrote the following about themselves'

      async function instructionsFromStoredSettings() {
        const settings = await loadMemorySettingsFailClosed(
          testDb.db,
          USER_ID,
          { set: loggerSet },
        )

        return await buildMemoryInstructions({
          db: testDb.db,
          userId: USER_ID,
          projectId: null,
          projectMemoryDisabled: false,
          useAccountMemory: null,
          settings,
          hasMemoryTools: true,
          logger: { set: loggerSet },
        })
      }

      it('has no about-me section and the index carries the profile body',
        async () => {
          testDb.insertUserSettings({ userId: USER_ID, aboutMe: null })
          testDb.insertEntry({
            userId: USER_ID,
            category: 'profile',
            slug: 'profile',
            title: 'About me',
            description: 'Backend developer',
            body: PROFILE_BODY,
          })

          const instructions = await instructionsFromStoredSettings()

          expect(instructions).toContain('<memory>')
          expect(instructions).toContain(PROFILE_BODY)
          expect(instructions).not.toContain(ABOUT_ME_HEADER)
        })

      it.each([
        {
          reason: 'rejected',
          aboutMe: REJECTED_ABOUT_ME,
          memoryEnabled: true,
          seedProfile: false,
        },
        {
          reason: 'memory-off',
          aboutMe: ABOUT_ME,
          memoryEnabled: false,
          seedProfile: false,
        },
        {
          reason: 'profile-exists',
          aboutMe: ABOUT_ME,
          memoryEnabled: true,
          seedProfile: true,
        },
        {
          reason: 'too-long',
          aboutMe: TOO_LONG_ABOUT_ME,
          memoryEnabled: true,
          seedProfile: false,
        },
      ] as const)('never injects an about-me text the migration skipped as '
        + '$reason', async ({ reason, aboutMe, memoryEnabled, seedProfile }) => {
        testDb.insertUserSettings({ userId: USER_ID, aboutMe, memoryEnabled })

        if (seedProfile) {
          testDb.insertEntry({
            userId: USER_ID,
            category: 'profile',
            slug: 'profile',
            title: 'Me',
            description: 'Existing profile',
            body: 'Existing body',
          })
        }

        const outcome = await migrateAboutMeToProfileEntry({
          db: testDb.db,
          userId: USER_ID,
          logger: { set: loggerSet },
          recordCompliance: false,
        })
        const instructions = await instructionsFromStoredSettings()

        expect(outcome).toEqual({ status: 'skipped', reason })
        expect(instructions ?? '').not.toContain(ABOUT_ME_HEADER)
        expect(instructions ?? '').not.toContain(aboutMe)
      })
    })

    it('never injects a legacy special entry', async () => {
      testDb.insertEntry({ userId: USER_ID, slug: 'cooking' })
      testDb.insertEntry({
        userId: USER_ID,
        slug: 'allergy',
        title: 'Allergy title',
        description: 'Allergy description',
        body: 'Allergy body',
        sensitivity: 'special',
        sensitiveCategory: 'health',
      })

      const instructions = await instructionsFor({ memoryEnabled: true })

      expect(instructions).toContain('cooking')
      expect(instructions).not.toContain('Allergy')
      expect(instructions).not.toContain('allergy')
      expect(instructions).not.toContain('withheld')
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          memoryIndex: {
            tokens: expect.any(Number),
            entryCount: 1,
            trimSteps: [],
            overBudget: false,
          },
        },
      })
    })

    it('never reads another user\'s entries into the index', async () => {
      testDb.insertEntry({ userId: 2, slug: 'secret', title: 'Secret' })

      expect(await instructionsFor({ memoryEnabled: true })).toBeNull()
    })

    describe('project with memory turned off', () => {
      const PROJECT_ROW_ID = 7

      function instructionsForProject(
        useAccountMemory: boolean | null,
        projectMemoryDisabled: boolean | null,
        db: typeof testDb.db = testDb.db,
      ) {
        return buildMemoryInstructions({
          db,
          userId: USER_ID,
          projectId: encodePublicId(PROJECT_ROW_ID),
          projectMemoryDisabled,
          useAccountMemory,
          settings: {
            memoryEnabled: true,
            chatSearchEnabled: true,
          },
          hasMemoryTools: true,
          logger: { set: loggerSet },
        })
      }

      beforeEach(() => {
        testDb.insertProject({ id: PROJECT_ROW_ID, userId: USER_ID })
        testDb.insertEntry({
          userId: USER_ID,
          slug: 'account-topic',
          title: 'Account topic',
        })
        testDb.insertEntry({
          userId: USER_ID,
          projectId: PROJECT_ROW_ID,
          slug: 'project-topic',
          title: 'Project topic',
        })
      })

      it('injects project entries while the project memory is on', async () => {
        const instructions = await instructionsForProject(null, false)

        expect(instructions).toContain('Project topic')
        expect(instructions).toContain('Account topic')
      })

      it('injects no project entries but keeps account entries when disabled', async () => {
        const instructions = await instructionsForProject(null, true)

        expect(instructions).toContain('Account topic')
        expect(instructions).not.toContain('Project topic')
      })

      it('injects nothing when disabled and account memory is hidden', async () => {
        expect(await instructionsForProject(false, true)).toBeNull()
      })

      it('fails closed when the status could not be determined', async () => {
        const instructions = await instructionsForProject(null, null)

        expect(instructions).toContain('Account topic')
        expect(instructions).not.toContain('Project topic')
        expect(await instructionsForProject(false, null)).toBeNull()
      })

      it('does not query the project row', async () => {
        const querySpy = vi.fn()
        const spiedDb = new Proxy(testDb.db, {
          get(target, property) {
            if (property === 'query') {
              const query = Reflect.get(target, property) as any

              return new Proxy(query, {
                get(queryTarget, table) {
                  if (table === 'projects') {
                    querySpy()
                  }

                  return Reflect.get(queryTarget, table)
                },
              })
            }

            return Reflect.get(target, property)
          },
        })

        await instructionsForProject(null, false, spiedDb)

        expect(querySpy).not.toHaveBeenCalled()
      })

      it('keeps the entries in the database', async () => {
        await instructionsForProject(null, true)

        expect(testDb.countEntries(USER_ID)).toBe(2)
      })
    })
  })
})

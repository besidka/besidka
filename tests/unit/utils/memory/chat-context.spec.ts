import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMemoryInstructions,
  loadMemorySettingsFailClosed,
  readUserMessageText,
} from '~~/server/utils/memory/chat-context'
import { createMemoryTestDb } from '../../../setup/helpers/memory-db'

const policyMock = vi.hoisted(() => ({ allowlist: [] as string[] }))

vi.mock('#shared/utils/memory-policy', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('#shared/utils/memory-policy')
  >()

  return {
    ...actual,
    isSensitiveMemoryProviderAllowed: (
      input: Parameters<typeof actual.isSensitiveMemoryProviderAllowed>[0],
    ) => {
      return actual.isSensitiveMemoryProviderAllowed(
        input,
        policyMock.allowlist,
      )
    },
  }
})

const USER_ID = 1
const ABOUT_ME = 'I am a backend developer.'

describe('chat memory context', () => {
  let testDb: ReturnType<typeof createMemoryTestDb>
  let loggerSet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    testDb = createMemoryTestDb()
    loggerSet = vi.fn()
    policyMock.allowlist = []
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
        memoryIncludeSensitive: false,
        aboutMe: ABOUT_ME,
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
        memoryIncludeSensitive: false,
        aboutMe: null,
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
          memoryIncludeSensitive: false,
          aboutMe: null,
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
      aboutMe?: string | null
      db?: typeof testDb.db
      includeSensitive?: boolean
      providerId?: string | null
      gatewayId?: string | null
    }) {
      return buildMemoryInstructions({
        db: input.db ?? testDb.db,
        userId: USER_ID,
        projectId: null,
        useAccountMemory: null,
        settings: {
          memoryEnabled: input.memoryEnabled,
          chatSearchEnabled: true,
          memoryIncludeSensitive: input.includeSensitive ?? false,
          aboutMe: input.aboutMe ?? null,
        },
        hasMemoryTools: true,
        providerId: input.providerId === undefined
          ? 'openai'
          : input.providerId,
        gatewayId: input.gatewayId,
        logger: { set: loggerSet },
      })
    }

    it('returns null when there is nothing to inject', async () => {
      expect(await instructionsFor({ memoryEnabled: true })).toBeNull()
      expect(await instructionsFor({ memoryEnabled: false })).toBeNull()
    })

    it('puts the index before aboutMe and logs the index figures',
      async () => {
        testDb.insertEntry({ userId: USER_ID, slug: 'cooking' })

        const instructions = await instructionsFor({
          memoryEnabled: true,
          aboutMe: ABOUT_ME,
        })

        expect(instructions?.startsWith('<memory>')).toBe(true)
        expect(instructions?.indexOf('</memory>'))
          .toBeLessThan(instructions?.indexOf(ABOUT_ME) ?? -1)
        expect(loggerSet).toHaveBeenCalledWith({
          attributes: {
            memoryIndex: {
              tokens: expect.any(Number),
              entryCount: 1,
              withheldSensitive: 0,
              trimSteps: [],
              overBudget: false,
            },
          },
        })
      })

    it('injects aboutMe without the index while memory is off', async () => {
      testDb.insertEntry({ userId: USER_ID, slug: 'cooking' })

      const instructions = await instructionsFor({
        memoryEnabled: false,
        aboutMe: ABOUT_ME,
      })

      expect(instructions).toContain(ABOUT_ME)
      expect(instructions).not.toContain('<memory>')
    })

    it('drops the index, logs it and keeps aboutMe when the load throws',
      async () => {
        const instructions = await instructionsFor({
          memoryEnabled: true,
          aboutMe: ABOUT_ME,
          db: throwingDb('memory read failed'),
        })

        expect(instructions).toContain(ABOUT_ME)
        expect(instructions).not.toContain('<memory>')
        expect(loggerSet).toHaveBeenCalledWith({
          attributes: {
            memoryIndex: { error: 'memory read failed' },
          },
        })
      })

    describe('sensitive provider gate', () => {
      const WITHHELD_FRAGMENT = 'Some sensitive memories are withheld'

      beforeEach(() => {
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
      })

      it('withholds special entries from a direct provider that is not '
        + 'allowlisted and logs the count only', async () => {
        const instructions = await instructionsFor({
          memoryEnabled: true,
          includeSensitive: true,
          providerId: 'openai',
        })

        expect(instructions).toContain(WITHHELD_FRAGMENT)
        expect(instructions).not.toContain('Allergy')
        expect(instructions).not.toContain('allergy')
        expect(loggerSet).toHaveBeenCalledWith({
          attributes: {
            memoryIndex: {
              tokens: expect.any(Number),
              entryCount: 1,
              withheldSensitive: 1,
              trimSteps: [],
              overBudget: false,
            },
          },
        })
      })

      it('includes special entries for an allowlisted direct provider',
        async () => {
          policyMock.allowlist = ['openai']

          const instructions = await instructionsFor({
            memoryEnabled: true,
            includeSensitive: true,
            providerId: 'openai',
          })

          expect(instructions).toContain('Allergy title')
          expect(instructions).not.toContain(WITHHELD_FRAGMENT)
          expect(loggerSet).toHaveBeenCalledWith({
            attributes: {
              memoryIndex: expect.objectContaining({
                entryCount: 2,
                withheldSensitive: 0,
              }),
            },
          })
        })

      it('withholds special entries on a gateway send even when the '
        + 'provider id is allowlisted', async () => {
        policyMock.allowlist = ['openai', 'vercel-gateway']

        const instructions = await instructionsFor({
          memoryEnabled: true,
          includeSensitive: true,
          providerId: null,
          gatewayId: 'openrouter',
        })

        expect(instructions).toContain(WITHHELD_FRAGMENT)
        expect(instructions).not.toContain('Allergy')
      })

      it('adds no line and logs zero withheld without the opt-in',
        async () => {
          const instructions = await instructionsFor({
            memoryEnabled: true,
            includeSensitive: false,
            providerId: 'openai',
          })

          expect(instructions).not.toContain(WITHHELD_FRAGMENT)
          expect(instructions).not.toContain('Allergy')
          expect(loggerSet).toHaveBeenCalledWith({
            attributes: {
              memoryIndex: expect.objectContaining({ withheldSensitive: 0 }),
            },
          })
        })
    })

    it('never reads another user\'s entries into the index', async () => {
      testDb.insertEntry({ userId: 2, slug: 'secret', title: 'Secret' })

      expect(await instructionsFor({ memoryEnabled: true })).toBeNull()
    })
  })
})

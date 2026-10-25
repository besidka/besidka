import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildMemoryInstructions,
  loadMemorySettingsFailClosed,
  readUserMessageText,
} from '~~/server/utils/memory/chat-context'
import { createMemoryTestDb } from '../../../setup/helpers/memory-db'

const USER_ID = 1
const ABOUT_ME = 'I am a backend developer.'

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
    }) {
      return buildMemoryInstructions({
        db: input.db ?? testDb.db,
        userId: USER_ID,
        projectId: null,
        useAccountMemory: null,
        settings: {
          memoryEnabled: input.memoryEnabled,
          chatSearchEnabled: true,
          aboutMe: input.aboutMe ?? null,
        },
        hasMemoryTools: true,
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
  })
})

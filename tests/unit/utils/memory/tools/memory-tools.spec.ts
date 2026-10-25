import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toolRequiresFollowUpTurn } from '~~/server/utils/ai/tool-loop'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import {
  consumeChatSearchCall,
  createChatSearchBudget,
} from '~~/server/utils/memory/tools/chat-search-budget'
import { CHAT_SEARCH_MAX_CALLS_PER_TURN } from '~~/server/utils/memory/tools/constants'
import {
  MEMORY_LIST_MAX_ENTRIES,
  MEMORY_TOOL_NOTICE,
} from '~~/server/utils/memory/tools/memory-constants'
import {
  assertUserRequestQuote,
  buildMemoryHandle,
  getMemoryTools,
  normalizeUserRequestText,
} from '~~/server/utils/memory/tools/memory-tools'
import { createMemoryTestDb } from '../../../../setup/helpers/memory-db'

const OWNER = 1
const STRANGER = 2
const PROJECT_ID = 7
const OTHER_PROJECT_ID = 8
const STRANGER_PROJECT_ID = 9
const MESSAGE_ID = 'user-message-public-id'
const OLD_TIMESTAMP = 1_700_000_000
const DEFAULT_MESSAGE = 'Please remember that I cook pasta twice a week.'
const DEFAULT_QUOTE = 'remember that I cook pasta twice a week'
const CARD_NUMBER = '4111 1111 1111 1111'

const toolOptions = { toolCallId: 'call-1', messages: [] }

interface ExecutableTool {
  execute: (input: unknown, options: unknown) => Promise<any>
  requiresFollowUpTurn?: boolean
}

describe('memory tools', () => {
  let testDb: ReturnType<typeof createMemoryTestDb>
  let loggerSet: ReturnType<typeof vi.fn>
  let CHAT_ID: string
  let OLDER_CHAT_ID: string

  function build(overrides: {
    userId?: number
    projectId?: number | null
    projectDisabled?: boolean
    useAccountMemory?: boolean | null
    userMessageText?: string | null
    budget?: ReturnType<typeof createChatSearchBudget>
    db?: typeof testDb.db
  } = {}) {
    const budget = overrides.budget ?? createChatSearchBudget()
    const { tools } = getMemoryTools({
      db: overrides.db ?? testDb.db,
      userId: overrides.userId ?? OWNER,
      chatId: CHAT_ID,
      projectId: overrides.projectId === undefined
        ? null
        : overrides.projectId === null
          ? null
          : encodePublicId(overrides.projectId),
      projectDisabled: overrides.projectDisabled,
      useAccountMemory: overrides.useAccountMemory ?? null,
      sourceMessageId: MESSAGE_ID,
      userMessageText: overrides.userMessageText === undefined
        ? DEFAULT_MESSAGE
        : overrides.userMessageText,
      budget,
      logger: { set: loggerSet },
    })

    return {
      budget,
      tools: tools as Record<string, ExecutableTool>,
    }
  }

  function readRow(id: number) {
    return testDb.sqlite
      .prepare('select * from memory_entries where id = ?')
      .get(id) as Record<string, any> | undefined
  }

  function readRowBySlug(slug: string, userId: number = OWNER) {
    return testDb.sqlite
      .prepare('select * from memory_entries where slug = ? and user_id = ?')
      .get(slug, userId) as Record<string, any> | undefined
  }

  function writeInput(overrides: Record<string, unknown> = {}) {
    return {
      category: 'topics',
      title: 'Cooking',
      description: 'Likes to cook pasta',
      body: 'Cooks pasta twice a week.',
      userRequestQuote: DEFAULT_QUOTE,
      ...overrides,
    }
  }

  beforeEach(() => {
    CHAT_ID = encodePublicId(500)
    OLDER_CHAT_ID = encodePublicId(400)
    testDb = createMemoryTestDb()
    loggerSet = vi.fn()
    testDb.insertProject({ id: PROJECT_ID, userId: OWNER })
    testDb.insertProject({ id: OTHER_PROJECT_ID, userId: OWNER })
    testDb.insertProject({ id: STRANGER_PROJECT_ID, userId: STRANGER })
  })

  afterEach(() => {
    testDb.close()
  })

  describe('registration', () => {
    it('registers all four tools for a user message with text', () => {
      const { tools } = build()

      expect(Object.keys(tools).sort()).toEqual([
        'memory_forget',
        'memory_list',
        'memory_read',
        'memory_write',
      ])
    })

    it.each([
      ['null', null],
      ['empty', ''],
      ['whitespace only', '   \n '],
    ])('registers only the read tools when the user text is %s',
      (_label, userMessageText) => {
        const { tools } = build({ userMessageText })

        expect(Object.keys(tools).sort()).toEqual([
          'memory_list',
          'memory_read',
        ])
      })

    it('marks every tool for a follow-up turn', () => {
      const { tools } = build()

      for (const registeredTool of Object.values(tools)) {
        expect(toolRequiresFollowUpTurn(registeredTool)).toBe(true)
      }
    })

    it('describes the write tool with the explicit-request rule', () => {
      const { tools } = build()
      const description = (tools.memory_write as any).description as string

      expect(description).toContain('ONLY when the user\'s current message')
      expect(description).toContain('web page')
      expect(description).toContain('instructions for yourself')
      expect(description).toContain('Sensitive topics (health, religion')
      expect(description).toContain('are never stored')
      expect(description).toContain('the server refuses such entries')
      expect(description).toContain('do not try to word around it')
      expect(description).not.toContain('Notes about other people')
      expect(description).not.toContain('mark it special')
      expect(description).not.toContain('sensitivity')
      expect(description).not.toContain('sensitiveCategory')
      expect(description.toLowerCase()).toContain('at most 3 calls')
    })
  })

  describe('memory_list', () => {
    it('lists account entries with handle, scope and body and a notice',
      async () => {
        testDb.insertEntry({
          id: 1,
          userId: OWNER,
          category: 'profile',
          slug: 'profile',
          title: 'About me',
          description: 'Short bio',
          body: 'Lives in Lviv.',
        })
        testDb.insertEntry({
          id: 2,
          userId: OWNER,
          category: 'topics',
          slug: 'cooking',
          title: 'Cooking',
        })

        const { tools } = build()
        const output = await tools.memory_list!.execute({}, toolOptions)

        expect(output.notice).toBe(MEMORY_TOOL_NOTICE)
        expect(output.entries).toEqual([
          {
            id: encodePublicId(1),
            handle: 'profile/profile',
            scope: 'account',
            category: 'profile',
            title: 'About me',
            description: 'Short bio',
            body: 'Lives in Lviv.',
          },
          expect.objectContaining({
            id: encodePublicId(2),
            handle: 'topics/cooking',
            scope: 'account',
          }),
        ])
      })

    it('adds the chat project entries with a project handle', async () => {
      testDb.insertEntry({ id: 1, userId: OWNER, slug: 'account-one' })
      testDb.insertEntry({
        id: 2,
        userId: OWNER,
        projectId: PROJECT_ID,
        slug: 'launch-plan',
      })
      testDb.insertEntry({
        id: 3,
        userId: OWNER,
        projectId: OTHER_PROJECT_ID,
        slug: 'other-project',
      })

      const { tools } = build({ projectId: PROJECT_ID })
      const output = await tools.memory_list!.execute({}, toolOptions)

      expect(output.entries.map((entry: any) => entry.handle)).toEqual([
        'topics/account-one',
        'project/topics/launch-plan',
      ])
      expect(output.entries[1].scope).toBe('project')
    })

    it('hides account entries inside a project that keeps its memory '
      + 'separate', async () => {
      testDb.insertEntry({ id: 1, userId: OWNER, slug: 'account-one' })
      testDb.insertEntry({
        id: 2,
        userId: OWNER,
        projectId: PROJECT_ID,
        slug: 'launch-plan',
      })

      const { tools } = build({
        projectId: PROJECT_ID,
        useAccountMemory: false,
      })
      const output = await tools.memory_list!.execute({}, toolOptions)

      expect(output.entries.map((entry: any) => entry.handle)).toEqual([
        'project/topics/launch-plan',
      ])
    })

    it('keeps account entries visible when useAccountMemory is true or null',
      async () => {
        testDb.insertEntry({ id: 1, userId: OWNER, slug: 'account-one' })

        for (const useAccountMemory of [true, null]) {
          const { tools } = build({
            projectId: PROJECT_ID,
            useAccountMemory,
          })
          const output = await tools.memory_list!.execute({}, toolOptions)

          expect(output.entries).toHaveLength(1)
        }
      })

    it('never shows another user\'s entries', async () => {
      testDb.insertEntry({ id: 1, userId: STRANGER, slug: 'secret' })
      testDb.insertEntry({
        id: 2,
        userId: STRANGER,
        projectId: STRANGER_PROJECT_ID,
        slug: 'secret-project',
      })

      const { tools } = build()
      const output = await tools.memory_list!.execute({}, toolOptions)

      expect(output.entries).toEqual([])
    })

    it('narrows the list to one category', async () => {
      testDb.insertEntry({
        id: 1,
        userId: OWNER,
        category: 'people',
        slug: 'anna',
      })
      testDb.insertEntry({
        id: 2,
        userId: OWNER,
        category: 'topics',
        slug: 'cooking',
      })

      const { tools } = build()
      const output = await tools.memory_list!.execute(
        { category: 'people' },
        toolOptions,
      )

      expect(output.entries.map((entry: any) => entry.handle)).toEqual([
        'people/anna',
      ])
    })

    it('always hides special entries, whatever the sensitive setting',
      async () => {
        testDb.insertEntry({
          id: 1,
          userId: OWNER,
          slug: 'diagnosis',
          sensitivity: 'special',
          sensitiveCategory: 'health',
        })
        testDb.insertEntry({ id: 2, userId: OWNER, slug: 'cooking' })

        for (const setting of [true, false, null]) {
          testDb.sqlite.prepare('delete from user_settings').run()
          testDb.insertUserSettings({
            userId: OWNER,
            memoryIncludeSensitive: setting,
          })

          const listed = await build().tools.memory_list!.execute(
            {},
            toolOptions,
          )

          expect(listed.entries.map((entry: any) => entry.handle)).toEqual([
            'topics/cooking',
          ])
        }
      })

    it('caps the list and returns an empty list for an empty memory',
      async () => {
        const empty = await build().tools.memory_list!.execute({}, toolOptions)

        expect(empty.entries).toEqual([])
        expect(MEMORY_LIST_MAX_ENTRIES).toBeGreaterThanOrEqual(45)
      })

    it('stamps lastUsedAt without touching updatedAt', async () => {
      testDb.insertEntry({
        id: 1,
        userId: OWNER,
        slug: 'cooking',
        updatedAt: OLD_TIMESTAMP,
      })
      testDb.insertEntry({
        id: 2,
        userId: STRANGER,
        slug: 'cooking',
        updatedAt: OLD_TIMESTAMP,
      })

      await build().tools.memory_list!.execute({}, toolOptions)

      expect(readRow(1)?.last_used_at).toBeGreaterThan(OLD_TIMESTAMP)
      expect(readRow(1)?.updated_at).toBe(OLD_TIMESTAMP)
      expect(readRow(2)?.last_used_at).toBeNull()
    })

    it('still returns the list when the lastUsedAt update fails', async () => {
      testDb.insertEntry({ id: 1, userId: OWNER, slug: 'cooking' })

      const failingDb = new Proxy(testDb.db, {
        get(target, property) {
          if (property === 'update') {
            return () => {
              throw new Error('d1 unavailable')
            }
          }

          return Reflect.get(target, property)
        },
      })
      const { tools } = build({ db: failingDb })
      const output = await tools.memory_list!.execute({}, toolOptions)

      expect(output.entries).toHaveLength(1)
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: {
          memoryLastUsed: { error: 'd1 unavailable' },
        },
      })
    })
  })

  describe('memory_read', () => {
    beforeEach(() => {
      testDb.insertEntry({
        id: 1,
        userId: OWNER,
        category: 'preferences',
        slug: 'preferences',
        title: 'Style',
        body: 'Short answers.',
        updatedAt: OLD_TIMESTAMP,
      })
      testDb.insertEntry({
        id: 2,
        userId: OWNER,
        projectId: PROJECT_ID,
        slug: 'launch-plan',
        title: 'Launch plan',
        body: 'Ship on Friday.',
      })
    })

    it('reads an entry by public id', async () => {
      const output = await build().tools.memory_read!.execute(
        { id: encodePublicId(1) },
        toolOptions,
      )

      expect(output).toEqual({
        notice: MEMORY_TOOL_NOTICE,
        entry: {
          id: encodePublicId(1),
          handle: 'preferences/preferences',
          scope: 'account',
          category: 'preferences',
          title: 'Style',
          description: 'About preferences',
          body: 'Short answers.',
        },
      })
    })

    it('resolves an account handle and a project handle', async () => {
      const { tools } = build({ projectId: PROJECT_ID })
      const account = await tools.memory_read!.execute(
        { id: 'preferences/preferences' },
        toolOptions,
      )
      const project = await tools.memory_read!.execute(
        { id: 'project/topics/launch-plan' },
        toolOptions,
      )

      expect(account.entry.id).toBe(encodePublicId(1))
      expect(project.entry).toMatchObject({
        id: encodePublicId(2),
        scope: 'project',
        body: 'Ship on Friday.',
      })
    })

    it('stamps lastUsedAt on the entry it read', async () => {
      await build().tools.memory_read!.execute(
        { id: 'preferences/preferences' },
        toolOptions,
      )

      expect(readRow(1)?.last_used_at).toBeGreaterThan(OLD_TIMESTAMP)
      expect(readRow(1)?.updated_at).toBe(OLD_TIMESTAMP)
    })

    it.each([
      ['an unknown id', 'nonexistent'],
      ['a handle with an unknown category', 'bogus/preferences'],
      ['a handle with too many segments', 'a/b/c/d'],
      ['an empty segment', 'preferences/'],
      ['a project handle in a chat without a project',
        'project/topics/launch-plan'],
      ['a missing slug', 'topics/missing'],
    ])('answers 404 for %s', async (_label, id) => {
      await expect(
        build().tools.memory_read!.execute({ id }, toolOptions),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('answers 404 for another user\'s entry id and handle', async () => {
      testDb.insertEntry({ id: 3, userId: STRANGER, slug: 'secret' })

      const { tools } = build()

      await expect(
        tools.memory_read!.execute({ id: encodePublicId(3) }, toolOptions),
      ).rejects.toMatchObject({ status: 404 })
      await expect(
        tools.memory_read!.execute({ id: 'topics/secret' }, toolOptions),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('answers 404 for a project entry outside the chat project',
      async () => {
        testDb.insertEntry({
          id: 4,
          userId: OWNER,
          projectId: OTHER_PROJECT_ID,
          slug: 'other-project',
        })

        const { tools } = build({ projectId: PROJECT_ID })

        await expect(
          tools.memory_read!.execute({ id: encodePublicId(4) }, toolOptions),
        ).rejects.toMatchObject({ status: 404 })
        await expect(
          tools.memory_read!.execute({ id: encodePublicId(2) }, toolOptions),
        ).resolves.toBeDefined()
      })

    it('answers 404 for an account entry in a separate-memory project',
      async () => {
        await expect(
          build({ projectId: PROJECT_ID, useAccountMemory: false })
            .tools.memory_read!.execute(
            { id: encodePublicId(1) },
            toolOptions,
          ),
        ).rejects.toMatchObject({ status: 404 })
      })

    it('always hides a special entry, whatever the sensitive setting',
      async () => {
        testDb.insertEntry({
          id: 5,
          userId: OWNER,
          slug: 'diagnosis',
          sensitivity: 'special',
          sensitiveCategory: 'health',
        })

        testDb.insertUserSettings({
          userId: OWNER,
          memoryIncludeSensitive: true,
        })

        for (const id of [encodePublicId(5), 'topics/diagnosis']) {
          await expect(
            build().tools.memory_read!.execute({ id }, toolOptions),
          ).rejects.toMatchObject({ status: 404 })
        }
      })
  })

  describe('user request quote gate', () => {
    it('normalises case, punctuation, whitespace and compatibility forms',
      () => {
        expect(normalizeUserRequestText('  Remember,   THIS!! ')).toBe(
          'rememberthis',
        )
        expect(normalizeUserRequestText('ｆｕｌｌ—ｗｉｄｔｈ')).toBe(
          'fullwidth',
        )
        expect(normalizeUserRequestText('Запам\'ятай: я люблю борщ.')).toBe(
          'запамятайялюблюборщ',
        )
      })

    it('accepts a verbatim quote and one that differs by case, spacing '
      + 'and punctuation', () => {
      expect(() => {
        assertUserRequestQuote(DEFAULT_QUOTE, DEFAULT_MESSAGE)
      }).not.toThrow()
      expect(() => {
        assertUserRequestQuote(
          'REMEMBER  that I cook pasta, twice a week!',
          DEFAULT_MESSAGE,
        )
      }).not.toThrow()
    })

    it('accepts a Ukrainian quote across typographic apostrophes', () => {
      expect(() => {
        assertUserRequestQuote(
          'Запамʼятай, що я люблю борщ',
          'Будь ласка, запам\'ятай що я люблю БОРЩ.',
        )
      }).not.toThrow()
    })

    it('rejects a quote that is not in the message', () => {
      expect(() => {
        assertUserRequestQuote('forget everything about me', DEFAULT_MESSAGE)
      }).toThrow(/does not appear/)
    })

    it('rejects a quote under four characters after normalising', () => {
      expect(() => {
        assertUserRequestQuote('a b!', 'a b! and more text')
      }).toThrow(/wrong length/)
      expect(() => {
        assertUserRequestQuote('...?!', DEFAULT_MESSAGE)
      }).toThrow(/wrong length/)
    })

    it('rejects a quote over three hundred characters', () => {
      const longQuote = 'a'.repeat(301)

      expect(() => {
        assertUserRequestQuote(longQuote, longQuote)
      }).toThrow(/wrong length/)
    })

    it('rejects every quote when the message is missing', () => {
      expect(() => {
        assertUserRequestQuote(DEFAULT_QUOTE, null)
      }).toThrow(/does not appear/)
    })

    it('requires the whole short message when it has fewer than twelve '
      + 'characters', () => {
      expect(() => {
        assertUserRequestQuote('forget it', 'Forget it.')
      }).not.toThrow()
      expect(() => {
        assertUserRequestQuote('forget', 'Forget it.')
      }).toThrow(/wrong length/)
    })

    it('accepts a slice of a long message that reaches twelve characters', () => {
      expect(() => {
        assertUserRequestQuote('cook pasta twice', DEFAULT_MESSAGE)
      }).not.toThrow()
    })

    it('rejects the four-character substring bypass of a long message', () => {
      expect(() => {
        assertUserRequestQuote('cook', DEFAULT_MESSAGE)
      }).toThrow(/wrong length/)
      expect(() => {
        assertUserRequestQuote('pasta', DEFAULT_MESSAGE)
      }).toThrow(/wrong length/)
      expect(() => {
        assertUserRequestQuote('pasta twice a week', DEFAULT_MESSAGE)
      }).not.toThrow()
    })

    it('never accepts a quote under four characters, even for a tiny '
      + 'message', () => {
      expect(() => {
        assertUserRequestQuote('ok', 'ok')
      }).toThrow(/wrong length/)
    })

    it('tells the model to quote the whole request sentence', () => {
      let thrown: Error | undefined

      try {
        assertUserRequestQuote('cook', DEFAULT_MESSAGE)
      } catch (exception) {
        thrown = exception as Error
      }

      expect((thrown as Error & { fix?: string }).fix)
        .toContain('whole request sentence')
    })

    it('rejects a short quote through the tool and keeps the entry',
      async () => {
        testDb.insertEntry({ id: 1, userId: OWNER, slug: 'cooking' })

        await expect(
          build().tools.memory_forget!.execute(
            { id: encodePublicId(1), userRequestQuote: 'cook' },
            toolOptions,
          ),
        ).rejects.toMatchObject({ status: 400 })
        expect(readRow(1)).toBeDefined()
      })
  })

  describe('memory_write', () => {
    it('creates an account entry owned by the tool with its provenance',
      async () => {
        const { tools } = build()
        const output = await tools.memory_write!.execute(
          writeInput(),
          toolOptions,
        )

        expect(output).toMatchObject({
          notice: MEMORY_TOOL_NOTICE,
          action: 'created',
          entry: {
            handle: 'topics/cooking',
            scope: 'account',
            category: 'topics',
            title: 'Cooking',
            description: 'Likes to cook pasta',
          },
        })
        expect(output.previous).toBeUndefined()

        const row = readRowBySlug('cooking')

        expect(row).toMatchObject({
          user_id: OWNER,
          project_id: null,
          origin: 'tool',
          source_message_id: MESSAGE_ID,
          body: 'Cooks pasta twice a week.',
        })
        expect(JSON.parse(row?.source_chat_ids)).toEqual([CHAT_ID])
      })

    it('creates a project entry in a project chat', async () => {
      const { tools } = build({ projectId: PROJECT_ID })
      const output = await tools.memory_write!.execute(
        writeInput({ scope: 'project', title: 'Launch plan' }),
        toolOptions,
      )

      expect(output.entry).toMatchObject({
        scope: 'project',
        handle: 'project/topics/launch-plan',
      })
      expect(readRowBySlug('launch-plan')?.project_id).toBe(PROJECT_ID)
    })

    it('answers 400 for project scope in a chat without a project',
      async () => {
        await expect(
          build().tools.memory_write!.execute(
            writeInput({ scope: 'project' }),
            toolOptions,
          ),
        ).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining('project chat'),
        })
        expect(testDb.countEntries()).toBe(0)
      })

    it('defaults to project scope and refuses account scope in a project '
      + 'that keeps its memory separate', async () => {
      const { tools } = build({
        projectId: PROJECT_ID,
        useAccountMemory: false,
      })
      const created = await tools.memory_write!.execute(
        writeInput(),
        toolOptions,
      )

      expect(created.entry.scope).toBe('project')
      await expect(
        tools.memory_write!.execute(
          writeInput({ scope: 'account', title: 'Other' }),
          toolOptions,
        ),
      ).rejects.toMatchObject({ status: 400 })
      expect(testDb.countEntries()).toBe(1)
    })

    it('ignores a projectId, origin and slug the model tries to force',
      async () => {
        const { tools } = build()
        const output = await tools.memory_write!.execute(
          writeInput({
            projectId: encodePublicId(STRANGER_PROJECT_ID),
            origin: 'user',
            slug: 'forced-slug',
            sourceChatIds: ['forged'],
            sourceMessageId: 'forged',
          }),
          toolOptions,
        )
        const row = readRowBySlug('cooking')

        expect(output.entry.scope).toBe('account')
        expect(row).toMatchObject({
          project_id: null,
          origin: 'tool',
          source_message_id: MESSAGE_ID,
        })
        expect(readRowBySlug('forced-slug')).toBeUndefined()
        expect(JSON.parse(row?.source_chat_ids)).toEqual([CHAT_ID])
      })

    it('rejects a quote that is not in the current message and writes '
      + 'nothing', async () => {
      const { tools } = build()

      await expect(
        tools.memory_write!.execute(
          writeInput({ userRequestQuote: 'I secretly love jazz music' }),
          toolOptions,
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('verbatim'),
      })
      expect(testDb.countEntries()).toBe(0)
    })

    it('accepts a Ukrainian quote and stores Ukrainian content', async () => {
      const { tools } = build({
        userMessageText: 'Запам\'ятай, будь ласка: я люблю борщ.',
      })
      const output = await tools.memory_write!.execute(
        writeInput({
          title: 'Улюблена страва',
          description: 'Любить борщ',
          body: 'Любить борщ.',
          userRequestQuote: 'запамятай будь ласка я люблю борщ',
        }),
        toolOptions,
      )

      expect(output.entry.handle).toBe('topics/uliublena-strava')
      expect(output.action).toBe('created')
    })

    it('updates the entry with the same title slug and returns the '
      + 'previous values', async () => {
      const { tools } = build()

      await tools.memory_write!.execute(writeInput(), toolOptions)

      const output = await tools.memory_write!.execute(
        writeInput({
          body: 'Cooks pasta and risotto.',
          description: 'Likes pasta and risotto',
        }),
        toolOptions,
      )

      expect(output.action).toBe('updated')
      expect(output.previous).toEqual({
        category: 'topics',
        title: 'Cooking',
        description: 'Likes to cook pasta',
        body: 'Cooks pasta twice a week.',
        sensitivity: 'none',
        sensitiveCategory: null,
      })
      expect(testDb.countEntries()).toBe(1)
      expect(readRowBySlug('cooking')?.body).toBe('Cooks pasta and risotto.')
    })

    it('treats the profile category as one entry per scope', async () => {
      const { tools } = build()

      await tools.memory_write!.execute(
        writeInput({ category: 'profile', title: 'Me', body: 'First.' }),
        toolOptions,
      )

      const second = await tools.memory_write!.execute(
        writeInput({
          category: 'profile',
          title: 'A different title',
          body: 'Second.',
        }),
        toolOptions,
      )

      expect(second.action).toBe('updated')
      expect(second.entry.handle).toBe('profile/profile')
      expect(testDb.countEntries()).toBe(1)
    })

    it('updates by id, marks the entry as tool-written and merges the '
      + 'source chats', async () => {
      testDb.insertEntry({
        id: 1,
        userId: OWNER,
        slug: 'cooking',
        title: 'Cooking',
        origin: 'extraction',
        sourceChatIds: [OLDER_CHAT_ID],
        sourceMessageId: 'older-message',
      })

      const { tools } = build()
      const output = await tools.memory_write!.execute(
        writeInput({ id: encodePublicId(1), body: 'Merged body.' }),
        toolOptions,
      )
      const row = readRow(1)

      expect(output.action).toBe('updated')
      expect(output.entry.id).toBe(encodePublicId(1))
      expect(row).toMatchObject({
        origin: 'tool',
        source_message_id: MESSAGE_ID,
        body: 'Merged body.',
      })
      expect(JSON.parse(row?.source_chat_ids)).toEqual([
        OLDER_CHAT_ID,
        CHAT_ID,
      ])
    })

    it('updates by handle and does not duplicate the current chat in the '
      + 'sources', async () => {
      testDb.insertEntry({
        id: 1,
        userId: OWNER,
        slug: 'cooking',
        sourceChatIds: [CHAT_ID],
      })

      await build().tools.memory_write!.execute(
        writeInput({ id: 'topics/cooking' }),
        toolOptions,
      )

      expect(JSON.parse(readRow(1)?.source_chat_ids)).toEqual([CHAT_ID])
    })

    it('answers 404 for an id of another user and changes nothing',
      async () => {
        testDb.insertEntry({
          id: 1,
          userId: STRANGER,
          slug: 'cooking',
          body: 'Untouched.',
        })

        await expect(
          build().tools.memory_write!.execute(
            writeInput({ id: encodePublicId(1) }),
            toolOptions,
          ),
        ).rejects.toMatchObject({ status: 404 })
        expect(readRow(1)?.body).toBe('Untouched.')
      })

    it('answers 404 for an id outside the chat project', async () => {
      testDb.insertEntry({
        id: 1,
        userId: OWNER,
        projectId: OTHER_PROJECT_ID,
        slug: 'cooking',
        body: 'Untouched.',
      })

      await expect(
        build({ projectId: PROJECT_ID }).tools.memory_write!.execute(
          writeInput({ id: encodePublicId(1) }),
          toolOptions,
        ),
      ).rejects.toMatchObject({ status: 404 })
      expect(readRow(1)?.body).toBe('Untouched.')
    })

    it('never updates an account entry of a separate-memory project',
      async () => {
        testDb.insertEntry({
          id: 1,
          userId: OWNER,
          slug: 'cooking',
          body: 'Untouched.',
        })

        await expect(
          build({ projectId: PROJECT_ID, useAccountMemory: false })
            .tools.memory_write!.execute(
            writeInput({ id: 'topics/cooking' }),
            toolOptions,
          ),
        ).rejects.toMatchObject({ status: 404 })
        expect(readRow(1)?.body).toBe('Untouched.')
      })

    it('turns a never-store hit into a tool error that names the kind '
      + 'but not the content', async () => {
      const { tools } = build({
        userMessageText: `Remember my card ${CARD_NUMBER} please`,
      })
      const rejection = tools.memory_write!.execute(
        writeInput({
          body: `Card ${CARD_NUMBER}`,
          userRequestQuote: 'Remember my card',
        }),
        toolOptions,
      )

      await expect(rejection).rejects.toMatchObject({
        status: 422,
        message: expect.stringContaining('payment-card'),
      })
      await expect(rejection).rejects.not.toMatchObject({
        message: expect.stringContaining('4111'),
      })
      expect(testDb.countEntries()).toBe(0)
      expect(loggerSet).toHaveBeenCalled()
    })

    it('does not let the model label sensitive attributes', () => {
      const { tools } = build()
      const inputSchema = (tools.memory_write as any).inputSchema as {
        shape: Record<string, unknown>
        parse: (value: unknown) => Record<string, unknown>
      }

      expect(Object.keys(inputSchema.shape).sort()).toEqual([
        'body',
        'category',
        'description',
        'id',
        'scope',
        'title',
        'userRequestQuote',
      ])
      expect(inputSchema.parse(writeInput({
        sensitivity: 'none',
        sensitiveCategory: null,
      }))).not.toHaveProperty('sensitivity')
      expect(inputSchema.parse(writeInput({
        sensitivity: 'none',
        sensitiveCategory: null,
      }))).not.toHaveProperty('sensitiveCategory')
    })

    describe.each([
      { label: 'true', setting: true },
      { label: 'false', setting: false },
      { label: 'null', setting: null },
      { label: 'no settings row', setting: undefined },
    ])('with memoryIncludeSensitive $label', ({ setting }) => {
      beforeEach(() => {
        if (setting !== undefined) {
          testDb.insertUserSettings({
            userId: OWNER,
            memoryIncludeSensitive: setting,
          })
        }
      })

      it('refuses health text and stores nothing', async () => {
        const failure = await build().tools.memory_write!.execute(
          writeInput({
            title: 'Health',
            description: 'Diet constraints',
            body: 'I have type 2 diabetes.',
          }),
          toolOptions,
        ).catch((exception: Error) => exception)

        expect(failure).toMatchObject({
          status: 422,
          message: expect.stringContaining(
            'Sensitive topics (health, religion, politics…) are not saved '
            + 'to memory.',
          ),
        })
        expect((failure as Error).message).toContain('(health)')
        expect((failure as Error).message).toContain(
          'Remove the sensitive details and save again.',
        )
        expect((failure as Error).message).not.toContain('diabetes')
        expect(testDb.countEntries()).toBe(0)
      })

      it('refuses an update that adds health words and keeps the entry',
        async () => {
          testDb.insertEntry({ id: 1, userId: OWNER, slug: 'cooking' })

          await expect(
            build().tools.memory_write!.execute(
              writeInput({
                id: 'topics/cooking',
                body: 'I have type 2 diabetes.',
              }),
              toolOptions,
            ),
          ).rejects.toMatchObject({ status: 422 })
          expect(readRow(1)).toMatchObject({
            sensitivity: 'none',
            sensitive_category: null,
            body: 'Body of cooking',
          })
        })

      it('refuses health text in a people note under the same rule',
        async () => {
          const failure = await build().tools.memory_write!.execute(
            writeInput({
              category: 'people',
              title: 'Anna',
              description: 'Sister',
              body: 'Anna has type 2 diabetes.',
            }),
            toolOptions,
          ).catch((exception: Error) => exception)

          expect(failure).toMatchObject({
            status: 422,
            message: expect.stringContaining('Sensitive topics'),
          })
          expect((failure as Error).message).toContain('(health)')
          expect((failure as Error).message).not.toContain('diabetes')
          expect(testDb.countEntries()).toBe(0)
        })

      it.each([
        ['topics', 'Diet constraints', 'Prefers vegetarian food.'],
        ['topics', 'Church Street address', 'Delivery goes to Church Street.'],
        ['people', 'Anna', 'Anna: sister, lives in Lviv.'],
      ])('stores clean %s text "%s" as none with no category',
        async (category, title, body) => {
          const output = await build().tools.memory_write!.execute(
            writeInput({ category, title, description: 'Clean note', body }),
            toolOptions,
          )

          expect(output.action).toBe('created')
          expect(readRow(1)).toMatchObject({
            category,
            sensitivity: 'none',
            sensitive_category: null,
          })
        })

      it('does not overwrite a hidden legacy special entry with clean text',
        async () => {
          testDb.insertEntry({
            id: 1,
            userId: OWNER,
            slug: 'cooking',
            title: 'Cooking',
            body: 'Hidden legacy note.',
            sensitivity: 'special',
            sensitiveCategory: 'health',
          })

          const output = await build().tools.memory_write!.execute(
            writeInput(),
            toolOptions,
          )

          expect(output.action).toBe('created')
          expect(output.entry.handle).toBe('topics/cooking-2')
          expect(readRow(1)).toMatchObject({
            sensitivity: 'special',
            sensitive_category: 'health',
            body: 'Hidden legacy note.',
          })
        })
    })

    it('puts the why and the fix of a service error into the message the '
      + 'model sees', async () => {
      await expect(
        build().tools.memory_write!.execute(
          writeInput({
            category: 'profile',
            body: 'x'.repeat(
              MEMORY_LIMITS.maxAlwaysInjectedBodyBytes + 100,
            ),
          }),
          toolOptions,
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining(
          `${MEMORY_LIMITS.maxAlwaysInjectedBodyBytes} bytes`,
        ),
      })
    })

    it('never overwrites a hidden special entry through the title slug',
      async () => {
        testDb.insertEntry({
          id: 1,
          userId: OWNER,
          slug: 'diagnosis',
          title: 'Diagnosis',
          body: 'Hidden health note.',
          sensitivity: 'special',
          sensitiveCategory: 'health',
        })

        const output = await build().tools.memory_write!.execute(
          writeInput({
            title: 'Diagnosis',
            userRequestQuote: DEFAULT_QUOTE,
          }),
          toolOptions,
        )

        expect(output.action).toBe('created')
        expect(output.entry.handle).toBe('topics/diagnosis-2')
        expect(readRow(1)).toMatchObject({
          sensitivity: 'special',
          sensitive_category: 'health',
          body: 'Hidden health note.',
        })
      })

    it('answers 409 instead of overwriting a hidden special singleton',
      async () => {
        testDb.insertEntry({
          id: 1,
          userId: OWNER,
          category: 'profile',
          slug: 'profile',
          body: 'Hidden health note.',
          sensitivity: 'special',
          sensitiveCategory: 'health',
        })

        await expect(
          build().tools.memory_write!.execute(
            writeInput({ category: 'profile' }),
            toolOptions,
          ),
        ).rejects.toMatchObject({ status: 409 })
        expect(readRow(1)).toMatchObject({
          sensitivity: 'special',
          body: 'Hidden health note.',
        })
      })

    it('folds the why and the fix into the message exactly once',
      async () => {
        const failure = await build().tools.memory_write!.execute(
          writeInput({ userRequestQuote: 'I secretly love jazz music' }),
          toolOptions,
        ).catch((exception: Error) => exception)

        expect(failure).toBeInstanceOf(Error)

        const message = (failure as Error).message

        expect(message.match(/verbatim/g)).toHaveLength(1)
        expect(message).toContain('does not appear')
        expect(message).toContain('not a quote of the user')
      })

    it('answers a neutral 409 that does not reveal a hidden special '
      + 'singleton', async () => {
      testDb.insertEntry({
        id: 1,
        userId: OWNER,
        category: 'profile',
        slug: 'profile',
        body: 'Hidden health note.',
        sensitivity: 'special',
        sensitiveCategory: 'health',
      })

      const failure = await build().tools.memory_write!.execute(
        writeInput({ category: 'profile' }),
        toolOptions,
      ).catch((exception: Error) => exception)

      expect(failure).toMatchObject({
        status: 409,
        message: 'The memory entry could not be saved',
      })
      expect((failure as Error).message).not.toMatch(/already exists|profile/)
    })

    it('updates a visible singleton instead of answering 409', async () => {
      testDb.insertEntry({
        id: 1,
        userId: OWNER,
        category: 'profile',
        slug: 'profile',
        body: 'Visible note.',
      })

      const output = await build().tools.memory_write!.execute(
        writeInput({ category: 'profile' }),
        toolOptions,
      )

      expect(output.action).toBe('updated')
    })

    it('answers 409 when the account memory is full', async () => {
      for (let index = 0; index < 30; index++) {
        testDb.insertEntry({ userId: OWNER, slug: `seed-${index}` })
      }

      await expect(
        build().tools.memory_write!.execute(writeInput(), toolOptions),
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining('Memory limit reached'),
      })
    })

    it('answers a created entry for a title whose slug is taken by '
      + 'another user', async () => {
      testDb.insertEntry({ id: 1, userId: STRANGER, slug: 'cooking' })

      const output = await build().tools.memory_write!.execute(
        writeInput(),
        toolOptions,
      )

      expect(output.action).toBe('created')
      expect(readRow(1)?.user_id).toBe(STRANGER)
      expect(testDb.countEntries(OWNER)).toBe(1)
    })
  })

  describe('memory_forget', () => {
    beforeEach(() => {
      testDb.insertEntry({
        id: 1,
        userId: OWNER,
        slug: 'cooking',
        title: 'Cooking',
      })
    })

    it('deletes the entry by id after the quote gate passes', async () => {
      const output = await build({
        userMessageText: 'Please forget that I like cooking.',
      }).tools.memory_forget!.execute(
        {
          id: encodePublicId(1),
          userRequestQuote: 'forget that I like cooking',
        },
        toolOptions,
      )

      expect(output).toEqual({
        notice: MEMORY_TOOL_NOTICE,
        removed: {
          id: encodePublicId(1),
          handle: 'topics/cooking',
          scope: 'account',
          category: 'topics',
          title: 'Cooking',
        },
      })
      expect(readRow(1)).toBeUndefined()
    })

    it('deletes by handle, including a project handle', async () => {
      testDb.insertEntry({
        id: 2,
        userId: OWNER,
        projectId: PROJECT_ID,
        slug: 'launch-plan',
        title: 'Launch plan',
      })

      const { tools } = build({
        projectId: PROJECT_ID,
        userMessageText: 'Forget the launch plan and the cooking note.',
      })
      const output = await tools.memory_forget!.execute(
        {
          id: 'project/topics/launch-plan',
          userRequestQuote: 'Forget the launch plan',
        },
        toolOptions,
      )

      expect(output.removed.scope).toBe('project')
      expect(readRow(2)).toBeUndefined()
      expect(readRow(1)).toBeDefined()
    })

    it('keeps the entry when the quote is not in the message', async () => {
      await expect(
        build().tools.memory_forget!.execute(
          {
            id: encodePublicId(1),
            userRequestQuote: 'please delete my cooking memory',
          },
          toolOptions,
        ),
      ).rejects.toMatchObject({ status: 400 })
      expect(readRow(1)).toBeDefined()
    })

    it('answers 404 for another user\'s entry and keeps it', async () => {
      testDb.insertEntry({ id: 3, userId: STRANGER, slug: 'secret' })

      await expect(
        build({ userMessageText: 'Forget the secret entry' })
          .tools.memory_forget!.execute(
          {
            id: encodePublicId(3),
            userRequestQuote: 'Forget the secret entry',
          },
          toolOptions,
        ),
      ).rejects.toMatchObject({ status: 404 })
      expect(readRow(3)).toBeDefined()
    })

    it('answers 404 for a hidden special entry and keeps it', async () => {
      testDb.insertUserSettings({
        userId: OWNER,
        memoryIncludeSensitive: true,
      })
      testDb.insertEntry({
        id: 4,
        userId: OWNER,
        slug: 'diagnosis',
        sensitivity: 'special',
        sensitiveCategory: 'health',
      })

      await expect(
        build({ userMessageText: 'Forget my diagnosis' })
          .tools.memory_forget!.execute(
          {
            id: 'topics/diagnosis',
            userRequestQuote: 'Forget my diagnosis',
          },
          toolOptions,
        ),
      ).rejects.toMatchObject({ status: 404 })
      expect(readRow(4)).toBeDefined()
    })

    it('answers 404 for an account entry in a separate-memory project',
      async () => {
        await expect(
          build({
            projectId: PROJECT_ID,
            useAccountMemory: false,
            userMessageText: 'Forget the cooking note',
          }).tools.memory_forget!.execute(
            {
              id: encodePublicId(1),
              userRequestQuote: 'Forget the cooking note',
            },
            toolOptions,
          ),
        ).rejects.toMatchObject({ status: 404 })
        expect(readRow(1)).toBeDefined()
      })
  })

  describe('project memory turned off', () => {
    const FORGET_MESSAGE = 'Forget the launch plan and the cooking note.'

    beforeEach(() => {
      testDb.insertEntry({ id: 1, userId: OWNER, slug: 'account-one' })
      testDb.insertEntry({
        id: 2,
        userId: OWNER,
        projectId: PROJECT_ID,
        slug: 'launch-plan',
        title: 'Launch plan',
      })
    })

    it('refuses an explicit project-scope write and writes nothing',
      async () => {
        const { tools } = build({
          projectId: PROJECT_ID,
          projectDisabled: true,
        })

        await expect(
          tools.memory_write!.execute(
            writeInput({ scope: 'project', title: 'Roadmap' }),
            toolOptions,
          ),
        ).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining('Project memory is turned off'),
        })
        expect(testDb.countEntries()).toBe(2)
      })

    it('refuses the default project scope of a separate-memory project',
      async () => {
        const { tools } = build({
          projectId: PROJECT_ID,
          projectDisabled: true,
          useAccountMemory: false,
        })

        await expect(
          tools.memory_write!.execute(writeInput(), toolOptions),
        ).rejects.toMatchObject({
          status: 400,
          message: expect.stringContaining('Project memory is turned off'),
        })
        expect(testDb.countEntries()).toBe(2)
      })

    it('keeps writing account memory', async () => {
      const { tools } = build({
        projectId: PROJECT_ID,
        projectDisabled: true,
        useAccountMemory: true,
      })
      const output = await tools.memory_write!.execute(
        writeInput({ scope: 'account', title: 'Roadmap' }),
        toolOptions,
      )

      expect(output.entry.scope).toBe('account')
      expect(readRowBySlug('roadmap')?.project_id).toBeNull()
    })

    it('refuses to update a project entry by id and keeps it unchanged',
      async () => {
        const { tools } = build({
          projectId: PROJECT_ID,
          projectDisabled: true,
        })

        await expect(
          tools.memory_write!.execute(
            writeInput({ id: encodePublicId(2), title: 'Launch plan' }),
            toolOptions,
          ),
        ).rejects.toMatchObject({ status: 404 })
        expect(readRow(2)?.body).not.toBe('Cooks pasta twice a week.')
      })

    it('lists account entries only', async () => {
      const { tools } = build({
        projectId: PROJECT_ID,
        projectDisabled: true,
      })
      const output = await tools.memory_list!.execute({}, toolOptions)

      expect(output.entries.map((entry: any) => entry.handle)).toEqual([
        'topics/account-one',
      ])
    })

    it('refuses to read a project entry by handle and by id', async () => {
      const { tools } = build({
        projectId: PROJECT_ID,
        projectDisabled: true,
      })

      await expect(
        tools.memory_read!.execute(
          { id: 'project/topics/launch-plan' },
          toolOptions,
        ),
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('Project memory is turned off'),
      })
      await expect(
        tools.memory_read!.execute({ id: encodePublicId(2) }, toolOptions),
      ).rejects.toMatchObject({ status: 404 })
    })

    it('still reads an account entry', async () => {
      const { tools } = build({
        projectId: PROJECT_ID,
        projectDisabled: true,
      })
      const output = await tools.memory_read!.execute(
        { id: 'topics/account-one' },
        toolOptions,
      )

      expect(output.entry.scope).toBe('account')
    })

    it('refuses to forget a project entry and keeps it', async () => {
      const { tools } = build({
        projectId: PROJECT_ID,
        projectDisabled: true,
        userMessageText: FORGET_MESSAGE,
      })

      await expect(
        tools.memory_forget!.execute(
          {
            id: 'project/topics/launch-plan',
            userRequestQuote: 'Forget the launch plan',
          },
          toolOptions,
        ),
      ).rejects.toMatchObject({ status: 400 })
      await expect(
        tools.memory_forget!.execute(
          {
            id: encodePublicId(2),
            userRequestQuote: 'Forget the launch plan',
          },
          toolOptions,
        ),
      ).rejects.toMatchObject({ status: 404 })
      expect(readRow(2)).toBeDefined()
    })

    it('still forgets an account entry', async () => {
      const { tools } = build({
        projectId: PROJECT_ID,
        projectDisabled: true,
        userMessageText: 'Please forget the account note.',
      })
      const output = await tools.memory_forget!.execute(
        {
          id: encodePublicId(1),
          userRequestQuote: 'forget the account note',
        },
        toolOptions,
      )

      expect(output.removed.scope).toBe('account')
      expect(readRow(1)).toBeUndefined()
    })

    it('leaves project scope working when projectDisabled is false or '
      + 'omitted', async () => {
      for (const projectDisabled of [false, undefined]) {
        const { tools } = build({ projectId: PROJECT_ID, projectDisabled })
        const output = await tools.memory_write!.execute(
          writeInput({
            scope: 'project',
            title: `Roadmap ${String(projectDisabled)}`,
          }),
          toolOptions,
        )

        expect(output.entry.scope).toBe('project')
      }
    })
  })

  describe('untrusted content guard', () => {
    beforeEach(() => {
      testDb.insertEntry({
        id: 1,
        userId: OWNER,
        slug: 'cooking',
        title: 'Cooking',
      })
    })

    it('starts unlocked, so write and forget work before any untrusted '
      + 'result', async () => {
      const { tools, budget } = build()

      expect(budget.untrustedResultSeen).toBe(false)

      const written = await tools.memory_write!.execute(
        writeInput({ title: 'Pasta' }),
        toolOptions,
      )

      expect(written.action).toBe('created')

      const forgotten = await tools.memory_forget!.execute(
        { id: encodePublicId(1), userRequestQuote: DEFAULT_QUOTE },
        toolOptions,
      )

      expect(forgotten.removed.title).toBe('Cooking')
    })

    it('rejects memory_write with a 403 tool error and writes nothing',
      async () => {
        const budget = createChatSearchBudget()
        const { tools } = build({ budget })

        budget.untrustedResultSeen = true

        const failure = await tools.memory_write!.execute(
          writeInput(),
          toolOptions,
        ).catch((exception: Error) => exception)

        expect(failure).toMatchObject({ status: 403 })
        expect((failure as Error).message).toContain(
          'Memory writes are unavailable for the rest of this message',
        )
        expect((failure as Error).message).toContain('new message')
        expect(testDb.countEntries()).toBe(1)
      })

    it('rejects memory_forget with a 403 tool error and keeps the entry',
      async () => {
        const budget = createChatSearchBudget()
        const { tools } = build({ budget })

        budget.untrustedResultSeen = true

        await expect(
          tools.memory_forget!.execute(
            { id: encodePublicId(1), userRequestQuote: DEFAULT_QUOTE },
            toolOptions,
          ),
        ).rejects.toMatchObject({ status: 403 })
        expect(readRow(1)).toBeDefined()
      })

    it('still spends the budget on a guarded call', async () => {
      const budget = createChatSearchBudget()
      const { tools } = build({ budget })

      budget.untrustedResultSeen = true

      await expect(
        tools.memory_write!.execute(writeInput(), toolOptions),
      ).rejects.toMatchObject({ status: 403 })
      expect(budget.usedCalls).toBe(1)
    })

    it('keeps the read tools working after an untrusted result', async () => {
      const budget = createChatSearchBudget()
      const { tools } = build({ budget })

      budget.untrustedResultSeen = true

      const listed = await tools.memory_list!.execute({}, toolOptions)
      const read = await tools.memory_read!.execute(
        { id: 'topics/cooking' },
        toolOptions,
      )

      expect(listed.entries).toHaveLength(1)
      expect(read.entry.title).toBe('Cooking')
    })
  })

  describe('tool errors', () => {
    it('turns a non-evlog failure into a generic tool error without '
      + 'leaking its message', async () => {
      const failingDb = new Proxy(testDb.db, {
        get(target, property, receiver) {
          if (property === 'select' || property === 'query') {
            return () => {
              throw new Error(
                'Failed query: select "secret_column" from "memory_entries"',
              )
            }
          }

          return Reflect.get(target, property, receiver)
        },
      })
      const failure = await build({ db: failingDb as typeof testDb.db })
        .tools.memory_read!.execute({ id: 'topics/cooking' }, toolOptions)
        .catch((exception: Error) => exception)

      expect(failure).toMatchObject({
        status: 500,
        message: 'The memory service failed',
      })
      expect(JSON.stringify(failure)).not.toContain('secret_column')
      expect((failure as Error).message).not.toContain('Failed query')
    })
  })

  describe('tool descriptions', () => {
    it('states the shared call limit from the constant in every tool',
      () => {
        const { tools } = build()

        for (const [name, entry] of Object.entries(tools)) {
          expect(
            (entry as unknown as { description: string }).description,
            name,
          ).toContain(
            `At most ${CHAT_SEARCH_MAX_CALLS_PER_TURN} calls per message`,
          )
        }
      })
  })

  describe('shared call budget', () => {
    it('spends one call per tool and answers 429 after three, across '
      + 'memory and chat-search calls', async () => {
      testDb.insertEntry({ id: 1, userId: OWNER, slug: 'cooking' })

      const budget = createChatSearchBudget()
      const { tools } = build({ budget })

      consumeChatSearchCall(budget)

      await tools.memory_list!.execute({}, toolOptions)
      await tools.memory_read!.execute({ id: 'topics/cooking' }, toolOptions)

      expect(budget.usedCalls).toBe(3)

      await expect(
        tools.memory_list!.execute({}, toolOptions),
      ).rejects.toMatchObject({ status: 429 })
      await expect(
        tools.memory_write!.execute(writeInput(), toolOptions),
      ).rejects.toMatchObject({ status: 429 })
      await expect(
        tools.memory_forget!.execute(
          { id: 'topics/cooking', userRequestQuote: DEFAULT_QUOTE },
          toolOptions,
        ),
      ).rejects.toMatchObject({ status: 429 })
      expect(testDb.countEntries()).toBe(1)
    })

    it('counts a failed call against the budget', async () => {
      const budget = createChatSearchBudget()
      const { tools } = build({ budget })

      await expect(
        tools.memory_read!.execute({ id: 'nope' }, toolOptions),
      ).rejects.toMatchObject({ status: 404 })
      expect(budget.usedCalls).toBe(1)
    })
  })

  describe('buildMemoryHandle', () => {
    it('builds account and project handles', () => {
      expect(buildMemoryHandle({
        projectId: null,
        category: 'people',
        slug: 'anna',
      })).toBe('people/anna')
      expect(buildMemoryHandle({
        projectId: encodePublicId(7),
        category: 'topics',
        slug: 'launch-plan',
      })).toBe('project/topics/launch-plan')
    })
  })
})

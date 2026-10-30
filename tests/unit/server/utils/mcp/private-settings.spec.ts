import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryTestDb } from '../../../../setup/helpers/memory-db'
import type { MemoryTestDb } from '../../../../setup/helpers/memory-db'

const mocks = vi.hoisted(() => {
  return { applyUserSettingsUpdate: vi.fn() }
})

vi.mock('~~/server/utils/settings/apply-user-settings', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/settings/apply-user-settings')
  >()

  return {
    ...original,
    applyUserSettingsUpdate: mocks.applyUserSettingsUpdate,
  }
})

const USER = 7

describe('mcp settings tools', () => {
  let testDb: MemoryTestDb

  function seedSettings(columns: Record<string, string | number | null>) {
    const names = ['created_at', 'updated_at', 'user_id', ...Object.keys(columns)]
    const values = [1, 1, USER, ...Object.values(columns)]

    testDb.sqlite.prepare(
      `insert into user_settings (${names.join(', ')}) `
      + `values (${names.map(() => '?').join(', ')})`,
    ).run(...values)
  }

  async function load() {
    return await import('~~/server/utils/mcp/private/settings')
  }

  beforeEach(() => {
    vi.resetModules()
    mocks.applyUserSettingsUpdate.mockReset()
    mocks.applyUserSettingsUpdate.mockResolvedValue(undefined)
    testDb = createMemoryTestDb()
  })

  afterEach(() => {
    testDb.close()
  })

  describe('getMcpSettings', () => {
    it('returns the defaults of the web settings route without a row',
      async () => {
        const { getMcpSettings } = await load()

        expect(await getMcpSettings(testDb.db, USER)).toEqual({
          reasoningExpanded: false,
          reasoningAutoHide: true,
          defaultReasoningLevel: null,
          favoriteModels: [],
          favoriteGatewayModels: {},
          sidebarPinned: false,
          memoryEnabled: true,
          chatSearchEnabled: true,
          memoryExtractionEnabled: false,
          profileMemoryModel: null,
          projectMemoryModel: null,
        })
      })

    it('returns the stored values including the read-only fields',
      async () => {
        seedSettings({
          reasoning_expanded: 1,
          reasoning_auto_hide: 0,
          default_reasoning_level: 'high',
          sidebar_pinned: 1,
          favorite_models: JSON.stringify(['openai/gpt-5']),
          favorite_gateway_models: JSON.stringify({ vercel: ['a/b'] }),
          memory_enabled: 0,
          chat_search_enabled: 0,
          memory_extraction_enabled: 1,
          profile_memory_model: 'openai/gpt-5-mini',
          project_memory_model: 'google/gemini-flash',
        })

        const { getMcpSettings } = await load()
        const settings = await getMcpSettings(testDb.db, USER)

        expect(settings).toEqual({
          reasoningExpanded: true,
          reasoningAutoHide: false,
          defaultReasoningLevel: 'high',
          favoriteModels: ['openai/gpt-5'],
          favoriteGatewayModels: { vercel: ['a/b'] },
          sidebarPinned: true,
          memoryEnabled: false,
          chatSearchEnabled: false,
          memoryExtractionEnabled: true,
          profileMemoryModel: 'openai/gpt-5-mini',
          projectMemoryModel: 'google/gemini-flash',
        })
      })

    it('never exposes the private settings', async () => {
      seedSettings({
        about_me: 'secret about me',
        typesafe_roles: JSON.stringify({ a: true }),
        allow_external_links: 1,
        terms_version: 'v1',
      })

      const { getMcpSettings } = await load()
      const serialized = JSON.stringify(await getMcpSettings(testDb.db, USER))

      expect(serialized).not.toContain('secret about me')
      expect(serialized).not.toContain('typesafe')
      expect(serialized).not.toContain('aboutMe')
      expect(serialized).not.toContain('allowExternalLinks')
    })

    it('reads only the row of the given user', async () => {
      seedSettings({ sidebar_pinned: 1 })

      const { getMcpSettings } = await load()

      expect((await getMcpSettings(testDb.db, USER + 1)).sidebarPinned)
        .toBe(false)
    })
  })

  describe('updateMcpSettings', () => {
    it('applies a deduplicated update through the shared writer', async () => {
      const { updateMcpSettings } = await load()
      const result = await updateMcpSettings(testDb.db, USER, {
        reasoningExpanded: true,
        defaultReasoningLevel: null,
        favoriteModels: ['a/b', 'a/b', 'c/d'],
        favoriteGatewayModels: { openrouter: ['x/y', 'x/y'] },
        sidebarPinned: false,
        memoryEnabled: false,
        chatSearchEnabled: true,
      })
      const expectedUpdates = {
        reasoningExpanded: true,
        defaultReasoningLevel: null,
        favoriteModels: ['a/b', 'c/d'],
        favoriteGatewayModels: { openrouter: ['x/y'] },
        sidebarPinned: false,
        memoryEnabled: false,
        chatSearchEnabled: true,
      }

      expect(result).toEqual(expectedUpdates)
      expect(mocks.applyUserSettingsUpdate).toHaveBeenCalledWith({
        db: testDb.db,
        userId: USER,
        fieldUpdates: expectedUpdates,
      })
    })

    it('rejects every setting that authorises spend or moves data',
      async () => {
        const { updateMcpSettings } = await load()
        const excludedSettings = [
          { memoryExtractionEnabled: true },
          { profileMemoryModel: 'openai/gpt-5' },
          { profileMemoryGateway: 'vercel' },
          { projectMemoryModel: 'openai/gpt-5' },
          { projectMemoryGateway: 'vercel' },
          { typesafeRoles: { memoryCheck: true } },
          { aboutMe: null },
          { allowExternalLinks: true },
          { notificationPromptState: true },
          { memoryIncludeSensitive: true },
          { termsAcceptedAt: 1 },
        ]

        for (const excluded of excludedSettings) {
          await expect(updateMcpSettings(testDb.db, USER, {
            sidebarPinned: true,
            ...excluded,
          })).rejects.toMatchObject({ status: 400 })
        }

        expect(mocks.applyUserSettingsUpdate).not.toHaveBeenCalled()
      })

    it('rejects an unknown gateway key in the favorites', async () => {
      const { updateMcpSettings } = await load()

      await expect(updateMcpSettings(testDb.db, USER, {
        favoriteGatewayModels: { mystery: ['a/b'] },
      })).rejects.toMatchObject({ status: 400 })
    })

    it('rejects an empty update', async () => {
      const { updateMcpSettings } = await load()

      await expect(updateMcpSettings(testDb.db, USER, {}))
        .rejects.toMatchObject({ status: 400 })
      await expect(updateMcpSettings(testDb.db, USER, {
        sidebarPinned: undefined,
      })).rejects.toMatchObject({ status: 400 })
      expect(mocks.applyUserSettingsUpdate).not.toHaveBeenCalled()
    })

    it('rejects invalid values', async () => {
      const { updateMcpSettings } = await load()
      const invalidUpdates = [
        { sidebarPinned: 'yes' },
        { defaultReasoningLevel: 'extreme' },
        { favoriteModels: Array.from({ length: 51 }, (_item, index) => {
          return `model-${index}`
        }) },
        { favoriteModels: ['x'.repeat(101)] },
      ]

      for (const update of invalidUpdates) {
        await expect(updateMcpSettings(testDb.db, USER, update))
          .rejects.toMatchObject({ status: 400 })
      }

      expect(mocks.applyUserSettingsUpdate).not.toHaveBeenCalled()
    })

    it('refuses to turn memory on while it would resume extraction',
      async () => {
        seedSettings({ memory_enabled: 0, memory_extraction_enabled: 1 })

        const { updateMcpSettings } = await load()

        await expect(updateMcpSettings(testDb.db, USER, {
          memoryEnabled: true,
        })).rejects.toMatchObject({ status: 400 })
        expect(mocks.applyUserSettingsUpdate).not.toHaveBeenCalled()
      })

    it('refuses to turn memory on while a project has automatic updates on',
      async () => {
        seedSettings({ memory_enabled: 0, memory_extraction_enabled: 0 })
        testDb.insertProject({ id: 1, userId: USER })
        testDb.sqlite.prepare(
          'update projects set memory_auto_update = ? where id = ?',
        ).run('on', 1)

        const { updateMcpSettings } = await load()

        await expect(updateMcpSettings(testDb.db, USER, {
          memoryEnabled: true,
        })).rejects.toMatchObject({ status: 400 })
        expect(mocks.applyUserSettingsUpdate).not.toHaveBeenCalled()
      })

    it('turns memory on when only other projects or other users have it on',
      async () => {
        seedSettings({ memory_enabled: 0, memory_extraction_enabled: 0 })
        testDb.insertProject({ id: 1, userId: USER })
        testDb.insertProject({ id: 2, userId: USER })
        testDb.insertProject({ id: 3, userId: USER + 1 })
        testDb.sqlite.prepare(
          'update projects set memory_auto_update = ? where id = ?',
        ).run('off', 1)
        testDb.sqlite.prepare(
          'update projects set memory_auto_update = ? where id = ?',
        ).run('on', 3)

        const { updateMcpSettings } = await load()

        await updateMcpSettings(testDb.db, USER, { memoryEnabled: true })

        expect(mocks.applyUserSettingsUpdate).toHaveBeenCalledTimes(1)
      })

    it('turns memory on when extraction is off and turns it off always',
      async () => {
        seedSettings({ memory_enabled: 0, memory_extraction_enabled: 0 })

        const { updateMcpSettings } = await load()

        await updateMcpSettings(testDb.db, USER, { memoryEnabled: true })
        await updateMcpSettings(testDb.db, USER, { memoryEnabled: false })

        expect(mocks.applyUserSettingsUpdate).toHaveBeenCalledTimes(2)
      })
  })
})

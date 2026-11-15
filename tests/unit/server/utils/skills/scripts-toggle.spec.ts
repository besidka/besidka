import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  createFakeSkillBucket,
  seedSkillWithFiles,
} from '../../../../setup/helpers/skills-db'
import type { FakeSkillBucket } from '../../../../setup/helpers/skills-db'

const mocks = vi.hoisted(() => ({
  logger: { set: vi.fn() },
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const { disableSkillScripts, enableSkillScripts } = await import(
  '~~/server/utils/skills/scripts-toggle'
)

const SCRIPT_FILES = {
  'SKILL.md': '---\nname: data-report\ndescription: d\n---\nBody\n',
  'scripts/run.py': 'print(1)\n',
}

describe('skill scripts toggle', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number

  async function seedSkill(
    skill: Partial<typeof schema.skills.$inferInsert> = {},
    files: Record<string, string> = SCRIPT_FILES,
  ) {
    const { skillId } = await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files,
      skill: { name: 'data-report', enabled: true, ...skill },
    })

    return skillId
  }

  async function seedKey() {
    await testDb.db.insert(schema.keys).values({
      userId,
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
    })
  }

  function enable(skillId: string, overrides: {
    isDisclosureAccepted?: boolean
    isRenameConfirmed?: boolean
  } = {}) {
    return enableSkillScripts({
      db: testDb.db,
      userId,
      skillId,
      isDisclosureAccepted: true,
      isRenameConfirmed: false,
      logger: mocks.logger,
      ...overrides,
    })
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db, null)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useDecryptText', async (value: string) => value)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('enableSkillScripts', () => {
    it('turns the setting on without any upload', async () => {
      const fetcher = vi.fn()

      vi.stubGlobal('fetch', fetcher)
      await seedKey()

      const skillId = await seedSkill()
      const summary = await enable(skillId)

      expect(summary).toMatchObject({
        id: skillId,
        allowScripts: true,
        hasScripts: true,
        scriptsProviderName: null,
        scriptsUploaded: false,
      })
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('needs the disclosure to be accepted', async () => {
      await seedKey()

      const skillId = await seedSkill()

      await expect(enable(skillId, { isDisclosureAccepted: false }))
        .rejects.toMatchObject({
          status: 400,
          code: 'scripts-disclosure-required',
        })
    })

    it('needs a script in the current version', async () => {
      await seedKey()

      const skillId = await seedSkill({}, {
        'SKILL.md': SCRIPT_FILES['SKILL.md'],
        'references/a.md': 'text',
      })

      await expect(enable(skillId)).rejects.toMatchObject({
        code: 'scripts-missing',
      })
    })

    it('needs an Anthropic key', async () => {
      const skillId = await seedSkill()

      await expect(enable(skillId)).rejects.toMatchObject({
        status: 409,
        code: 'scripts-key-missing',
      })
    })

    it('refuses a broken or restricted skill', async () => {
      await seedKey()

      const broken = await seedSkill({ status: 'broken', name: 'broken-one' })
      const restricted = await seedSkill({
        licenseClass: 'restricted',
        name: 'restricted-one',
      })

      await expect(enable(broken)).rejects.toMatchObject({
        code: 'skill-broken',
      })
      await expect(enable(restricted)).rejects.toMatchObject({
        code: 'skill-broken',
      })
    })

    it('renames a self-written skill with a reserved word on its own', async () => {
      await seedKey()

      const skillId = await seedSkill({
        name: 'claude-api',
        licenseClass: 'authored',
      })
      const summary = await enable(skillId)

      expect(summary).toMatchObject({
        allowScripts: true,
        scriptsProviderName: 'bsk-c-api',
      })
    })

    it('renames an open-license skill on its own', async () => {
      await seedKey()

      const skillId = await seedSkill({
        name: 'my-anthropic-tool',
        licenseClass: 'open',
      })

      expect(await enable(skillId)).toMatchObject({
        scriptsProviderName: 'my-bsk-a-tool',
      })
    })

    it.each(['none', 'custom'] as const)(
      'asks to confirm the new name for a %s-license skill',
      async (licenseClass) => {
        await seedKey()

        const skillId = await seedSkill({
          name: 'claude-api',
          licenseClass,
        })

        await expect(enable(skillId)).rejects.toMatchObject({
          status: 409,
          code: 'scripts-rename-confirmation-required',
          data: { providerName: 'bsk-c-api' },
        })

        expect(await enable(skillId, { isRenameConfirmed: true }))
          .toMatchObject({ allowScripts: true })
      },
    )

    it('does not turn on a skill of another user', async () => {
      await seedKey()

      const otherUserId = await seedUser(testDb.db, null)
      const { skillId } = await seedSkillWithFiles(testDb.db, bucket, {
        userId: otherUserId,
        files: SCRIPT_FILES,
        skill: { name: 'other-skill' },
      })

      await expect(enable(skillId)).rejects.toMatchObject({ status: 404 })
    })
  })

  describe('disableSkillScripts', () => {
    it('turns the setting off and deletes the provider copy', async () => {
      await seedKey()

      const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
        return init?.method === 'GET'
          ? new Response(JSON.stringify({ data: [] }), { status: 200 })
          : new Response(null, { status: 204 })
      })

      vi.stubGlobal('fetch', fetcher)

      const skillId = await seedSkill({
        allowScripts: true,
        providerSkillId: 'skill_01',
        providerSkillVersion: '1:1759178010',
        providerUploadedName: 'data-report',
      })
      const result = await disableSkillScripts({
        db: testDb.db,
        userId,
        skillId,
        logger: mocks.logger,
      })

      expect(result.providerCopy).toBe('deleted')
      expect(result.skill).toMatchObject({
        allowScripts: false,
        scriptsUploaded: false,
      })
      expect(fetcher.mock.calls.some(([url, init]) => {
        return String(url) === 'https://api.anthropic.com/v1/skills/skill_01'
          && init?.method === 'DELETE'
      })).toBe(true)
    })

    it('still turns it off and says so when the delete fails', async () => {
      await seedKey()
      vi.stubGlobal('fetch', vi.fn(async () => {
        return new Response(null, { status: 500 })
      }))

      const skillId = await seedSkill({
        allowScripts: true,
        providerSkillId: 'skill_01',
        providerSkillVersion: '1:1759178010',
        providerUploadedName: 'data-report',
      })
      const result = await disableSkillScripts({
        db: testDb.db,
        userId,
        skillId,
        logger: mocks.logger,
      })

      expect(result.providerCopy).toBe('failed')
      expect(result.skill).toMatchObject({
        allowScripts: false,
        scriptsUploaded: true,
      })
    })

    it('treats a key that cannot be decrypted as a failed provider delete', async () => {
      await seedKey()
      vi.stubGlobal('useDecryptText', async () => {
        throw new Error('bad ciphertext')
      })

      const fetcher = vi.fn()

      vi.stubGlobal('fetch', fetcher)

      const skillId = await seedSkill({
        allowScripts: true,
        providerSkillId: 'skill_01',
        providerSkillVersion: '1:1759178010',
        providerUploadedName: 'data-report',
      })
      const result = await disableSkillScripts({
        db: testDb.db,
        userId,
        skillId,
        logger: mocks.logger,
      })

      expect(result.providerCopy).toBe('failed')
      expect(result.skill.allowScripts).toBe(false)
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('makes no request for a skill that was never uploaded', async () => {
      const fetcher = vi.fn()

      vi.stubGlobal('fetch', fetcher)

      const skillId = await seedSkill({ allowScripts: true })
      const result = await disableSkillScripts({
        db: testDb.db,
        userId,
        skillId,
        logger: mocks.logger,
      })

      expect(result.providerCopy).toBe('none')
      expect(fetcher).not.toHaveBeenCalled()
    })
  })
})

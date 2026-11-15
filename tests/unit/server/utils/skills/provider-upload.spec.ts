import { eq } from 'drizzle-orm'
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

const {
  deleteProviderSkill,
  ensureProviderSkill,
  listLiveProviderCopies,
  removeAllProviderCopies,
  removeProviderCopy,
} = await import('~~/server/utils/skills/provider-upload')
const { loadOwnedSkill } = await import('~~/server/utils/skills/versions/read')

const SKILL_MD = '---\nname: claude-api\ndescription: Calls the API\n---\n# Body\n'
const API_KEY = 'sk-ant-test'

type FetchInput = string | URL | Request

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function emptyResponse(status = 204) {
  return new Response(null, { status })
}

describe('provider upload', () => {
  let testDb: MemoryExtractionTestDb
  let bucket: FakeSkillBucket
  let userId: number

  async function seedScriptSkill(
    overrides: Partial<typeof schema.skills.$inferInsert> = {},
    files: Record<string, string> = {
      'SKILL.md': SKILL_MD,
      'scripts/run.py': 'print("hi")\n',
    },
  ) {
    const { skillId } = await seedSkillWithFiles(testDb.db, bucket, {
      userId,
      files,
      skill: {
        name: 'claude-api',
        allowScripts: true,
        enabled: true,
        ...overrides,
      },
    })
    const skill = await loadOwnedSkill(testDb.db, userId, skillId)

    return skill
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    testDb = createMemoryExtractionTestDb()
    bucket = createFakeSkillBucket()
    userId = await seedUser(testDb.db, null)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useFileStorage', () => bucket)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('ensureProviderSkill', () => {
    it('uploads with the renamed root folder and pins both versions', async () => {
      const skill = await seedScriptSkill()
      const uploader = vi.fn(async () => {
        return { providerSkillId: 'skill_01', latestVersion: '1759178010' }
      })

      const reference = await ensureProviderSkill({
        db: testDb.db,
        bucket,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        uploader,
      })

      expect(uploader).toHaveBeenCalledTimes(1)

      const call = uploader.mock.calls[0]![0] as {
        files: Array<{ path: string, data: Uint8Array }>
        displayTitle: string
        apiKey: string
      }
      const paths = call.files.map(file => file.path).sort()

      expect(paths).toEqual([
        'bsk-c-api/SKILL.md',
        'bsk-c-api/scripts/run.py',
      ])
      expect(call.displayTitle).toBe('claude-api')
      expect(call.apiKey).toBe(API_KEY)

      const skillMd = new TextDecoder().decode(
        call.files.find(file => file.path.endsWith('SKILL.md'))!.data,
      )

      expect(skillMd).toContain('name: bsk-c-api')
      expect(skillMd).toContain('Changed by Besidka')
      expect(reference).toEqual({
        skillId: skill.id,
        name: 'bsk-c-api',
        providerSkillId: 'skill_01',
        providerVersion: '1759178010',
      })

      const stored = await loadOwnedSkill(testDb.db, userId, skill.id)

      expect(stored).toMatchObject({
        providerSkillId: 'skill_01',
        providerSkillVersion: '1:1759178010',
        providerUploadedName: 'bsk-c-api',
        providerDeletedAt: null,
      })
    })

    it('keeps a name without a reserved word and its files as they are', async () => {
      const skill = await seedScriptSkill(
        { name: 'data-report' },
        {
          'SKILL.md': '---\nname: data-report\ndescription: d\n---\nBody\n',
          'scripts/run.py': 'x = 1\n',
        },
      )
      const uploader = vi.fn(async () => {
        return { providerSkillId: 'skill_02', latestVersion: '5' }
      })

      await ensureProviderSkill({
        db: testDb.db,
        bucket,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        uploader,
      })

      const call = uploader.mock.calls[0]![0] as {
        files: Array<{ path: string, data: Uint8Array }>
      }

      expect(call.files.map(file => file.path).sort()).toEqual([
        'data-report/SKILL.md',
        'data-report/scripts/run.py',
      ])
      expect(new TextDecoder().decode(call.files[0]!.data)).not.toContain(
        'Changed by Besidka',
      )
    })

    it('reuses the copy while current_version is the uploaded version', async () => {
      const skill = await seedScriptSkill({
        providerSkillId: 'skill_01',
        providerSkillVersion: '1:1759178010',
        providerUploadedName: 'bsk-c-api',
      })
      const uploader = vi.fn()
      const fetcher = vi.fn()

      const reference = await ensureProviderSkill({
        db: testDb.db,
        bucket,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        uploader,
        fetcher,
      })

      expect(uploader).not.toHaveBeenCalled()
      expect(fetcher).not.toHaveBeenCalled()
      expect(reference).toMatchObject({
        providerSkillId: 'skill_01',
        providerVersion: '1759178010',
      })
    })

    it('replaces the copy lazily when the version differs', async () => {
      const skill = await seedScriptSkill({
        providerSkillId: 'skill_old',
        providerSkillVersion: '0:1759178010',
        providerUploadedName: 'bsk-c-api',
      })
      let listed = 0
      const fetcher = vi.fn(async (
        _url: string | URL | Request,
        init?: RequestInit,
      ) => {
        if (init?.method === 'GET') {
          listed += 1

          return jsonResponse({
            data: listed === 1 ? [{ version: '1759178010' }] : [],
          })
        }

        return emptyResponse()
      })
      const uploader = vi.fn(async () => {
        return { providerSkillId: 'skill_new', latestVersion: '1760000000' }
      })

      const reference = await ensureProviderSkill({
        db: testDb.db,
        bucket,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        uploader,
        fetcher: fetcher as unknown as typeof fetch,
      })

      const deleteUrls = fetcher.mock.calls
        .filter(([, init]) => init?.method === 'DELETE')
        .map(([url]) => String(url))

      expect(deleteUrls).toEqual([
        'https://api.anthropic.com/v1/skills/skill_old/versions/1759178010',
        'https://api.anthropic.com/v1/skills/skill_old',
      ])
      expect(uploader).toHaveBeenCalledTimes(1)
      expect(reference.providerSkillId).toBe('skill_new')

      const stored = await loadOwnedSkill(testDb.db, userId, skill.id)

      expect(stored.providerSkillVersion).toBe('1:1760000000')
    })

    it('fails closed when the provider returns no version', async () => {
      const skill = await seedScriptSkill()
      const uploader = vi.fn(async () => {
        return { providerSkillId: 'skill_03', latestVersion: null }
      })
      const fetcher = vi.fn(async (_url: FetchInput, init?: RequestInit) => {
        return init?.method === 'GET'
          ? jsonResponse({ data: [] })
          : emptyResponse()
      })

      await expect(ensureProviderSkill({
        db: testDb.db,
        bucket,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        uploader,
        fetcher: fetcher as unknown as typeof fetch,
      })).rejects.toMatchObject({ status: 502 })

      const stored = await loadOwnedSkill(testDb.db, userId, skill.id)

      expect(stored.providerSkillId).toBeNull()
      expect(fetcher.mock.calls.some(([url, init]) => {
        return init?.method === 'DELETE'
          && String(url).endsWith('/skills/skill_03')
      })).toBe(true)
    })

    it('keeps the copy of a concurrent request and deletes its own upload', async () => {
      const skill = await seedScriptSkill()
      const fetcher = vi.fn(async (
        _url: FetchInput,
        init?: RequestInit,
      ) => {
        return init?.method === 'GET'
          ? jsonResponse({ data: [] })
          : emptyResponse()
      })
      const uploader = vi.fn(async () => {
        await testDb.db.update(schema.skills)
          .set({
            providerSkillId: 'skill_winner',
            providerSkillVersion: '1:1760000000',
            providerUploadedName: 'bsk-c-api',
          })
          .where(eq(schema.skills.id, skill.id))

        return { providerSkillId: 'skill_ours', latestVersion: '1759178010' }
      })

      const reference = await ensureProviderSkill({
        db: testDb.db,
        bucket,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        uploader,
        fetcher: fetcher as unknown as typeof fetch,
      })
      const stored = await loadOwnedSkill(testDb.db, userId, skill.id)

      expect(reference).toMatchObject({
        providerSkillId: 'skill_winner',
        providerVersion: '1760000000',
      })
      expect(stored.providerSkillId).toBe('skill_winner')
      expect(fetcher.mock.calls.some(([url, init]) => {
        return init?.method === 'DELETE'
          && String(url).endsWith('/skills/skill_ours')
      })).toBe(true)
    })

    it('fails and deletes its own upload when the winner is not current', async () => {
      const skill = await seedScriptSkill()
      const fetcher = vi.fn(async (
        _url: FetchInput,
        init?: RequestInit,
      ) => {
        return init?.method === 'GET'
          ? jsonResponse({ data: [] })
          : emptyResponse()
      })
      const uploader = vi.fn(async () => {
        await testDb.db.update(schema.skills)
          .set({
            providerSkillId: 'skill_stale',
            providerSkillVersion: '0:1',
          })
          .where(eq(schema.skills.id, skill.id))

        return { providerSkillId: 'skill_ours', latestVersion: '1759178010' }
      })

      await expect(ensureProviderSkill({
        db: testDb.db,
        bucket,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        uploader,
        fetcher: fetcher as unknown as typeof fetch,
      })).rejects.toMatchObject({ status: 409 })
      expect(fetcher.mock.calls.some(([url, init]) => {
        return init?.method === 'DELETE'
          && String(url).endsWith('/skills/skill_ours')
      })).toBe(true)
    })

    it('does not store an id when the upload fails', async () => {
      const skill = await seedScriptSkill()
      const uploader = vi.fn(async () => {
        throw new Error('network down')
      })

      await expect(ensureProviderSkill({
        db: testDb.db,
        bucket,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        uploader,
      })).rejects.toMatchObject({ status: 502 })

      const stored = await loadOwnedSkill(testDb.db, userId, skill.id)

      expect(stored.providerSkillId).toBeNull()
    })

    it('refuses a SKILL.md it cannot rename', async () => {
      const skill = await seedScriptSkill({}, {
        'SKILL.md': '# No frontmatter\n',
        'scripts/run.py': 'x = 1\n',
      })
      const uploader = vi.fn()

      await expect(ensureProviderSkill({
        db: testDb.db,
        bucket,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        uploader,
      })).rejects.toMatchObject({ status: 400 })
      expect(uploader).not.toHaveBeenCalled()
    })
  })

  describe('deleteProviderSkill', () => {
    it('deletes every version before the skill, one request at a time', async () => {
      const order: string[] = []
      let listed = 0
      const fetcher = vi.fn(async (url: FetchInput, init?: RequestInit) => {
        order.push(`${init?.method} ${String(url).replace('https://api.anthropic.com/v1', '')}`)

        if (init?.method === 'GET') {
          listed += 1

          return jsonResponse({
            data: listed === 1 ? [{ version: '1' }, { version: '2' }] : [],
          })
        }

        return emptyResponse()
      })

      const outcome = await deleteProviderSkill({
        providerSkillId: 'skill_01',
        apiKey: API_KEY,
        logger: mocks.logger,
        fetcher: fetcher as unknown as typeof fetch,
      })

      expect(outcome).toBe('deleted')
      expect(order).toEqual([
        'GET /skills/skill_01/versions?limit=100',
        'DELETE /skills/skill_01/versions/1',
        'DELETE /skills/skill_01/versions/2',
        'GET /skills/skill_01/versions?limit=100',
        'DELETE /skills/skill_01',
      ])

      const init = fetcher.mock.calls[0]![1] as RequestInit

      expect(init.redirect).toBe('manual')
      expect(init.headers).toMatchObject({
        'x-api-key': API_KEY,
        'anthropic-beta': 'skills-2025-10-02',
      })
    })

    it('reads a 404 as already gone', async () => {
      const fetcher = vi.fn(async () => emptyResponse(404))

      expect(await deleteProviderSkill({
        providerSkillId: 'skill_01',
        apiKey: API_KEY,
        logger: mocks.logger,
        fetcher: fetcher as unknown as typeof fetch,
      })).toBe('already-gone')
    })

    it('reports a failure and never throws', async () => {
      const fetcher = vi.fn(async () => {
        throw new Error('timeout')
      })

      expect(await deleteProviderSkill({
        providerSkillId: 'skill_01',
        apiKey: API_KEY,
        logger: mocks.logger,
        fetcher: fetcher as unknown as typeof fetch,
      })).toBe('failed')
      expect(mocks.logger.set).toHaveBeenCalled()
      expect(JSON.stringify(mocks.logger.set.mock.calls)).not.toContain(API_KEY)
    })

    it.each(['.', '..', '...', 'a/b', 'a%2Fb', ''])(
      'refuses the id %j without a request',
      async (providerSkillId) => {
        const fetcher = vi.fn()

        expect(await deleteProviderSkill({
          providerSkillId,
          apiKey: API_KEY,
          logger: mocks.logger,
          fetcher: fetcher as unknown as typeof fetch,
        })).toBe('failed')
        expect(fetcher).not.toHaveBeenCalled()
      },
    )

    it('never follows a dot-only version from the listing', async () => {
      let listed = 0
      const urls: string[] = []
      const fetcher = vi.fn(async (url: FetchInput, init?: RequestInit) => {
        urls.push(`${init?.method} ${String(url)}`)

        if (init?.method === 'GET') {
          listed += 1

          return jsonResponse({
            data: listed === 1 ? [{ version: '..' }, { version: '7' }] : [],
          })
        }

        return emptyResponse()
      })

      await deleteProviderSkill({
        providerSkillId: 'skill_01',
        apiKey: API_KEY,
        logger: mocks.logger,
        fetcher: fetcher as unknown as typeof fetch,
      })

      expect(urls.some(url => url.includes('/..'))).toBe(false)
      expect(urls).toContain(
        'DELETE https://api.anthropic.com/v1/skills/skill_01/versions/7',
      )
    })

    it('deletes an upload whose id is not a plain identifier', async () => {
      const skill = await seedScriptSkill()
      const uploader = vi.fn(async () => {
        return { providerSkillId: '..', latestVersion: '1759178010' }
      })

      await expect(ensureProviderSkill({
        db: testDb.db,
        bucket,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        uploader,
      })).rejects.toMatchObject({ status: 502 })
      expect((await loadOwnedSkill(testDb.db, userId, skill.id))
        .providerSkillId).toBeNull()
    })

    it('logs the error kind, never the provider text', async () => {
      const skill = await seedScriptSkill()
      const secret = 'name: my-private-skill description: confidential'
      const uploader = vi.fn(async () => {
        throw new Error(`Invalid frontmatter: ${secret}`)
      })

      await expect(ensureProviderSkill({
        db: testDb.db,
        bucket,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        uploader,
      })).rejects.toMatchObject({ status: 502 })

      const logged = JSON.stringify(mocks.logger.set.mock.calls)

      expect(logged).not.toContain('confidential')
      expect(logged).not.toContain('Invalid frontmatter')
      expect(logged).toContain('"errorName":"Error"')
    })

    it('refuses an id that is not a plain identifier', async () => {
      const fetcher = vi.fn()

      expect(await deleteProviderSkill({
        providerSkillId: '../files/abc',
        apiKey: API_KEY,
        logger: mocks.logger,
        fetcher: fetcher as unknown as typeof fetch,
      })).toBe('failed')
      expect(fetcher).not.toHaveBeenCalled()
    })
  })

  describe('removeProviderCopy', () => {
    it('clears the columns and stamps the deletion only when it is gone', async () => {
      const skill = await seedScriptSkill({
        providerSkillId: 'skill_01',
        providerSkillVersion: '1:1759178010',
        providerUploadedName: 'bsk-c-api',
      })
      const fetcher = vi.fn(async (_url: FetchInput, init?: RequestInit) => {
        return init?.method === 'GET'
          ? jsonResponse({ data: [] })
          : emptyResponse()
      })

      const outcome = await removeProviderCopy({
        db: testDb.db,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        fetcher: fetcher as unknown as typeof fetch,
      })
      const stored = await loadOwnedSkill(testDb.db, userId, skill.id)

      expect(outcome).toBe('deleted')
      expect(stored.providerSkillId).toBeNull()
      expect(stored.providerUploadedName).toBeNull()
      expect(stored.providerDeletedAt).toBeInstanceOf(Date)
    })

    it('keeps the id when the delete fails, so it can be retried', async () => {
      const skill = await seedScriptSkill({
        providerSkillId: 'skill_01',
        providerSkillVersion: '1:1759178010',
        providerUploadedName: 'bsk-c-api',
      })
      const fetcher = vi.fn(async () => emptyResponse(500))

      const outcome = await removeProviderCopy({
        db: testDb.db,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        fetcher: fetcher as unknown as typeof fetch,
      })
      const stored = await loadOwnedSkill(testDb.db, userId, skill.id)

      expect(outcome).toBe('failed')
      expect(stored.providerSkillId).toBe('skill_01')
      expect(stored.providerDeletedAt).toBeNull()
    })

    it('reports a missing key as a failure without a request', async () => {
      const skill = await seedScriptSkill({ providerSkillId: 'skill_01' })
      const fetcher = vi.fn()

      expect(await removeProviderCopy({
        db: testDb.db,
        userId,
        skill,
        apiKey: null,
        logger: mocks.logger,
        fetcher: fetcher as unknown as typeof fetch,
      })).toBe('failed')
      expect(fetcher).not.toHaveBeenCalled()
    })

    it('does nothing for a skill without a copy', async () => {
      const skill = await seedScriptSkill()
      const fetcher = vi.fn()

      expect(await removeProviderCopy({
        db: testDb.db,
        userId,
        skill,
        apiKey: API_KEY,
        logger: mocks.logger,
        fetcher: fetcher as unknown as typeof fetch,
      })).toBe('none')
      expect(fetcher).not.toHaveBeenCalled()
    })
  })

  describe('account purge and key removal', () => {
    beforeEach(() => {
      vi.stubGlobal('useDecryptText', async (value: string) => value)
    })

    async function seedAnthropicKey(owner: number) {
      await testDb.db.insert(schema.keys).values({
        userId: owner,
        provider: 'anthropic',
        apiKey: API_KEY,
      })
    }

    it('lists the live copies for the key removal warning', async () => {
      await seedScriptSkill({
        name: 'first-skill',
        providerSkillId: 'skill_01',
      })
      await seedScriptSkill({ name: 'second-skill' })
      await seedScriptSkill({
        name: 'third-skill',
        providerSkillId: 'skill_03',
        providerDeletedAt: new Date(),
      })

      const live = await listLiveProviderCopies(testDb.db, userId)

      expect(live.map(copy => copy.name)).toEqual(['first-skill'])
    })

    it('deletes every copy of the user with the user key, and no other user\'s', async () => {
      const otherUserId = await seedUser(testDb.db, null)
      const first = await seedScriptSkill({
        name: 'first-skill',
        providerSkillId: 'skill_01',
      })
      const { skillId: otherSkillId } = await seedSkillWithFiles(
        testDb.db,
        bucket,
        {
          userId: otherUserId,
          files: { 'SKILL.md': SKILL_MD },
          skill: { providerSkillId: 'skill_other' },
        },
      )

      await seedAnthropicKey(userId)

      const fetcher = vi.fn(async (_url: FetchInput, init?: RequestInit) => {
        return init?.method === 'GET'
          ? jsonResponse({ data: [] })
          : emptyResponse()
      })
      const result = await removeAllProviderCopies({
        db: testDb.db,
        userId,
        logger: mocks.logger,
        fetcher: fetcher as unknown as typeof fetch,
      })
      const [otherRow] = await testDb.db.select()
        .from(schema.skills)
        .where(eq(schema.skills.id, otherSkillId))

      expect(result).toEqual({ attempted: 1, deleted: 1, failed: 0 })
      expect(fetcher.mock.calls.every(([url]) => {
        return !String(url).includes('skill_other')
      })).toBe(true)
      expect(otherRow?.providerSkillId).toBe('skill_other')
      expect((await loadOwnedSkill(testDb.db, userId, first.id))
        .providerSkillId).toBeNull()
    })

    it('counts a missing key as a failure and does not throw', async () => {
      await seedScriptSkill({ providerSkillId: 'skill_01' })

      const fetcher = vi.fn()
      const result = await removeAllProviderCopies({
        db: testDb.db,
        userId,
        logger: mocks.logger,
        fetcher: fetcher as unknown as typeof fetch,
      })

      expect(result).toEqual({ attempted: 1, deleted: 0, failed: 1 })
      expect(fetcher).not.toHaveBeenCalled()
    })
  })
})

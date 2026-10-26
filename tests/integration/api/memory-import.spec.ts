import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { MEMORY_EXTRACTION_LIMITS } from '~~/server/utils/memory/extract-limits'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  extractMemoryFromText: vi.fn(),
  loggerSet: vi.fn(),
  assertNotCrossSiteRequest: vi.fn(),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.loggerSet }),
}))

vi.mock('~~/server/utils/memory/extract', () => ({
  extractMemoryFromText: mocks.extractMemoryFromText,
}))

const SECRET_TEXT = 'Works at Acme Corp, secret pasted line'

function createKvStub() {
  const store = new Map<string, string>()

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
}

function createImportResult(overrides: Record<string, unknown> = {}) {
  return {
    status: 'imported',
    applied: { created: 2, updated: 1, appended: 3 },
    dropped: { ungrounded: 1 },
    blocked: { 'payment-card': 1 },
    model: {
      source: 'setting',
      providerId: 'openai',
      gatewayId: null,
      modelId: 'gpt-test',
      skipped: [],
    },
    chunks: 1,
    truncated: false,
    consumedChars: 40,
    proposed: 7,
    usage: { inputTokens: 100, outputTokens: 20 },
    modelCalled: true,
    ...overrides,
  }
}

async function loadHandler() {
  const module = await import('../../../server/api/v1/memory/import.post')

  return module.default
}

function cooldownPutsOf(kv: { put: { mock: { calls: unknown[][] } } }) {
  return kv.put.mock.calls.filter(([key]) => {
    return !String(key).startsWith('memory-rate-limit:')
  })
}
describe('POST /api/v1/memory/import', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let kv: ReturnType<typeof createKvStub>

  beforeEach(async () => {
    vi.resetModules()
    mocks.extractMemoryFromText.mockReset()
    mocks.loggerSet.mockReset()
    mocks.assertNotCrossSiteRequest.mockReset()
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryEnabled: true })
    kv = createKvStub()
    mocks.extractMemoryFromText.mockResolvedValue(createImportResult())

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', mocks.assertNotCrossSiteRequest)
    vi.stubGlobal(
      'readValidatedBody',
      async (event: { body: unknown }, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(userId) },
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  async function call(body: unknown) {
    const handler = await loadHandler()

    return await handler({ body } as never)
  }

  it('rejects unauthenticated requests before touching the model', async () => {
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    await expect(call({ text: SECRET_TEXT })).rejects.toMatchObject({
      status: 401,
    })
    expect(mocks.extractMemoryFromText).not.toHaveBeenCalled()
  })

  it('rejects a cross-site request', async () => {
    mocks.assertNotCrossSiteRequest.mockImplementation(() => {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    })

    await expect(call({ text: SECRET_TEXT })).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.extractMemoryFromText).not.toHaveBeenCalled()
  })

  it('rejects an invalid body without echoing it', async () => {
    const oversized = 'x'.repeat(MEMORY_EXTRACTION_LIMITS.importMaxChars + 1)

    await expect(call({ text: '' })).rejects.toMatchObject({ status: 400 })
    await expect(call({ text: '   ' })).rejects.toMatchObject({ status: 400 })
    await expect(call({ text: 42 })).rejects.toMatchObject({ status: 400 })
    await expect(call({})).rejects.toMatchObject({ status: 400 })
    await expect(call({ text: oversized })).rejects.toMatchObject({
      status: 400,
    })

    const error = await call({ text: oversized }).catch(exception => exception)

    expect(JSON.stringify(error)).not.toContain('xxxxxxxx')
    expect(mocks.extractMemoryFromText).not.toHaveBeenCalled()
  })

  it('accepts text at exactly the maximum length', async () => {
    const exact = 'x'.repeat(MEMORY_EXTRACTION_LIMITS.importMaxChars)

    await call({ text: exact })

    expect(mocks.extractMemoryFromText).toHaveBeenCalledOnce()
  })

  it('answers 409 with a fix when memory is off', async () => {
    await testDb.db.update(schema.userSettings)
      .set({ memoryEnabled: false })
      .where(eq(schema.userSettings.userId, userId))

    await expect(call({ text: SECRET_TEXT })).rejects.toMatchObject({
      status: 409,
      fix: expect.any(String),
    })
    expect(mocks.extractMemoryFromText).not.toHaveBeenCalled()
  })

  it('runs without the automatic extraction opt-in and without a '
    + 'settings row', async () => {
    await testDb.db.update(schema.userSettings)
      .set({ memoryExtractionEnabled: false })
      .where(eq(schema.userSettings.userId, userId))

    expect(await call({ text: SECRET_TEXT })).toMatchObject({ created: 2 })

    const userWithoutSettings = await seedUser(testDb.db, null)

    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: String(userWithoutSettings) },
    }))
    kv.store.clear()

    expect(await call({ text: SECRET_TEXT })).toMatchObject({ created: 2 })
  })

  it('answers 429 while the cooldown is active', async () => {
    kv.store.set(`memory-import:${userId}`, '1')

    await expect(call({ text: SECRET_TEXT })).rejects.toMatchObject({
      status: 429,
    })
    expect(mocks.extractMemoryFromText).not.toHaveBeenCalled()
  })

  it('passes the text to the import exactly as submitted, untrimmed',
    async () => {
      await call({ text: `  ${SECRET_TEXT}\n` })

      expect(mocks.extractMemoryFromText).toHaveBeenCalledWith(
        expect.objectContaining({ text: `  ${SECRET_TEXT}\n` }),
      )
    })

  it('runs for the session user only, and a body user id is ignored',
    async () => {
      const otherUserId = await seedUser(testDb.db, {})

      await call({ text: SECRET_TEXT, userId: otherUserId })

      expect(mocks.extractMemoryFromText).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          text: SECRET_TEXT,
          scope: 'profile',
          origin: 'import',
        }),
      )
    })

  it('answers with the summary only and starts the cooldown', async () => {
    const response = await call({ text: `  ${SECRET_TEXT}  ` })

    expect(response).toEqual({
      created: 2,
      updated: 1,
      appended: 3,
      dropped: { ungrounded: 1 },
      blocked: { 'payment-card': 1 },
      chunks: 1,
      truncated: false,
      consumedChars: 40,
      model: { source: 'setting', modelId: 'gpt-test' },
    })
    expect(JSON.stringify(response)).not.toContain('Acme')
    expect(kv.put).toHaveBeenCalledWith(
      `memory-import:${userId}`,
      '1',
      { expirationTtl: 60 },
    )
    await expect(call({ text: SECRET_TEXT })).rejects.toMatchObject({
      status: 429,
    })
  })

  it('reports a truncated import', async () => {
    mocks.extractMemoryFromText.mockResolvedValue(createImportResult({
      truncated: true,
      chunks: 3,
      consumedChars: 25,
    }))

    expect(await call({ text: SECRET_TEXT })).toMatchObject({
      truncated: true,
      chunks: 3,
      consumedChars: 25,
    })
  })

  it('answers 409 without a cooldown when no model resolves', async () => {
    mocks.extractMemoryFromText.mockResolvedValue(createImportResult({
      status: 'failed',
      reason: 'no-model',
      modelCalled: false,
      applied: { created: 0, updated: 0, appended: 0 },
    }))

    await expect(call({ text: SECRET_TEXT })).rejects.toMatchObject({
      status: 409,
      fix: expect.any(String),
    })
    expect(kv.store.has(`memory-import:${userId}`)).toBe(false)
  })

  it('answers 502 with only the error label and starts the cooldown',
    async () => {
      mocks.extractMemoryFromText.mockResolvedValue(createImportResult({
        status: 'failed',
        reason: 'APICallError:429',
        applied: { created: 0, updated: 0, appended: 0 },
      }))

      const error = await call({ text: SECRET_TEXT }).catch((exception) => {
        return exception
      })

      expect(error).toMatchObject({ status: 502 })
      expect(JSON.stringify(error)).not.toContain('Acme')
      expect(cooldownPutsOf(kv)).toHaveLength(1)
    })

  it('answers 409 when another import is running', async () => {
    mocks.extractMemoryFromText.mockResolvedValue(createImportResult({
      status: 'leased',
      modelCalled: false,
    }))

    await expect(call({ text: SECRET_TEXT })).rejects.toMatchObject({
      status: 409,
    })
    expect(kv.store.has(`memory-import:${userId}`)).toBe(true)
  })

  it('answers 409 when memory was switched off during the pass',
    async () => {
      mocks.extractMemoryFromText.mockResolvedValue(createImportResult({
        status: 'skipped',
        reason: 'disabled',
      }))

      await expect(call({ text: SECRET_TEXT })).rejects.toMatchObject({
        status: 409,
      })
    })

  it('answers 400 when nothing storable was pasted', async () => {
    mocks.extractMemoryFromText.mockResolvedValue(createImportResult({
      status: 'skipped',
      reason: 'no-text',
      modelCalled: false,
    }))

    await expect(call({ text: SECRET_TEXT })).rejects.toMatchObject({
      status: 400,
    })
    expect(kv.store.has(`memory-import:${userId}`)).toBe(false)
  })

  it('reports a null model when none resolved', async () => {
    mocks.extractMemoryFromText.mockResolvedValue(createImportResult({
      model: { source: null, providerId: null, gatewayId: null, modelId: null },
    }))

    expect(await call({ text: SECRET_TEXT })).toMatchObject({ model: null })
  })

  describe('cooldown lifecycle', () => {
    const cooldownKey = () => `memory-import:${userId}`

    it('takes the cooldown before the first model call so a parallel '
      + 'request is refused', async () => {
      let keyDuringCall: string | null = null
      let parallelStatus: number | null = null

      mocks.extractMemoryFromText.mockImplementation(async () => {
        keyDuringCall = kv.store.get(cooldownKey()) ?? null
        parallelStatus = await call({ text: SECRET_TEXT })
          .then(() => 200, exception => exception.status)

        return createImportResult()
      })

      await call({ text: SECRET_TEXT })

      expect(keyDuringCall).toBe('1')
      expect(parallelStatus).toBe(429)
      expect(mocks.extractMemoryFromText).toHaveBeenCalledOnce()
    })

    it('keeps the cooldown after a complete import', async () => {
      await call({ text: SECRET_TEXT })

      expect(kv.store.has(cooldownKey())).toBe(true)
      expect(kv.delete).not.toHaveBeenCalled()
    })

    it('releases the cooldown when the import was truncated so the '
      + 'continuation can follow', async () => {
      mocks.extractMemoryFromText.mockResolvedValue(createImportResult({
        truncated: true,
        consumedChars: 25,
      }))

      await call({ text: SECRET_TEXT })

      expect(kv.store.has(cooldownKey())).toBe(false)

      mocks.extractMemoryFromText.mockResolvedValue(createImportResult())

      expect(await call({ text: SECRET_TEXT.slice(25) }))
        .toMatchObject({ truncated: false })
    })

    it('keeps the cooldown after a failed model call', async () => {
      mocks.extractMemoryFromText.mockResolvedValue(createImportResult({
        status: 'failed',
        reason: 'APICallError:500',
        applied: { created: 0, updated: 0, appended: 0 },
      }))

      await call({ text: SECRET_TEXT }).catch(() => null)

      expect(kv.store.has(cooldownKey())).toBe(true)
    })

    it('leaves the running import\'s cooldown alone on a leased answer',
      async () => {
        mocks.extractMemoryFromText.mockResolvedValue(createImportResult({
          status: 'leased',
          modelCalled: false,
        }))

        await call({ text: SECRET_TEXT }).catch(() => null)

        expect(kv.store.has(cooldownKey())).toBe(true)
      })
  })

  it('logs counts only, never the pasted text', async () => {
    await call({ text: SECRET_TEXT })

    const logged = JSON.stringify(mocks.loggerSet.mock.calls)

    expect(logged).toContain('memoryImport')
    expect(logged).toContain('"consumedChars":40')
    expect(logged).toContain(`"chars":${SECRET_TEXT.length}`)
    expect(logged).not.toContain('Acme')
    expect(logged).not.toContain('secret pasted')
  })
})

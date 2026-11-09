import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ARTIFACT_STORAGE_WRITE_LIMIT } from '#shared/utils/artifacts'

const {
  enforceArtifactStorageWriteLimit,
  serializeArtifactStorageValue,
} = await import('~~/server/utils/artifacts/viewer-storage')

const SCOPE = { artifactInternalId: 7, viewerUserId: 3 }

function createKv() {
  const entries = new Map<string, string>()

  return {
    entries,
    get: vi.fn(async (key: string) => {
      return entries.get(key) ?? null
    }),
    put: vi.fn(async (key: string, value: string) => {
      entries.set(key, value)
    }),
  }
}

describe('enforceArtifactStorageWriteLimit', () => {
  let kv: ReturnType<typeof createKv>
  let headers: Headers
  let logger: { set: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    kv = createKv()
    headers = new Headers()
    logger = { set: vi.fn() }
    vi.stubGlobal('useKV', () => kv)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function enforce(withLogger = true) {
    return enforceArtifactStorageWriteLimit(
      { res: { headers } } as never,
      SCOPE,
      withLogger ? logger : undefined,
    )
  }

  it('counts a save under the viewer and artifact key', async () => {
    await enforce()

    const stored = JSON.parse(kv.entries.get('artifact-storage:3:7')!)

    expect(stored.count).toBe(1)
    expect(logger.set).not.toHaveBeenCalled()
  })

  it('answers 429 with Retry-After once the minute is used up', async () => {
    const now = Date.now()

    kv.entries.set('artifact-storage:3:7', JSON.stringify({
      key: '3:7',
      count: ARTIFACT_STORAGE_WRITE_LIMIT.max,
      lastRequest: now,
      windowStart: now,
    }))

    await expect(enforce()).rejects.toMatchObject({ status: 429 })
    expect(Number(headers.get('Retry-After'))).toBeGreaterThanOrEqual(1)
  })

  it('fails open and notes it when the counter write throws', async () => {
    kv.put.mockRejectedValue(new Error('KV PUT failed: 429'))

    await expect(enforce()).resolves.toBeUndefined()
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        artifacts: {
          storageRateLimit: { skipped: 'kv-error', error: 'Error' },
        },
      },
    })
    expect(headers.has('Retry-After')).toBe(false)
  })

  it('fails open without a logger as well', async () => {
    kv.get.mockRejectedValue(new Error('KV GET failed'))

    await expect(enforce(false)).resolves.toBeUndefined()
  })

  it('logs only the error name, never the message', async () => {
    kv.put.mockRejectedValue(
      new RangeError('secret detail about the namespace'),
    )

    await enforce()

    expect(JSON.stringify(logger.set.mock.calls))
      .not.toContain('secret detail')
    expect(JSON.stringify(logger.set.mock.calls)).toContain('RangeError')
  })
})

describe('serializeArtifactStorageValue', () => {
  it('serialises a plain value', () => {
    expect(serializeArtifactStorageValue({ a: [1, 'b', null] }))
      .toBe('{"a":[1,"b",null]}')
  })

  it.each([
    ['undefined', undefined],
    ['a function', () => 1],
    ['a symbol', Symbol('x')],
  ])('answers 400 for %s', (_label, value) => {
    expect(() => serializeArtifactStorageValue(value))
      .toThrowError(expect.objectContaining({ status: 400 }))
  })

  it('answers 400 for a value nested too deeply to stringify', () => {
    let deep: unknown = 'leaf'

    for (let depth = 0; depth < 1_000_000; depth++) {
      deep = [deep]
    }

    expect(() => serializeArtifactStorageValue(deep))
      .toThrowError(expect.objectContaining({ status: 400 }))
  })

  it('answers 400 for a circular value and a BigInt', () => {
    const circular: Record<string, unknown> = {}

    circular.self = circular

    expect(() => serializeArtifactStorageValue(circular))
      .toThrowError(expect.objectContaining({ status: 400 }))
    expect(() => serializeArtifactStorageValue(10n))
      .toThrowError(expect.objectContaining({ status: 400 }))
  })
})

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ERROR_CODES, RpcError } from '@besidka/artifacts-protocol'
import { ARTIFACT_STORAGE_MAX_VALUE_BYTES } from '#shared/utils/artifacts'
import {
  ARTIFACT_SHARE_HEADER,
  createArtifactStorageSession,
  resetArtifactStorage,
  resolveArtifactStorageMode,
  toStorageRpcError,
  waitForArtifactStorageWrites,
} from '../../../app/composables/artifact-storage'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)

interface Deferred<Value> {
  promise: Promise<Value>
  resolve: (value: Value) => void
  reject: (reason: unknown) => void
}

function createDeferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

function snapshotOf(items: Array<{ key: string, value: unknown }> = []) {
  return {
    items,
    keys: items.length,
    bytes: items.reduce((total, item) => {
      return total + JSON.stringify(item.value).length
    }, 0),
  }
}

let artifactSequence = 0

function nextArtifactId(): string {
  artifactSequence += 1

  return `art_${artifactSequence}`
}

function storageUrl(artifactId: string, key?: string): string {
  const base = `/api/v1/artifacts/${encodeURIComponent(artifactId)}/storage`

  return key === undefined ? base : `${base}/${encodeURIComponent(key)}`
}

function fetchError(status: number, reason?: string) {
  return Object.assign(new Error(`HTTP ${status}`), {
    statusCode: status,
    data: reason ? { data: { reason } } : {},
  })
}

function callsWithMethod(method: string) {
  return fetchMock.mock.calls.filter(([, options]) => {
    return options?.method === method
  })
}

async function rejectionOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception
  }

  throw new Error('The promise did not reject')
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('resolveArtifactStorageMode', () => {
  const allowed = {
    loggedIn: true,
    featureActive: true,
    source: 'owner' as const,
    artifactId: 'art_1',
  }

  it('is persistent for a signed-in owner with the flag on', () => {
    expect(resolveArtifactStorageMode(allowed)).toBe('persistent')
  })

  it.each([
    ['signed out', { loggedIn: false }],
    ['the flag is off', { featureActive: false }],
    ['the source is a shared chat', { source: 'shared' as const }],
    ['there is no artifact id', { artifactId: null }],
    ['the artifact id is undefined', { artifactId: undefined }],
    ['the artifact id is empty', { artifactId: '' }],
  ])('is memory when %s', (_label, override) => {
    expect(resolveArtifactStorageMode({ ...allowed, ...override }))
      .toBe('memory')
  })
})

describe('toStorageRpcError', () => {
  it.each([
    [400, ERROR_CODES.invalidParams, 'Value rejected'],
    [413, ERROR_CODES.invalidParams, 'Value rejected'],
    [429, ERROR_CODES.rateLimited, 'Too many saves'],
    [401, ERROR_CODES.notAllowed, 'Saving is not allowed'],
    [403, ERROR_CODES.notAllowed, 'Saving is not allowed'],
    [404, ERROR_CODES.notAllowed, 'Saving is not allowed'],
    [451, ERROR_CODES.notAllowed, 'Saving is not allowed'],
    [500, ERROR_CODES.internalError, 'Storage request failed'],
    [503, ERROR_CODES.internalError, 'Storage request failed'],
  ])('maps HTTP %i to %i', (status, code, message) => {
    const error = toStorageRpcError(fetchError(status))

    expect(error).toBeInstanceOf(RpcError)
    expect(error.code).toBe(code)
    expect(error.message).toBe(message)
  })

  it('maps a legal-consent 403 to consentRequired', () => {
    const error = toStorageRpcError(fetchError(403, 'legal-consent'))

    expect(error.code).toBe(ERROR_CODES.consentRequired)
    expect(error.message).toBe('Consent required')
  })

  it('keeps other 403 reasons as notAllowed', () => {
    expect(toStorageRpcError(fetchError(403, 'transfer-consent')).code)
      .toBe(ERROR_CODES.notAllowed)
  })

  it('reads the status from `status` when `statusCode` is missing', () => {
    expect(toStorageRpcError({ status: 429 }).code)
      .toBe(ERROR_CODES.rateLimited)
  })

  it.each([
    ['a network failure', new TypeError('Failed to fetch')],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom'],
    ['a non-numeric status', { statusCode: '500' }],
  ])('maps %s to internalError', (_label, exception) => {
    expect(toStorageRpcError(exception).code)
      .toBe(ERROR_CODES.internalError)
  })

  it('never leaks server details to artifact code', () => {
    const error = toStorageRpcError(Object.assign(new Error('secret'), {
      statusCode: 413,
      data: { message: 'secret', data: { why: 'secret' } },
    }))

    expect(error.message).not.toContain('secret')
    expect(error.data).toBeUndefined()
  })
})

describe('createArtifactStorageSession', () => {
  describe('snapshot', () => {
    it('loads the snapshot once for get and list', async () => {
      const artifactId = nextArtifactId()

      fetchMock.mockResolvedValue(snapshotOf([
        { key: 'score', value: 3 },
        { key: 'name', value: 'Ada' },
      ]))

      const { handlers } = createArtifactStorageSession({ artifactId })

      await expect(handlers.get({ key: 'score' }))
        .resolves.toEqual({ value: 3 })
      await expect(handlers.get({ key: 'name' }))
        .resolves.toEqual({ value: 'Ada' })
      await expect(handlers.list({})).resolves.toEqual({
        keys: ['name', 'score'],
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(
        storageUrl(artifactId),
        { headers: {} },
      )
    })

    it('shares one request between concurrent first reads', async () => {
      const artifactId = nextArtifactId()
      const response = createDeferred<ReturnType<typeof snapshotOf>>()

      fetchMock.mockReturnValue(response.promise)

      const { handlers, ready } = createArtifactStorageSession({
        artifactId,
      })
      const reads = Promise.all([
        handlers.get({ key: 'a' }),
        handlers.list({}),
        ready(),
      ])

      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(1)

      response.resolve(snapshotOf([{ key: 'a', value: 1 }]))

      await expect(reads).resolves.toEqual([
        { value: 1 },
        { keys: ['a'] },
        undefined,
      ])
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('does not fetch until the first handler call', async () => {
      createArtifactStorageSession({ artifactId: nextArtifactId() })
      await flushPromises()

      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('answers null for a key that is not saved', async () => {
      fetchMock.mockResolvedValue(snapshotOf())

      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })

      await expect(handlers.get({ key: 'missing' }))
        .resolves.toEqual({ value: null })
    })

    it('reads a stored null back as null', async () => {
      fetchMock.mockResolvedValue({
        items: [{ key: 'cleared', value: undefined }],
        keys: 1,
        bytes: 4,
      })

      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })

      await expect(handlers.get({ key: 'cleared' }))
        .resolves.toEqual({ value: null })
    })

    it('filters list by prefix and sorts the keys', async () => {
      fetchMock.mockResolvedValue(snapshotOf([
        { key: 'quiz:2', value: 2 },
        { key: 'other', value: 0 },
        { key: 'quiz:1', value: 1 },
      ]))

      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })

      await expect(handlers.list({ prefix: 'quiz:' }))
        .resolves.toEqual({ keys: ['quiz:1', 'quiz:2'] })
      await expect(handlers.list({ prefix: '' })).resolves.toEqual({
        keys: ['other', 'quiz:1', 'quiz:2'],
      })
      await expect(handlers.list({ prefix: 'none' }))
        .resolves.toEqual({ keys: [] })
    })

    it('hands out copies that cannot change the cache', async () => {
      fetchMock.mockResolvedValue(snapshotOf([
        { key: 'state', value: { tries: [1] } },
      ]))

      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })
      const first = await handlers.get({ key: 'state' })

      ;(first.value as { tries: number[] }).tries.push(2)

      await expect(handlers.get({ key: 'state' }))
        .resolves.toEqual({ value: { tries: [1] } })
    })

    it('sends the share token header when one is given', async () => {
      const artifactId = nextArtifactId()

      fetchMock.mockResolvedValue(snapshotOf())

      const { handlers } = createArtifactStorageSession({
        artifactId,
        shareToken: 'token-1',
      })

      await handlers.list({})

      expect(fetchMock).toHaveBeenCalledWith(storageUrl(artifactId), {
        headers: { [ARTIFACT_SHARE_HEADER]: 'token-1' },
      })
    })

    it('encodes the artifact id and key in the path', async () => {
      const artifactId = 'art/odd id'

      fetchMock.mockResolvedValueOnce(snapshotOf())
      fetchMock.mockResolvedValueOnce({ keys: 1, bytes: 1 })

      const { handlers } = createArtifactStorageSession({ artifactId })

      await handlers.set({ key: 'a:b.c', value: 1 })

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        '/api/v1/artifacts/art%2Fodd%20id/storage',
        { headers: {} },
      )
      expect(fetchMock).toHaveBeenNthCalledWith(
        2,
        '/api/v1/artifacts/art%2Fodd%20id/storage/a%3Ab.c',
        { method: 'PUT', body: { value: 1 }, headers: {} },
      )
    })

    it('reports totals to onChange after the load', async () => {
      const onChange = vi.fn()

      fetchMock.mockResolvedValue({
        items: [{ key: 'a', value: 1 }],
        keys: 1,
        bytes: 1,
      })

      const { ready } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
        onChange,
      })

      await ready()

      expect(onChange).toHaveBeenCalledTimes(1)
      expect(onChange).toHaveBeenCalledWith({
        persistent: true,
        keys: 1,
        bytes: 1,
      })
    })

    it('maps a failed load and retries on the next call', async () => {
      const artifactId = nextArtifactId()

      fetchMock.mockRejectedValueOnce(fetchError(500))
      fetchMock.mockResolvedValueOnce(snapshotOf([{ key: 'a', value: 1 }]))

      const { handlers } = createArtifactStorageSession({ artifactId })
      const failure = await rejectionOf(handlers.get({ key: 'a' }))

      expect(failure).toBeInstanceOf(RpcError)
      expect((failure as RpcError).code).toBe(ERROR_CODES.internalError)

      await expect(handlers.get({ key: 'a' }))
        .resolves.toEqual({ value: 1 })
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('maps a legal-consent refusal on load to consentRequired', async () => {
      fetchMock.mockRejectedValue(fetchError(403, 'legal-consent'))

      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })
      const failure = await rejectionOf(handlers.list({}))

      expect((failure as RpcError).code).toBe(ERROR_CODES.consentRequired)
    })
  })

  describe('writes', () => {
    it('sends the value and updates the cache after the server accepts it',
      async () => {
        const artifactId = nextArtifactId()
        const onChange = vi.fn()

        fetchMock.mockResolvedValueOnce(snapshotOf())
        fetchMock.mockResolvedValueOnce({ keys: 1, bytes: 9 })

        const { handlers } = createArtifactStorageSession({
          artifactId,
          onChange,
        })

        await expect(handlers.set({ key: 'score', value: { points: 3 } }))
          .resolves.toEqual({})

        expect(fetchMock).toHaveBeenLastCalledWith(
          storageUrl(artifactId, 'score'),
          { method: 'PUT', body: { value: { points: 3 } }, headers: {} },
        )
        await expect(handlers.get({ key: 'score' }))
          .resolves.toEqual({ value: { points: 3 } })
        await expect(handlers.list({}))
          .resolves.toEqual({ keys: ['score'] })
        expect(onChange).toHaveBeenLastCalledWith({
          persistent: true,
          keys: 1,
          bytes: 9,
        })
      })

    it('sends a copy, so later edits to the value do not change the cache',
      async () => {
        fetchMock.mockResolvedValueOnce(snapshotOf())
        fetchMock.mockResolvedValueOnce({ keys: 1, bytes: 9 })

        const { handlers } = createArtifactStorageSession({
          artifactId: nextArtifactId(),
        })
        const value = { points: 3 }

        await handlers.set({ key: 'score', value })
        value.points = 99

        await expect(handlers.get({ key: 'score' }))
          .resolves.toEqual({ value: { points: 3 } })
      })

    it('deletes a key and takes the totals from the server', async () => {
      const artifactId = nextArtifactId()
      const onChange = vi.fn()

      fetchMock.mockResolvedValueOnce(snapshotOf([
        { key: 'a', value: 1 },
        { key: 'b', value: 2 },
      ]))
      fetchMock.mockResolvedValueOnce({ keys: 1, bytes: 1 })

      const { handlers } = createArtifactStorageSession({
        artifactId,
        onChange,
      })

      await expect(handlers.delete({ key: 'a' })).resolves.toEqual({})

      expect(fetchMock).toHaveBeenLastCalledWith(
        storageUrl(artifactId, 'a'),
        { method: 'DELETE', headers: {} },
      )
      await expect(handlers.get({ key: 'a' }))
        .resolves.toEqual({ value: null })
      await expect(handlers.list({})).resolves.toEqual({ keys: ['b'] })
      expect(onChange).toHaveBeenLastCalledWith({
        persistent: true,
        keys: 1,
        bytes: 1,
      })
    })

    it('leaves the cache unchanged when the server refuses a write',
      async () => {
        const onChange = vi.fn()

        fetchMock.mockResolvedValueOnce(snapshotOf([
          { key: 'score', value: 1 },
        ]))
        fetchMock.mockRejectedValueOnce(fetchError(413))

        const { handlers } = createArtifactStorageSession({
          artifactId: nextArtifactId(),
          onChange,
        })
        const failure = await rejectionOf(
          handlers.set({ key: 'score', value: 'too big' }),
        )

        expect(failure).toBeInstanceOf(RpcError)
        expect((failure as RpcError).code).toBe(ERROR_CODES.invalidParams)
        await expect(handlers.get({ key: 'score' }))
          .resolves.toEqual({ value: 1 })
        expect(onChange).toHaveBeenCalledTimes(1)
      })

    it('leaves the cache unchanged when a delete fails', async () => {
      fetchMock.mockResolvedValueOnce(snapshotOf([
        { key: 'score', value: 1 },
      ]))
      fetchMock.mockRejectedValueOnce(fetchError(429))

      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })
      const failure = await rejectionOf(handlers.delete({ key: 'score' }))

      expect((failure as RpcError).code).toBe(ERROR_CODES.rateLimited)
      await expect(handlers.get({ key: 'score' }))
        .resolves.toEqual({ value: 1 })
    })

    it('keeps writing after one write failed', async () => {
      fetchMock.mockResolvedValueOnce(snapshotOf())
      fetchMock.mockRejectedValueOnce(fetchError(500))
      fetchMock.mockResolvedValueOnce({ keys: 1, bytes: 1 })

      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })

      await rejectionOf(handlers.set({ key: 'score', value: 1 }))
      await handlers.set({ key: 'score', value: 2 })

      await expect(handlers.get({ key: 'score' }))
        .resolves.toEqual({ value: 2 })
    })
  })

  describe('write queue', () => {
    it('starts the second write only after the first one settled',
      async () => {
        const artifactId = nextArtifactId()
        const first = createDeferred<{ keys: number, bytes: number }>()
        const second = createDeferred<{ keys: number, bytes: number }>()

        fetchMock.mockResolvedValueOnce(snapshotOf())
        fetchMock.mockReturnValueOnce(first.promise)
        fetchMock.mockReturnValueOnce(second.promise)

        const { handlers } = createArtifactStorageSession({ artifactId })
        const firstWrite = handlers.set({ key: 'score', value: 'first' })
        const secondWrite = handlers.set({ key: 'score', value: 'second' })

        await flushPromises()

        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(callsWithMethod('PUT')).toHaveLength(1)

        first.resolve({ keys: 1, bytes: 7 })
        await firstWrite
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledTimes(3)
        expect(callsWithMethod('PUT').map(([, options]) => {
          return options.body
        })).toEqual([{ value: 'first' }, { value: 'second' }])

        second.resolve({ keys: 1, bytes: 8 })
        await secondWrite

        await expect(handlers.get({ key: 'score' }))
          .resolves.toEqual({ value: 'second' })
      })

    it('ends on the newest value even when responses finish out of order',
      async () => {
        const first = createDeferred<{ keys: number, bytes: number }>()
        const second = createDeferred<{ keys: number, bytes: number }>()

        fetchMock.mockResolvedValueOnce(snapshotOf())
        fetchMock.mockReturnValueOnce(first.promise)
        fetchMock.mockReturnValueOnce(second.promise)

        const { handlers } = createArtifactStorageSession({
          artifactId: nextArtifactId(),
        })
        const firstWrite = handlers.set({ key: 'score', value: 'old' })
        const secondWrite = handlers.set({ key: 'score', value: 'new' })

        second.resolve({ keys: 1, bytes: 5 })
        await flushPromises()
        first.resolve({ keys: 1, bytes: 5 })
        await Promise.all([firstWrite, secondWrite])

        await expect(handlers.get({ key: 'score' }))
          .resolves.toEqual({ value: 'new' })
      })

    it('runs a delete after the set it was issued behind', async () => {
      const first = createDeferred<{ keys: number, bytes: number }>()

      fetchMock.mockResolvedValueOnce(snapshotOf())
      fetchMock.mockReturnValueOnce(first.promise)
      fetchMock.mockResolvedValueOnce({ keys: 0, bytes: 0 })

      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })
      const write = handlers.set({ key: 'score', value: 1 })
      const removal = handlers.delete({ key: 'score' })

      await flushPromises()
      expect(callsWithMethod('DELETE')).toHaveLength(0)

      first.resolve({ keys: 1, bytes: 1 })
      await Promise.all([write, removal])

      expect(callsWithMethod('DELETE')).toHaveLength(1)
      await expect(handlers.get({ key: 'score' }))
        .resolves.toEqual({ value: null })
    })

    it('does not let a failed write block the next one', async () => {
      const first = createDeferred<{ keys: number, bytes: number }>()

      fetchMock.mockResolvedValueOnce(snapshotOf())
      fetchMock.mockReturnValueOnce(first.promise)
      fetchMock.mockResolvedValueOnce({ keys: 1, bytes: 1 })

      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })
      const failing = rejectionOf(
        handlers.set({ key: 'score', value: 'first' }),
      )
      const following = handlers.set({ key: 'score', value: 'second' })

      first.reject(fetchError(500))
      await failing
      await following

      await expect(handlers.get({ key: 'score' }))
        .resolves.toEqual({ value: 'second' })
    })

    it('queues each artifact on its own', async () => {
      const slow = createDeferred<{ keys: number, bytes: number }>()
      const slowId = nextArtifactId()
      const quickId = nextArtifactId()

      fetchMock.mockImplementation(async (path: string, options?: {
        method?: string
      }) => {
        if (options?.method === 'PUT' && path.includes(slowId)) {
          return slow.promise
        }

        return options?.method === 'PUT'
          ? { keys: 1, bytes: 1 }
          : snapshotOf()
      })

      const slowSession = createArtifactStorageSession({
        artifactId: slowId,
      })
      const quickSession = createArtifactStorageSession({
        artifactId: quickId,
      })
      const slowWrite = slowSession.handlers.set({ key: 'a', value: 1 })

      await flushPromises()
      await quickSession.handlers.set({ key: 'a', value: 1 })

      await expect(quickSession.handlers.get({ key: 'a' }))
        .resolves.toEqual({ value: 1 })

      slow.resolve({ keys: 1, bytes: 1 })
      await slowWrite
    })

    it('makes a new session wait for writes still in flight', async () => {
      const artifactId = nextArtifactId()
      const pending = createDeferred<{ keys: number, bytes: number }>()

      fetchMock.mockResolvedValueOnce(snapshotOf())
      fetchMock.mockReturnValueOnce(pending.promise)

      const earlier = createArtifactStorageSession({ artifactId })
      const write = earlier.handlers.set({ key: 'score', value: 5 })

      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(2)

      fetchMock.mockResolvedValueOnce(snapshotOf([
        { key: 'score', value: 5 },
      ]))

      const later = createArtifactStorageSession({ artifactId })
      const loaded = later.handlers.get({ key: 'score' })

      await flushPromises()
      expect(fetchMock).toHaveBeenCalledTimes(2)

      pending.resolve({ keys: 1, bytes: 1 })
      await write

      await expect(loaded).resolves.toEqual({ value: 5 })
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('clears the queue entry once every write finished', async () => {
      const artifactId = nextArtifactId()

      fetchMock.mockResolvedValueOnce(snapshotOf())
      fetchMock.mockResolvedValueOnce({ keys: 1, bytes: 1 })

      const { handlers } = createArtifactStorageSession({ artifactId })

      await handlers.set({ key: 'a', value: 1 })
      await flushPromises()

      const settled = waitForArtifactStorageWrites(artifactId)

      await expect(settled).resolves.toBeUndefined()
    })
  })

  describe('client-side validation', () => {
    it.each([
      ['an empty key', ''],
      ['a key with a space', 'bad key'],
      ['a key with a slash', 'a/b'],
      ['a key over 128 characters', 'k'.repeat(129)],
      ['a single dot', '.'],
      ['two dots', '..'],
    ])('rejects %s without any request', async (_label, key) => {
      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })
      const setFailure = await rejectionOf(handlers.set({ key, value: 1 }))
      const deleteFailure = await rejectionOf(handlers.delete({ key }))

      expect(setFailure).toBeInstanceOf(RpcError)
      expect((setFailure as RpcError).code).toBe(ERROR_CODES.invalidParams)
      expect((deleteFailure as RpcError).code)
        .toBe(ERROR_CODES.invalidParams)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('rejects a value over 32 KB without any request', async () => {
      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })
      const failure = await rejectionOf(handlers.set({
        key: 'big',
        value: 'x'.repeat(ARTIFACT_STORAGE_MAX_VALUE_BYTES),
      }))

      expect((failure as RpcError).code).toBe(ERROR_CODES.invalidParams)
      expect((failure as RpcError).message).toBe('Value rejected')
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('measures the limit in UTF-8 bytes', async () => {
      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })
      const characters = Math.floor(ARTIFACT_STORAGE_MAX_VALUE_BYTES / 3) + 1
      const failure = await rejectionOf(handlers.set({
        key: 'euros',
        value: '€'.repeat(characters),
      }))

      expect((failure as RpcError).code).toBe(ERROR_CODES.invalidParams)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('sends a value of exactly 32 KB serialised', async () => {
      fetchMock.mockResolvedValueOnce(snapshotOf())
      fetchMock.mockResolvedValueOnce({
        keys: 1,
        bytes: ARTIFACT_STORAGE_MAX_VALUE_BYTES,
      })

      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })

      await expect(handlers.set({
        key: 'big',
        value: 'x'.repeat(ARTIFACT_STORAGE_MAX_VALUE_BYTES - 2),
      })).resolves.toEqual({})
      expect(callsWithMethod('PUT')).toHaveLength(1)
    })

    it('rejects a value JSON cannot represent without any request',
      async () => {
        const { handlers } = createArtifactStorageSession({
          artifactId: nextArtifactId(),
        })
        const failure = await rejectionOf(handlers.set({
          key: 'nothing',
          value: undefined as never,
        }))

        expect((failure as RpcError).code).toBe(ERROR_CODES.invalidParams)
        expect(fetchMock).not.toHaveBeenCalled()
      })

    it.each(['...', '.a', 'a.', '..a', 'a..b'])(
      'accepts the key %s that only contains dots',
      async (key) => {
        fetchMock.mockResolvedValueOnce(snapshotOf())
        fetchMock.mockResolvedValueOnce({ keys: 1, bytes: 1 })

        const { handlers } = createArtifactStorageSession({
          artifactId: nextArtifactId(),
        })

        await expect(handlers.set({ key, value: 1 })).resolves.toEqual({})
        expect(callsWithMethod('PUT')).toHaveLength(1)
      },
    )

    it('accepts a key of 128 characters', async () => {
      fetchMock.mockResolvedValueOnce(snapshotOf())
      fetchMock.mockResolvedValueOnce({ keys: 1, bytes: 1 })

      const { handlers } = createArtifactStorageSession({
        artifactId: nextArtifactId(),
      })

      await expect(handlers.set({ key: 'k'.repeat(128), value: 1 }))
        .resolves.toEqual({})
    })
  })
})

describe('resetArtifactStorage', () => {
  it('deletes every saved value of the artifact', async () => {
    const artifactId = nextArtifactId()

    fetchMock.mockResolvedValue({ keys: 0, bytes: 0, deleted: 2 })

    await expect(resetArtifactStorage(artifactId)).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      storageUrl(artifactId),
      { method: 'DELETE', headers: {} },
    )
  })

  it('sends the share token header when one is given', async () => {
    const artifactId = nextArtifactId()

    fetchMock.mockResolvedValue({ keys: 0, bytes: 0, deleted: 0 })

    await resetArtifactStorage(artifactId, 'token-2')

    expect(fetchMock).toHaveBeenCalledWith(storageUrl(artifactId), {
      method: 'DELETE',
      headers: { [ARTIFACT_SHARE_HEADER]: 'token-2' },
    })
  })

  it('waits for a write still in flight', async () => {
    const artifactId = nextArtifactId()
    const pending = createDeferred<{ keys: number, bytes: number }>()

    fetchMock.mockResolvedValueOnce(snapshotOf())
    fetchMock.mockReturnValueOnce(pending.promise)
    fetchMock.mockResolvedValueOnce({ keys: 0, bytes: 0, deleted: 1 })

    const { handlers } = createArtifactStorageSession({ artifactId })
    const write = handlers.set({ key: 'score', value: 1 })

    await flushPromises()

    const reset = resetArtifactStorage(artifactId)

    await flushPromises()
    expect(callsWithMethod('DELETE')).toHaveLength(0)

    pending.resolve({ keys: 1, bytes: 1 })
    await Promise.all([write, reset])

    expect(callsWithMethod('PUT')).toHaveLength(1)
    expect(callsWithMethod('DELETE')).toHaveLength(1)
  })

  it('passes the server error on to the caller', async () => {
    const failure = fetchError(500)

    fetchMock.mockRejectedValue(failure)

    await expect(resetArtifactStorage(nextArtifactId()))
      .rejects.toBe(failure)
  })
})

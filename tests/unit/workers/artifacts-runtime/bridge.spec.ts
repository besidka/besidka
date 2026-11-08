// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { ERROR_CODES, METHODS, RpcError } from '@besidka/artifacts-protocol'
import type { RuntimeConnection } from '@besidka/artifacts-protocol'
import { createBesidkaApi } from '~~/workers/artifacts-runtime/src/bridge'

function createConnection(
  request: (method: string, params: unknown) => unknown,
): RuntimeConnection {
  return {
    request: vi.fn(async (method: string, params: unknown) => {
      return request(method, params)
    }) as unknown as RuntimeConnection['request'],
    notify: vi.fn(),
    close: vi.fn(),
  }
}

describe('window.besidka bridge', () => {
  it('keeps storage in memory when the host offers memory storage', async () => {
    const connection = createConnection(() => {
      throw new Error('should not be called')
    })
    const api = createBesidkaApi(connection, {
      storage: 'memory',
      complete: false,
    })

    await api.storage.set('answers', { first: 'b' })

    expect(await api.storage.get('answers')).toEqual({ first: 'b' })
    expect(await api.storage.get('missing')).toBeNull()
    expect(await api.storage.list()).toEqual(['answers'])

    await api.storage.delete('answers')

    expect(await api.storage.list()).toEqual([])
    expect(api.storage.persistent).toBe(false)
    expect(connection.request).not.toHaveBeenCalled()
  })

  it('falls back to memory when the host answers -32601', async () => {
    const connection = createConnection(() => {
      throw new RpcError(ERROR_CODES.methodNotFound, 'Method not found')
    })
    const api = createBesidkaApi(connection, {
      storage: 'persistent',
      complete: false,
    })

    expect(api.storage.persistent).toBe(true)

    await api.storage.set('score', 3)

    expect(api.storage.persistent).toBe(false)
    expect(await api.storage.get('score')).toBe(3)
  })

  it('uses host storage when it is persistent', async () => {
    const connection = createConnection((method) => {
      if (method === METHODS.storageGet) {
        return { value: 'remote' }
      }

      return {}
    })
    const api = createBesidkaApi(connection, {
      storage: 'persistent',
      complete: false,
    })

    expect(await api.storage.get('key')).toBe('remote')
    expect(connection.request).toHaveBeenCalledWith(
      METHODS.storageGet,
      { key: 'key' },
    )
  })

  it('rejects values that are not JSON and invalid keys', async () => {
    const api = createBesidkaApi(createConnection(() => {
      return {}
    }), { storage: 'memory', complete: false })

    await expect(api.storage.set('fn', () => {})).rejects.toThrow(
      'JSON-serialisable',
    )
    await expect(api.storage.set('', 1)).rejects.toThrow('Storage keys')
  })

  it('explains why a completion is unavailable or refused', async () => {
    const unavailable = createBesidkaApi(createConnection(() => {
      return {}
    }), { storage: 'memory', complete: false })

    await expect(unavailable.complete('Hi')).rejects.toMatchObject({
      code: ERROR_CODES.methodNotFound,
      message: 'AI completions are not available here.',
    })

    const refusing = createBesidkaApi(createConnection(() => {
      throw new RpcError(ERROR_CODES.consentRequired, 'raw host message')
    }), { storage: 'memory', complete: true })

    await expect(refusing.complete('Hi')).rejects.toMatchObject({
      code: ERROR_CODES.consentRequired,
      message: 'The viewer has not allowed AI completions for this artifact.',
    })
    await expect(refusing.complete('')).rejects.toThrow('non-empty string')
  })

  it('returns the completion text and passes the token limit', async () => {
    const connection = createConnection(() => {
      return { text: 'Answer' }
    })
    const api = createBesidkaApi(connection, {
      storage: 'memory',
      complete: true,
    })

    expect(await api.complete('Question', { maxOutputTokens: 200 }))
      .toBe('Answer')
    expect(connection.request).toHaveBeenCalledWith(
      METHODS.complete,
      { prompt: 'Question', maxOutputTokens: 200 },
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    )
  })

  it('is frozen', () => {
    const api = createBesidkaApi(createConnection(() => {
      return {}
    }), { storage: 'memory', complete: false })

    expect(Object.isFrozen(api)).toBe(true)
    expect(Object.isFrozen(api.storage)).toBe(true)
    expect(api.theme).toBe('light')
  })
})

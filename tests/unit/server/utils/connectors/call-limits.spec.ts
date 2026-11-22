import { describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_CALLS_PER_MINUTE,
  CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR,
} from '#shared/utils/connectors-policy'
import { createConnectorCallLimiter } from '~~/server/utils/connectors/call-limits'
import {
  createFakeConnectorKv,
} from '../../../../setup/helpers/connectors-oauth'

describe('connector call limiter', () => {
  it('allows 30 calls a minute per connector and then refuses', async () => {
    const limit = createConnectorCallLimiter(createFakeConnectorKv() as never)

    const max = CONNECTOR_CALLS_PER_MINUTE_PER_CONNECTOR

    for (let call = 0; call < max; call++) {
      expect(await limit(1, 'c1')).toEqual({ status: 'allowed' })
    }

    expect(await limit(1, 'c1')).toMatchObject({
      status: 'limited',
      scope: 'connector',
    })
    expect(await limit(1, 'c2')).toEqual({ status: 'allowed' })
  })

  it('allows 60 calls a minute per user across connectors', async () => {
    const limit = createConnectorCallLimiter(createFakeConnectorKv() as never)

    for (let call = 0; call < CONNECTOR_CALLS_PER_MINUTE; call++) {
      expect(await limit(1, `c${call % 4}`)).toEqual({ status: 'allowed' })
    }

    expect(await limit(1, 'c9')).toMatchObject({
      status: 'limited',
      scope: 'user',
    })
    expect(await limit(2, 'c9')).toEqual({ status: 'allowed' })
  })

  it('retries a KV failure once, then reports it apart from a limit',
    async () => {
      vi.useFakeTimers()

      try {
        const kv = createFakeConnectorKv()

        kv.get.mockRejectedValue(new Error('KV down'))

        const pending = createConnectorCallLimiter(kv as never)(1, 'c1')

        await vi.advanceTimersByTimeAsync(1_100)

        expect(await pending).toEqual({
          status: 'kv-error',
          error: 'KV down',
        })
        expect(kv.get).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })

  it('counts after one failed write once the retry succeeds', async () => {
    vi.useFakeTimers()

    try {
      const kv = createFakeConnectorKv()
      const put = kv.put.getMockImplementation()!

      kv.put.mockRejectedValueOnce(new Error('429 Too Many Requests'))
        .mockImplementation(put)

      const pending = createConnectorCallLimiter(kv as never)(1, 'c1')

      await vi.advanceTimersByTimeAsync(1_100)

      expect(await pending).toEqual({ status: 'allowed' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts parallel calls one at a time, so no write is lost', async () => {
    const kv = createFakeConnectorKv()
    const limit = createConnectorCallLimiter(kv as never)
    let active = 0
    let peak = 0
    const get = kv.get.getMockImplementation()!

    kv.get.mockImplementation(async (key: string) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise(resolve => setTimeout(resolve, 2))
      active -= 1

      return await get(key)
    })

    await Promise.all(Array.from({ length: 5 }, () => limit(1, 'c1')))

    expect(peak).toBe(1)
    expect(JSON.parse(kv.values.get('connectors-calls-connector:1:c1')!))
      .toMatchObject({ count: 5 })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { consumeIconRateLimit } from '~~/server/utils/connectors/icon-rate-limit'
import { createFakeConnectorKv } from '../../../../setup/helpers/connectors-oauth'

type Kv = Parameters<typeof consumeIconRateLimit>[0]

const MINUTE_START = 1_800_000_000_000 - (1_800_000_000_000 % 60_000)

describe('consumeIconRateLimit', () => {
  it('allows the budget, refuses the next and writes KV at most once a second', async () => {
    const kv = createFakeConnectorKv()

    for (let index = 0; index < 300; index += 1) {
      expect((await consumeIconRateLimit(
        kv as unknown as Kv,
        'icons',
        1,
        300,
        MINUTE_START + index,
      )).allowed).toBe(true)
    }

    const blocked = await consumeIconRateLimit(
      kv as unknown as Kv,
      'icons',
      1,
      300,
      MINUTE_START + 500,
    )

    expect(blocked).toEqual({ allowed: false, retryAfter: 60 })
    expect(kv.put).toHaveBeenCalledTimes(1)
  })

  it('starts a new count in the next minute and per user', async () => {
    const kv = createFakeConnectorKv()

    for (let index = 0; index < 3; index += 1) {
      await consumeIconRateLimit(kv as unknown as Kv, 'icons', 1, 3, MINUTE_START)
    }

    expect((await consumeIconRateLimit(
      kv as unknown as Kv, 'icons', 1, 3, MINUTE_START,
    )).allowed).toBe(false)
    expect((await consumeIconRateLimit(
      kv as unknown as Kv, 'icons', 2, 3, MINUTE_START,
    )).allowed).toBe(true)
    expect((await consumeIconRateLimit(
      kv as unknown as Kv, 'icons', 1, 3, MINUTE_START + 60_000,
    )).allowed).toBe(true)
  })

  it('adds what other isolates already counted', async () => {
    const kv = createFakeConnectorKv()

    await kv.put(`icons:1:${MINUTE_START / 60_000}`, '5', { expirationTtl: 120 })

    expect((await consumeIconRateLimit(
      kv as unknown as Kv, 'icons', 1, 5, MINUTE_START,
    )).allowed).toBe(false)
  })

  it('fails open when KV cannot be read or written', async () => {
    const kv = createFakeConnectorKv()

    kv.get.mockRejectedValue(new Error('KV down'))
    kv.put.mockRejectedValue(new Error('429 Too Many Requests'))

    expect((await consumeIconRateLimit(
      kv as unknown as Kv, 'icons', 1, 300, MINUTE_START,
    )).allowed).toBe(true)
    vi.restoreAllMocks()
  })
})

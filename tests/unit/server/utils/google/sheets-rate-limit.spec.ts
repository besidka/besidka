import { describe, expect, it } from 'vitest'
import type { KVNamespace } from '@cloudflare/workers-types'
import {
  createSheetsRequestReserver,
  reserveSheetsRequests,
} from '~~/server/utils/google/sheets-rate-limit'

const MINUTE = 60_000
const START = 1_800_000_000_000 - (1_800_000_000_000 % MINUTE)

function createFakeKv(options: { failGet?: boolean, failPut?: boolean } = {}) {
  const store = new Map<string, string>()
  const writes: Array<{ key: string, at: number }> = []
  const kv = {
    get: async (key: string) => {
      if (options.failGet) {
        throw new Error('kv read down')
      }

      return store.get(key) ?? null
    },
    put: async (key: string, value: string) => {
      if (options.failPut) {
        throw new Error('kv write down')
      }

      store.set(key, value)
      writes.push({ key, at: Date.now() })
    },
  } as unknown as KVNamespace

  return { kv, store, writes }
}

describe('reserveSheetsRequests', () => {
  it('grants what is asked while both buckets have room', async () => {
    const { kv } = createFakeKv()

    expect(await reserveSheetsRequests(kv, 1, 1, START)).toEqual({
      granted: 1,
      limitedBy: null,
      kvUnavailable: false,
    })
    expect((await reserveSheetsRequests(kv, 1, 20, START + 5)).granted)
      .toBe(20)
  })

  it('stops a user at 30 a minute and names the user bucket', async () => {
    const { kv } = createFakeKv()

    await reserveSheetsRequests(kv, 1, 25, START)

    const partial = await reserveSheetsRequests(kv, 1, 10, START + 10)

    expect(partial).toMatchObject({ granted: 5, limitedBy: 'user' })

    const refused = await reserveSheetsRequests(kv, 1, 1, START + 20)

    expect(refused).toMatchObject({ granted: 0, limitedBy: 'user' })
    expect((await reserveSheetsRequests(kv, 2, 1, START + 30)).granted)
      .toBe(1)
  })

  it('stops the whole app at 200 a minute and names the app bucket',
    async () => {
      const { kv } = createFakeKv()

      for (let user = 1; user <= 7; user += 1) {
        await reserveSheetsRequests(kv, user, 28, START + user)
      }

      const refused = await reserveSheetsRequests(kv, 8, 10, START + 100)

      expect(refused).toMatchObject({ granted: 4, limitedBy: 'app' })
      expect(await reserveSheetsRequests(kv, 9, 1, START + 110))
        .toMatchObject({ granted: 0, limitedBy: 'app' })
    })

  it('starts a new count every calendar minute', async () => {
    const { kv } = createFakeKv()

    await reserveSheetsRequests(kv, 1, 30, START)

    expect((await reserveSheetsRequests(kv, 1, 1, START + 50)).granted)
      .toBe(0)
    expect((await reserveSheetsRequests(kv, 1, 1, START + MINUTE)).granted)
      .toBe(1)
  })

  it('writes each bucket to KV at most once a second', async () => {
    const { kv, writes } = createFakeKv()

    for (let step = 0; step < 6; step += 1) {
      await reserveSheetsRequests(kv, 1, 1, START + step * 100)
    }

    expect(writes.length).toBe(2)

    await reserveSheetsRequests(kv, 1, 1, START + 1500)

    expect(writes.length).toBe(4)
    expect([...new Set(writes.map(write => write.key))]).toHaveLength(2)
  })

  it('adds what another isolate already counted', async () => {
    const { kv, store } = createFakeKv()
    const minute = Math.floor(START / MINUTE)

    store.set(`google-sheets-rate-limit:user:1:${minute}`, '28')

    const reservation = await reserveSheetsRequests(kv, 1, 5, START)

    expect(reservation).toMatchObject({ granted: 2, limitedBy: 'user' })
  })

  it('does not refuse when KV fails and says so, apart from a refusal',
    async () => {
      const { kv } = createFakeKv({ failGet: true, failPut: true })

      expect(await reserveSheetsRequests(kv, 1, 3, START)).toEqual({
        granted: 3,
        limitedBy: null,
        kvUnavailable: true,
      })
      expect((await reserveSheetsRequests(kv, 1, 40, START + 1500)))
        .toMatchObject({ granted: 27, limitedBy: 'user', kvUnavailable: true })
    })

  it('binds a reserver to one user', async () => {
    const { kv } = createFakeKv()
    const reserve = createSheetsRequestReserver(kv, 5)

    expect((await reserve(2)).granted).toBe(2)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BUILTIN_COMMAND_RATE_LIMIT,
  enforceBuiltinCommandRateLimit,
} from '~~/server/utils/chats/builtin-command-rate-limit'

const store = new Map<string, string>()
const kv = {
  get: vi.fn(async (key: string) => store.get(key) ?? null),
  put: vi.fn(async (key: string, value: string) => {
    store.set(key, value)
  }),
}

function createEvent() {
  const headers = new Map<string, string>()

  return {
    event: {
      res: { headers: { set: (name: string, value: string) => {
        headers.set(name, value)
      } } },
    } as never,
    headers,
  }
}

describe('enforceBuiltinCommandRateLimit', () => {
  beforeEach(() => {
    store.clear()
    kv.get.mockClear()
    kv.put.mockClear()
    vi.stubGlobal('useKV', () => kv)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('allows 30 runs a minute and refuses the 31st with 429', async () => {
    const { event, headers } = createEvent()

    expect(BUILTIN_COMMAND_RATE_LIMIT.max).toBe(30)

    for (let run = 0; run < BUILTIN_COMMAND_RATE_LIMIT.max; run++) {
      await enforceBuiltinCommandRateLimit(7, event)
    }

    await expect(enforceBuiltinCommandRateLimit(7, event)).rejects
      .toMatchObject({ status: 429 })
    expect(Number(headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('counts every user on their own key', async () => {
    for (let run = 0; run < BUILTIN_COMMAND_RATE_LIMIT.max; run++) {
      await enforceBuiltinCommandRateLimit(7)
    }

    await expect(enforceBuiltinCommandRateLimit(8)).resolves.toBeUndefined()
    expect([...store.keys()].every((key) => {
      return key.startsWith('builtin-command-rate-limit:')
    })).toBe(true)
  })

  it('refuses the run when KV fails instead of letting it through', async () => {
    kv.get.mockRejectedValueOnce(new Error('kv unavailable'))

    await expect(enforceBuiltinCommandRateLimit(7)).rejects
      .toMatchObject({ status: 429 })
  })
})

import { describe, expect, it, vi } from 'vitest'
import type { KVNamespace } from '@cloudflare/workers-types'
import {
  MCP_PRIVATE_TOOL_RATE_LIMIT,
  MCP_PRIVATE_WRITE_RATE_LIMIT,
} from '~~/config/mcp-server'
import { CURRENT_CONSENT_VERSION } from '~~/server/utils/legal/consent'
import {
  assertMcpToolAuthorized,
  enforceMcpToolRateLimit,
  requireMcpLegalConsent,
} from '~~/server/utils/mcp/private-access'

const SITE_URL = 'https://besidka.com'

function createKv(): KVNamespace {
  const store = new Map<string, string>()

  return {
    get: vi.fn(async (key: string) => {
      return store.get(key) ?? null
    }),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
  } as unknown as KVNamespace
}

function createConsentDb(settings: Record<string, unknown> | undefined) {
  return {
    query: {
      userSettings: {
        findFirst: vi.fn(async () => {
          return settings
        }),
      },
    },
  } as unknown as ReturnType<typeof useDb>
}

async function readError(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status?: number, message: string }
  }

  throw new Error('Expected a rejection')
}

describe('assertMcpToolAuthorized', () => {
  const auth = { userId: 1, clientId: 'client', scopes: ['chats:read'] }

  it('returns the context when the scope was granted', () => {
    expect(assertMcpToolAuthorized(auth, 'get_chat')).toBe(auth)
  })

  it('refuses a call without verified auth', () => {
    expect(() => {
      assertMcpToolAuthorized(undefined, 'get_chat')
    }).toThrow(expect.objectContaining({ status: 401 }))
  })

  it('refuses a call without the tool scope', () => {
    expect(() => {
      assertMcpToolAuthorized(auth, 'add_memory')
    }).toThrow(expect.objectContaining({
      status: 403,
      message: expect.stringContaining('memory:write'),
    }))
  })
})

describe('requireMcpLegalConsent', () => {
  it('passes a user with current consent', async () => {
    const grantedAt = new Date('2026-10-20T10:00:00Z')
    const db = createConsentDb({
      termsAcceptedAt: grantedAt,
      termsVersion: CURRENT_CONSENT_VERSION,
      ageConfirmedAt: grantedAt,
      sensitiveContentConsentAt: grantedAt,
      sensitiveContentConsentVersion: CURRENT_CONSENT_VERSION,
      sensitiveContentConsentWithdrawnAt: null,
      providerTransferConsents: null,
    })

    await expect(requireMcpLegalConsent(1, SITE_URL, db)).resolves
      .toBeUndefined()
  })

  it('refuses reads and writes without consent and says where to fix it',
    async () => {
      const error = await readError(
        requireMcpLegalConsent(1, SITE_URL, createConsentDb(undefined)),
      )

      expect(error.status).toBe(403)
      expect(error.message).toContain(SITE_URL)
      expect(error.message).toContain('neither read nor change')
    })

  it('refuses withdrawn consent', async () => {
    const grantedAt = new Date('2026-10-20T10:00:00Z')
    const error = await readError(requireMcpLegalConsent(1, SITE_URL,
      createConsentDb({
        termsAcceptedAt: grantedAt,
        termsVersion: CURRENT_CONSENT_VERSION,
        ageConfirmedAt: grantedAt,
        sensitiveContentConsentAt: grantedAt,
        sensitiveContentConsentVersion: CURRENT_CONSENT_VERSION,
        sensitiveContentConsentWithdrawnAt: new Date('2026-10-21T10:00:00Z'),
      })))

    expect(error.status).toBe(403)
    expect(error.message).toContain('withdrew')
  })
})

describe('enforceMcpToolRateLimit', () => {
  it('allows the read budget and then answers 429', async () => {
    const kv = createKv()

    for (let call = 0; call < MCP_PRIVATE_TOOL_RATE_LIMIT.max; call++) {
      await enforceMcpToolRateLimit(7, 'list_chats', kv)
    }

    const error = await readError(enforceMcpToolRateLimit(7, 'list_chats', kv))

    expect(error.status).toBe(429)
    expect(error.message).toContain('Too many Besidka tool calls')
  })

  it('applies the lower write budget to write tools', async () => {
    const kv = createKv()

    for (let call = 0; call < MCP_PRIVATE_WRITE_RATE_LIMIT.max; call++) {
      await enforceMcpToolRateLimit(7, 'add_memory', kv)
    }

    const error = await readError(enforceMcpToolRateLimit(7, 'add_memory', kv))

    expect(error.status).toBe(429)
    await expect(enforceMcpToolRateLimit(7, 'list_memory', kv)).resolves
      .toBeUndefined()
  })

  it('counts each user separately', async () => {
    const kv = createKv()

    for (let call = 0; call < MCP_PRIVATE_WRITE_RATE_LIMIT.max; call++) {
      await enforceMcpToolRateLimit(7, 'add_memory', kv)
    }

    await expect(enforceMcpToolRateLimit(8, 'add_memory', kv)).resolves
      .toBeUndefined()
  })
})

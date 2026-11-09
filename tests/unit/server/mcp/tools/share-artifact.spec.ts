import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  authWithScopes,
  parseToolResult,
  registerChatToolContractTests,
  stubMcpToolGlobals,
} from './chat-tool-contract'
import type { McpToolShape } from './chat-tool-contract'

const mocks = vi.hoisted(() => {
  return {
    logger: { set: vi.fn(), error: vi.fn() },
    enforceMcpToolRateLimit: vi.fn(),
    requireMcpLegalConsent: vi.fn(),
    shareMcpArtifact: vi.fn(),
  }
})

vi.mock('nitropack/runtime', () => {
  return {
    defineCachedFunction: vi.fn(),
    useNitroApp: vi.fn(),
    useStorage: vi.fn(),
  }
})

vi.mock('~~/server/utils/logging/request-logger', () => {
  return { useRequestLogger: () => mocks.logger }
})

vi.mock('~~/server/utils/mcp/auth', () => {
  return { resolveMcpSiteUrl: () => 'https://besidka.com' }
})

vi.mock('~~/server/utils/artifacts/blob-store', () => {
  return { useArtifactBlobStore: () => ({ marker: 'storage' }) }
})

vi.mock('~~/server/utils/mcp/private-access', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private-access')
  >()

  return {
    ...original,
    enforceMcpToolRateLimit: mocks.enforceMcpToolRateLimit,
    requireMcpLegalConsent: mocks.requireMcpLegalConsent,
  }
})

vi.mock('~~/server/utils/mcp/private/artifacts', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/artifacts')
  >()

  return { ...original, shareMcpArtifact: mocks.shareMcpArtifact }
})

const SCOPE = 'artifacts:share'
const RESULT = { shareId: 'sh_1', url: 'https://besidka.com/a/secret-token', expiresAt: '2026-11-16T12:00:00.000Z', warnings: ['email'] }
const VALID_INPUT = { id: 'a1', expiresInDays: 7 }
const EXPECTED_CONTEXT = {
  db: { marker: 'db' },
  storage: { marker: 'storage' },
  kv: { marker: 'kv' },
  userId: 42,
  clientId: 'client-abc',
  logger: mocks.logger,
  siteUrl: 'https://besidka.com',
}

async function loadTool(context: Record<string, unknown>) {
  stubMcpToolGlobals(context)
  vi.stubGlobal('useKV', () => ({ marker: 'kv' }))

  const module = await import('~~/server/mcp/tools/share-artifact')

  return module.default as unknown as McpToolShape
}

describe('share_artifact tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.shareMcpArtifact.mockReset().mockResolvedValue(RESULT)
  })

  registerChatToolContractTests({
    name: 'share_artifact',
    scope: SCOPE,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    descriptionIncludes: ['Anyone who has the link can open the artifact', 'can report it', 'at most 30', 'never indexed', 'At most 10 links a day', 'created through connected apps', 'warnings', 'revoke_artifact_shares'],
    validInput: VALID_INPUT,
    mocks,
    domainMock: mocks.shareMcpArtifact,
    load: loadTool,
  })

  it('requires an expiry of 1 to 30 whole days', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes([SCOPE]),
    })
    const schema = z.object(inputSchema)

    expect(schema.safeParse({ id: 'a1', expiresInDays: 1 }).success)
      .toBe(true)
    expect(schema.safeParse({ id: 'a1', expiresInDays: 30 }).success)
      .toBe(true)
    expect(schema.safeParse({ id: 'a1' }).success).toBe(false)
    expect(schema.safeParse({ id: 'a1', expiresInDays: 0 }).success)
      .toBe(false)
    expect(schema.safeParse({ id: 'a1', expiresInDays: 31 }).success)
      .toBe(false)
    expect(schema.safeParse({ id: 'a1', expiresInDays: 1.5 }).success)
      .toBe(false)
  })

  it('offers no way to turn on viewer storage or the model bridge',
    async () => {
      const { inputSchema } = await loadTool({
        mcpAuth: authWithScopes([SCOPE]),
      })

      expect(Object.keys(inputSchema).sort())
        .toEqual(['expiresInDays', 'id', 'pinnedVersion'])
    })

  it('bounds the pinned version', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes([SCOPE]),
    })
    const schema = z.object(inputSchema)

    expect(schema.safeParse({
      id: 'a1',
      expiresInDays: 7,
      pinnedVersion: 2,
    }).success).toBe(true)
    expect(schema.safeParse({
      id: 'a1',
      expiresInDays: 7,
      pinnedVersion: 0,
    }).success).toBe(false)
  })

  it('never logs the link or its token', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })

    await tool.handler(VALID_INPUT)

    expect(JSON.stringify(mocks.logger.set.mock.calls))
      .not.toContain('secret-token')
  })

  it('passes the caller context and the input to the logic', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })
    const result = await tool.handler(VALID_INPUT)

    expect(mocks.shareMcpArtifact)
      .toHaveBeenCalledWith(EXPECTED_CONTEXT, VALID_INPUT)
    expect(parseToolResult(result)).toEqual(RESULT)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { artifact_id: 'a1', share_id: 'sh_1', expires_in_days: 7, warning_count: 1 },
    })
  })

  it('passes a client error of the logic through', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })

    mocks.shareMcpArtifact.mockRejectedValue(
      Object.assign(new Error('Artifact not found'), { status: 404 }),
    )

    await expect(tool.handler(VALID_INPUT))
      .rejects.toMatchObject({ status: 404, message: 'Artifact not found' })
  })
})

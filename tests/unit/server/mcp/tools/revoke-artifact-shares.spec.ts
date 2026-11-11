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
    revokeMcpArtifactShares: vi.fn(),
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

  return { ...original, revokeMcpArtifactShares: mocks.revokeMcpArtifactShares }
})

const SCOPE = 'artifacts:write'
const RESULT = { revoked: 2, notFound: [] }
const VALID_INPUT = { shareIds: ['sh_1'] }
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

  const module = await import('~~/server/mcp/tools/revoke-artifact-shares')

  return module.default as unknown as McpToolShape
}

describe('revoke_artifact_shares tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.revokeMcpArtifactShares.mockReset().mockResolvedValue(RESULT)
  })

  registerChatToolContractTests({
    name: 'revoke_artifact_shares',
    scope: SCOPE,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    descriptionIncludes: ['stop working at once', 'cannot be recalled'],
    validInput: VALID_INPUT,
    mocks,
    domainMock: mocks.revokeMcpArtifactShares,
    load: loadTool,
  })

  it('accepts 1 to 50 ids of either kind', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes([SCOPE]),
    })
    const schema = z.object(inputSchema)
    const ids = (count: number) => {
      return Array.from({ length: count }, (_, index) => `id-${index}`)
    }

    expect(schema.safeParse({ shareIds: ids(1) }).success).toBe(true)
    expect(schema.safeParse({ shareIds: ids(50) }).success).toBe(true)
    expect(schema.safeParse({ shareIds: ids(51) }).success).toBe(false)
    expect(schema.safeParse({ shareIds: [] }).success).toBe(false)
    expect(schema.safeParse({ artifactIds: ids(50) }).success).toBe(true)
    expect(schema.safeParse({ artifactIds: ids(51) }).success).toBe(false)
  })

  it('passes the caller context and the input to the logic', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })
    const result = await tool.handler(VALID_INPUT)

    expect(mocks.revokeMcpArtifactShares)
      .toHaveBeenCalledWith(EXPECTED_CONTEXT, VALID_INPUT)
    expect(parseToolResult(result)).toEqual(RESULT)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { requested_count: 1, revoked_count: 2, not_found_count: 0 },
    })
  })

  it('passes a client error of the logic through', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })

    mocks.revokeMcpArtifactShares.mockRejectedValue(
      Object.assign(new Error('Artifact not found'), { status: 404 }),
    )

    await expect(tool.handler(VALID_INPUT))
      .rejects.toMatchObject({ status: 404, message: 'Artifact not found' })
  })
})

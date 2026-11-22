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
    listMcpArtifactShares: vi.fn(),
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

  return { ...original, listMcpArtifactShares: mocks.listMcpArtifactShares }
})

const SCOPE = 'artifacts:read'
const RESULT = [{ shareId: 'sh_1', url: 'https://besidka.com/a/token', createdVia: 'mcp' }]
const VALID_INPUT = { id: 'a1' }
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

  const module = await import('~~/server/mcp/tools/list-artifact-shares')

  return module.default as unknown as McpToolShape
}

describe('list_artifact_shares tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.listMcpArtifactShares.mockReset().mockResolvedValue(RESULT)
  })

  registerChatToolContractTests({
    name: 'list_artifact_shares',
    scope: SCOPE,
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    descriptionIncludes: [
      'active public links',
      'capabilities',
      'artifacts:share',
      'Requires signing in (artifacts:read).',
    ],
    validInput: VALID_INPUT,
    mocks,
    domainMock: mocks.listMcpArtifactShares,
    load: loadTool,
  })

  it('needs an artifact id', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes([SCOPE]),
    })
    const schema = z.object(inputSchema)

    expect(schema.safeParse({ id: 'a1' }).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ id: '' }).success).toBe(false)
  })

  it('passes the caller context and the input to the logic', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })
    const result = await tool.handler(VALID_INPUT)

    expect(mocks.listMcpArtifactShares).toHaveBeenCalledWith(
      EXPECTED_CONTEXT,
      VALID_INPUT,
      { includeUrls: false },
    )
    expect(parseToolResult(result)).toEqual(RESULT)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { artifact_id: 'a1', result_count: 1 },
    })
  })

  it('asks for the links only when the token has artifacts:share', async () => {
    const tool = await loadTool({
      mcpAuth: authWithScopes([SCOPE, 'artifacts:share']),
    })

    await tool.handler(VALID_INPUT)

    expect(mocks.listMcpArtifactShares).toHaveBeenCalledWith(
      EXPECTED_CONTEXT,
      VALID_INPUT,
      { includeUrls: true },
    )
  })

  it('passes a client error of the logic through', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })

    mocks.listMcpArtifactShares.mockRejectedValue(
      Object.assign(new Error('Artifact not found'), { status: 404 }),
    )

    await expect(tool.handler(VALID_INPUT))
      .rejects.toMatchObject({ status: 404, message: 'Artifact not found' })
  })
})

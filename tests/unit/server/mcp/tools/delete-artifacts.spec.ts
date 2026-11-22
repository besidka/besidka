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
    deleteMcpArtifacts: vi.fn(),
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

  return { ...original, deleteMcpArtifacts: mocks.deleteMcpArtifacts }
})

const SCOPE = 'data:delete'
const RESULT = { deleted: ['a1'], held: [], notFound: [] }
const VALID_INPUT = { ids: ['a1'], confirm: true }
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

  const module = await import('~~/server/mcp/tools/delete-artifacts')

  return module.default as unknown as McpToolShape
}

describe('delete_artifacts tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.deleteMcpArtifacts.mockReset().mockResolvedValue(RESULT)
  })

  registerChatToolContractTests({
    name: 'delete_artifacts',
    scope: SCOPE,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    descriptionIncludes: ['Permanently delete', 'legal hold', 'cannot be restored'],
    validInput: VALID_INPUT,
    mocks,
    domainMock: mocks.deleteMcpArtifacts,
    load: loadTool,
  })

  it('needs confirm: true and at most 20 ids', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes([SCOPE]),
    })
    const schema = z.object(inputSchema)
    const ids = (count: number) => {
      return Array.from({ length: count }, (_, index) => `id-${index}`)
    }

    expect(schema.safeParse({ ids: ids(20), confirm: true }).success)
      .toBe(true)
    expect(schema.safeParse({ ids: ids(21), confirm: true }).success)
      .toBe(false)
    expect(schema.safeParse({ ids: [], confirm: true }).success).toBe(false)
    expect(schema.safeParse({ ids: ids(1), confirm: false }).success)
      .toBe(false)
    expect(schema.safeParse({ ids: ids(1) }).success).toBe(false)
  })

  it('counts against the delete limiter', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })

    await tool.handler(VALID_INPUT)

    expect(mocks.enforceMcpToolRateLimit)
      .toHaveBeenCalledWith(42, 'delete_artifacts')
  })

  it('passes the caller context and the input to the logic', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })
    const result = await tool.handler(VALID_INPUT)

    expect(mocks.deleteMcpArtifacts)
      .toHaveBeenCalledWith(EXPECTED_CONTEXT, VALID_INPUT)
    expect(parseToolResult(result)).toEqual(RESULT)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: {
        requested_count: 1,
        deleted_count: 1,
        held_count: 0,
        not_found_count: 0,
      },
    })
  })

  it('passes a client error of the logic through', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })

    mocks.deleteMcpArtifacts.mockRejectedValue(
      Object.assign(new Error('Artifact not found'), { status: 404 }),
    )

    await expect(tool.handler(VALID_INPUT))
      .rejects.toMatchObject({ status: 404, message: 'Artifact not found' })
  })
})

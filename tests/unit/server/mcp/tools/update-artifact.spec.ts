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
    updateMcpArtifact: vi.fn(),
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

  return { ...original, updateMcpArtifact: mocks.updateMcpArtifact }
})

const SCOPE = 'artifacts:write'
const RESULT = { id: 'a1', version: 2 }
const VALID_INPUT = { id: 'a1', content: '<p>y</p>' }
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

  const module = await import('~~/server/mcp/tools/update-artifact')

  return module.default as unknown as McpToolShape
}

describe('update_artifact tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.updateMcpArtifact.mockReset().mockResolvedValue(RESULT)
  })

  registerChatToolContractTests({
    name: 'update_artifact',
    scope: SCOPE,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    descriptionIncludes: ['`edits`', 'exactly once', 'nothing is saved', 'Older versions are kept'],
    validInput: VALID_INPUT,
    mocks,
    domainMock: mocks.updateMcpArtifact,
    load: loadTool,
  })

  it('accepts 1 to 20 non-empty edits', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes([SCOPE]),
    })
    const schema = z.object(inputSchema)
    const edits = (count: number) => {
      return Array.from({ length: count }, () => {
        return { old_string: 'a', new_string: 'b' }
      })
    }

    expect(schema.safeParse({ id: 'a1', edits: edits(1) }).success).toBe(true)
    expect(schema.safeParse({ id: 'a1', edits: edits(20) }).success)
      .toBe(true)
    expect(schema.safeParse({ id: 'a1', edits: edits(21) }).success)
      .toBe(false)
    expect(schema.safeParse({ id: 'a1', edits: [] }).success).toBe(false)
    expect(schema.safeParse({
      id: 'a1',
      edits: [{ old_string: '', new_string: 'b' }],
    }).success).toBe(false)
    expect(schema.safeParse({
      id: 'a1',
      edits: [{ old_string: 'a', new_string: '' }],
    }).success).toBe(true)
  })

  it('bounds title and content', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes([SCOPE]),
    })
    const schema = z.object(inputSchema)

    expect(schema.safeParse({ id: 'a1', title: 'x'.repeat(121) }).success)
      .toBe(false)
    expect(schema.safeParse({
      id: 'a1',
      content: 'x'.repeat(200_001),
    }).success).toBe(false)
    expect(schema.safeParse({ id: '', content: 'x' }).success).toBe(false)
  })

  it('logs how many edits were applied', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })

    await tool.handler({
      id: 'a1',
      edits: [{ old_string: 'a', new_string: 'b' }],
    })

    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { artifact_id: 'a1', artifact_version: 2, edit_count: 1 },
    })
  })

  it('passes the caller context and the input to the logic', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })
    const result = await tool.handler(VALID_INPUT)

    expect(mocks.updateMcpArtifact)
      .toHaveBeenCalledWith(EXPECTED_CONTEXT, VALID_INPUT)
    expect(parseToolResult(result)).toEqual(RESULT)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { artifact_id: 'a1', artifact_version: 2, edit_count: 0 },
    })
  })

  it('passes a client error of the logic through', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })

    mocks.updateMcpArtifact.mockRejectedValue(
      Object.assign(new Error('Artifact not found'), { status: 404 }),
    )

    await expect(tool.handler(VALID_INPUT))
      .rejects.toMatchObject({ status: 404, message: 'Artifact not found' })
  })
})

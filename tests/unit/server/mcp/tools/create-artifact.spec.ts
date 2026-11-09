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
    createMcpArtifact: vi.fn(),
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

  return { ...original, createMcpArtifact: mocks.createMcpArtifact }
})

const SCOPE = 'artifacts:write'
const RESULT = { id: 'a1', version: 1, url_in_app: 'https://besidka.com/chats/artifacts?artifact=a1' }
const VALID_INPUT = { kind: 'html', title: 'Quiz', content: '<p>x</p>' }
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

  const module = await import('~~/server/mcp/tools/create-artifact')

  return module.default as unknown as McpToolShape
}

describe('create_artifact tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.createMcpArtifact.mockReset().mockResolvedValue(RESULT)
  })

  registerChatToolContractTests({
    name: 'create_artifact',
    scope: SCOPE,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    descriptionIncludes: ['new Besidka artifact', 'none of your API keys'],
    validInput: VALID_INPUT,
    mocks,
    domainMock: mocks.createMcpArtifact,
    load: loadTool,
  })

  it('bounds kind, title and content', async () => {
    const { inputSchema } = await loadTool({
      mcpAuth: authWithScopes([SCOPE]),
    })
    const schema = z.object(inputSchema)
    const input = (overrides: Record<string, unknown>) => {
      return { ...VALID_INPUT, ...overrides }
    }

    expect(schema.safeParse(input({ title: 'x'.repeat(120) })).success)
      .toBe(true)
    expect(schema.safeParse(input({ title: 'x'.repeat(121) })).success)
      .toBe(false)
    expect(schema.safeParse(input({ title: '   ' })).success).toBe(false)
    expect(schema.safeParse(input({ content: 'x'.repeat(200_000) })).success)
      .toBe(true)
    expect(schema.safeParse(input({ content: 'x'.repeat(200_001) })).success)
      .toBe(false)
    expect(schema.safeParse(input({ content: '' })).success).toBe(false)

    for (const kind of ['html', 'react', 'svg', 'mermaid', 'markdown']) {
      expect(schema.safeParse(input({ kind })).success, kind).toBe(true)
    }

    expect(schema.safeParse(input({ kind: 'pdf' })).success).toBe(false)
  })

  it('passes the caller context and the input to the logic', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })
    const result = await tool.handler(VALID_INPUT)

    expect(mocks.createMcpArtifact)
      .toHaveBeenCalledWith(EXPECTED_CONTEXT, VALID_INPUT)
    expect(parseToolResult(result)).toEqual(RESULT)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { artifact_id: 'a1', artifact_kind: 'html', text_bytes: 8 },
    })
  })

  it('passes a client error of the logic through', async () => {
    const tool = await loadTool({ mcpAuth: authWithScopes([SCOPE]) })

    mocks.createMcpArtifact.mockRejectedValue(
      Object.assign(new Error('Artifact not found'), { status: 404 }),
    )

    await expect(tool.handler(VALID_INPUT))
      .rejects.toMatchObject({ status: 404, message: 'Artifact not found' })
  })
})

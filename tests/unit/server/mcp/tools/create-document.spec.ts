import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES } from '~~/config/mcp-server'
import {
  TEST_MCP_AUTH,
  loadMcpTool,
  parseToolPayload,
} from '../../../../setup/helpers/mcp-tool'

const mocks = vi.hoisted(() => {
  return {
    logger: { set: vi.fn(), error: vi.fn() },
    enforceMcpToolRateLimit: vi.fn(),
    requireMcpLegalConsent: vi.fn(),
    createMcpDocument: vi.fn(),
  }
})

vi.mock('cloudflare:workers', () => ({ env: {} }))

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

vi.mock('~~/server/utils/mcp/private/files', () => {
  return {
    MCP_FILE_NAME_MAX_CHARS: 255,
    MCP_FILE_TEXT_MAX_CHARS: 200_000,
  }
})

vi.mock('~~/server/utils/mcp/private/documents', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/documents')
  >()

  return { ...original, createMcpDocument: mocks.createMcpDocument }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['files:write'] }

const VALID_INPUT = {
  format: 'pdf',
  title: 'Trip plan',
  spec: {
    specVersion: 1,
    language: 'en',
    pageSize: 'A4',
    blocks: [{ type: 'heading', level: 1, text: 'Trip plan' }],
  },
}

const FILE_RESULT = {
  documentId: 'doc1',
  file: {
    id: 'file1',
    name: 'Trip plan.pdf',
    size: 2048,
    type: 'application/pdf',
    expiresAt: null,
  },
  format: 'pdf',
  stats: { pages: 1 },
}

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/create-document'),
    context,
  )
}

function collectKeywordPaths(
  node: unknown,
  path: string,
  keywords: readonly string[],
): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((entry, index) => {
      return collectKeywordPaths(entry, `${path}[${index}]`, keywords)
    })
  }

  if (typeof node !== 'object' || node === null) {
    return []
  }

  return Object.entries(node).flatMap(([key, value]) => {
    const own = keywords.includes(key) ? [`${path}.${key}`] : []

    return [...own, ...collectKeywordPaths(value, `${path}.${key}`, keywords)]
  })
}

describe('create_document tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.createMcpDocument.mockReset()
    mocks.createMcpDocument.mockResolvedValue(FILE_RESULT)
    vi.stubGlobal('useKV', () => {
      return { marker: 'kv' }
    })
  })

  it('declares a non-destructive write with the documented scope',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })

      expect(tool.name).toBe('create_document')
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      })
      expect(tool.description.endsWith('Requires signing in (files:write).'))
        .toBe(true)
    })

  it('tells clients about keys, images, AI marking and the limits',
    async () => {
      const { description } = await loadTool({ mcpAuth: AUTH })

      expect(description).toContain('no API key of yours is used')
      expect(description).toContain('storage quota')
      expect(description).toContain('expires like an upload')
      expect(description).toContain('list_files')
      expect(description).toContain('set `aiGenerated` to true')
      expect(description).toContain('200 pages')
      expect(description).toContain('60 slides')
      expect(description).toContain('100000 cells')
      expect(description).toContain('20 MB')
      expect(description).toContain('200000 characters')
      expect(description).toContain('JSON object, not a string')
      expect(description).toContain('at most 512 KiB')
    })

  it('says that both theme fields are optional', async () => {
    const { description } = await loadTool({ mcpAuth: AUTH })

    expect(description).toContain('"font"?:"sans"|"serif"')
    expect(description).toContain('"accent"?:')
    expect(description).toContain('both fields are optional')
  })

  it('fits a 200000 character Cyrillic spec into the request body cap',
    async () => {
      const text = 'Ж'.repeat(190_000)
      const spec = {
        specVersion: 1,
        language: 'uk',
        pageSize: 'A4',
        blocks: [{ type: 'paragraph', runs: [{ text }] }],
      }
      const padding = 200_000 - JSON.stringify(spec).length
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_document',
          arguments: {
            format: 'pdf',
            title: 'Ж'.repeat(200),
            fileName: 'Ж'.repeat(255),
            spec: {
              ...spec,
              blocks: [{
                type: 'paragraph',
                runs: [{ text: text + 'Ж'.repeat(Math.max(0, padding)) }],
              }],
            },
          },
        },
      })

      expect(new TextEncoder().encode(body).byteLength)
        .toBeLessThan(MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES)
    })

  it('serializes to a top-level object schema without unions', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const { $schema: _schema, ...serialized } = z.toJSONSchema(
      z.object(inputSchema!),
      { io: 'input' },
    ) as Record<string, unknown> & { $schema?: string }
    const properties = serialized.properties as Record<
      string,
      Record<string, unknown>
    >

    expect(serialized.type).toBe('object')
    expect(properties.spec!.type).toBe('object')
    expect(properties.format!.enum).toEqual(['pdf', 'docx', 'pptx', 'xlsx'])
    expect(serialized.required).toEqual(['format', 'title', 'spec'])
    expect(collectKeywordPaths(
      serialized,
      '$',
      ['oneOf', 'anyOf', 'allOf', 'not'],
    )).toEqual([])
  })

  it('keeps tools/list small by not inlining the per-format spec shape',
    async () => {
      const { inputSchema } = await loadTool({ mcpAuth: AUTH })
      const serialized = JSON.stringify(z.toJSONSchema(z.object(inputSchema!)))

      expect(serialized.length).toBeLessThan(2500)
    })

  it('takes the spec as an object and bounds the other fields', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema!)

    expect(schema.safeParse(VALID_INPUT).success).toBe(true)
    expect(schema.safeParse({
      ...VALID_INPUT,
      spec: JSON.stringify(VALID_INPUT.spec),
    }).success).toBe(false)
    expect(schema.safeParse({ ...VALID_INPUT, spec: [] }).success)
      .toBe(false)
    expect(schema.safeParse({
      ...VALID_INPUT,
      spec: { ...VALID_INPUT.spec, specVersion: 1.5 },
    }).success).toBe(false)
    expect(schema.safeParse({
      ...VALID_INPUT,
      spec: { blocks: [], futureField: { nested: true } },
    }).success).toBe(true)
    expect(schema.safeParse({ ...VALID_INPUT, format: 'odt' }).success)
      .toBe(false)
    expect(schema.safeParse({ ...VALID_INPUT, title: '   ' }).success)
      .toBe(false)
    expect(schema.safeParse({
      ...VALID_INPUT,
      title: 'x'.repeat(201),
    }).success).toBe(false)
    expect(schema.safeParse({
      ...VALID_INPUT,
      fileName: 'x'.repeat(256),
    }).success).toBe(false)
    expect(schema.safeParse({ ...VALID_INPUT, aiGenerated: 'yes' }).success)
      .toBe(false)
  })

  it('creates the document for the token user and logs ids only',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })
      const payload = parseToolPayload(await tool.handler(VALID_INPUT))

      expect(mocks.createMcpDocument).toHaveBeenCalledWith(
        {
          db: { marker: 'db' },
          kv: { marker: 'kv' },
          userId: 42,
          logger: mocks.logger,
        },
        VALID_INPUT,
      )
      expect(payload).toMatchObject({
        documentId: 'doc1',
        file: { id: 'file1' },
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'write' },
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: {
          document_id: 'doc1',
          file_id: 'file1',
          format: 'pdf',
          bytes: 2048,
        },
      })

      const logged = JSON.stringify(mocks.logger.set.mock.calls)

      expect(logged).not.toContain('Trip plan')
    })

  it('passes a readable refusal through', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.createMcpDocument.mockRejectedValue(
      Object.assign(new Error('Invalid document spec.'), { status: 422 }),
    )

    await expect(tool.handler(VALID_INPUT))
      .rejects.toMatchObject({ status: 422 })
  })

  it('creates nothing for a token without files:write', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['files:read'] },
    })

    await expect(tool.handler(VALID_INPUT))
      .rejects.toMatchObject({ status: 403 })
    expect(mocks.createMcpDocument).not.toHaveBeenCalled()
  })

  it('refuses a call without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler(VALID_INPUT))
      .rejects.toMatchObject({ status: 401 })
    expect(mocks.createMcpDocument).not.toHaveBeenCalled()
  })

  it('applies the MCP write limit before creating', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.enforceMcpToolRateLimit.mockRejectedValue(
      Object.assign(new Error('Too many calls'), { status: 429 }),
    )

    await expect(tool.handler(VALID_INPUT))
      .rejects.toMatchObject({ status: 429 })
    expect(mocks.enforceMcpToolRateLimit)
      .toHaveBeenCalledWith(42, 'create_document')
    expect(mocks.createMcpDocument).not.toHaveBeenCalled()
  })
})

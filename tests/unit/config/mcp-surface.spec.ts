import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_NAME,
  MCP_SERVER_TITLE,
} from '~~/config/mcp-server'
import {
  MCP_PRIVATE_TOOL_SCOPES,
  getMcpToolRequiredScopes,
} from '~~/server/utils/mcp/tool-scopes'

interface ToolDefinition {
  name: string
  title: string
  description: string
  inputSchema?: z.ZodRawShape
  annotations?: Record<string, boolean | undefined>
}

const SURFACE_FILE = '../../../config/mcp-surface.json'
const ANNOTATION_HINTS = [
  'destructiveHint',
  'idempotentHint',
  'openWorldHint',
  'readOnlyHint',
] as const

const toolModules = import.meta.glob<{ default: ToolDefinition }>(
  '../../../server/mcp/tools/*.ts',
)

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0
  }

  return left < right ? -1 : 1
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys)
  }

  if (value === null || typeof value !== 'object') {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .sort(([leftKey], [rightKey]) => {
        return compareStrings(leftKey, rightKey)
      })
      .map(([key, entry]) => {
        return [key, sortKeys(entry)]
      }),
  )
}

function toInputSchema(shape: z.ZodRawShape | undefined) {
  const { $schema: _schema, ...inputSchema } = z.toJSONSchema(
    z.object(shape ?? {}),
    { io: 'input' },
  )

  return inputSchema
}

function describeTool(tool: ToolDefinition) {
  const requiredScopes = getMcpToolRequiredScopes(tool.name)

  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    public: requiredScopes.length === 0,
    requiredScopes,
    annotations: Object.fromEntries(
      ANNOTATION_HINTS.map((hint) => {
        return [hint, tool.annotations?.[hint] ?? null]
      }),
    ),
    inputSchema: toInputSchema(tool.inputSchema),
  }
}

async function loadTools(): Promise<ToolDefinition[]> {
  const modules = await Promise.all(
    Object.values(toolModules).map((importTool) => {
      return importTool()
    }),
  )

  return modules.map((module) => {
    return module.default
  })
}

describe('MCP surface snapshot', () => {
  let tools: ToolDefinition[] = []

  beforeAll(async () => {
    vi.stubGlobal('defineMcpTool', (definition: unknown) => {
      return definition
    })
    vi.stubGlobal('useEvent', () => {
      return { context: {} }
    })
    vi.stubGlobal('defineCachedFunction', (handler: unknown) => {
      return handler
    })
    vi.stubGlobal('useDb', () => {
      return {}
    })

    tools = await loadTools()
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('loads every tool file with a unique name', () => {
    const names = tools.map((tool) => {
      return tool.name
    })

    expect(names.length).toBe(Object.keys(toolModules).length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('knows every private tool scope', () => {
    const names = tools.map((tool) => {
      return tool.name
    })

    for (const privateName of Object.keys(MCP_PRIVATE_TOOL_SCOPES)) {
      expect(names).toContain(privateName)
    }
  })

  it('matches config/mcp-surface.json', async () => {
    const surface = sortKeys({
      server: {
        name: MCP_SERVER_NAME,
        title: MCP_SERVER_TITLE,
        description: MCP_SERVER_DESCRIPTION,
      },
      tools: tools
        .map(describeTool)
        .sort((left, right) => {
          return compareStrings(left.name, right.name)
        }),
    })

    await expect(
      `${JSON.stringify(surface, null, 2)}\n`,
      'The public MCP surface changed. Run "pnpm run mcp:surface" to update '
      + 'config/mcp-surface.json, then bump MCP_SERVER_VERSION in '
      + 'config/mcp-server.ts and server.json (see docs/mcp-marketplaces.md).',
    ).toMatchFileSnapshot(SURFACE_FILE)
  })
})

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CapabilityConformanceReaders,
  CapabilitySourceFile,
} from '~~/server/capabilities/conformance'
import { MCP_PRIVATE_TOOL_SCOPES } from '~~/server/utils/mcp/tool-scopes'

const API_ROUTES_DIRECTORY = 'server/api/v1'
const MCP_TOOLS_DIRECTORY = 'server/mcp/tools'

function readRepositoryRouteFiles(prefix: string): CapabilitySourceFile[] {
  const directory = join(API_ROUTES_DIRECTORY, prefix)

  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory, { recursive: true })
    .map((entry) => {
      return String(entry).split('\\').join('/')
    })
    .filter((entry) => {
      return entry.endsWith('.ts')
    })
    .map((entry) => {
      const path = `${directory}/${entry}`

      return { path, source: readFileSync(path, 'utf-8') }
    })
}

function readRepositoryMcpToolSource(toolName: string): string | null {
  const path = join(MCP_TOOLS_DIRECTORY, `${toolName.replaceAll('_', '-')}.ts`)

  return existsSync(path) ? readFileSync(path, 'utf-8') : null
}

const repositoryReaders: CapabilityConformanceReaders = {
  readRouteFiles: readRepositoryRouteFiles,
  readMcpToolSource: readRepositoryMcpToolSource,
  mcpToolScopes: MCP_PRIVATE_TOOL_SCOPES,
}

const fixtureReaders: CapabilityConformanceReaders = {
  readRouteFiles: (prefix) => {
    if (prefix === 'demo-artifacts') {
      return [{
        path: 'server/api/v1/demo-artifacts/index.get.ts',
        source: 'await requireFeature(event, \'artifacts\')',
      }]
    }

    if (prefix === 'demo-documents') {
      return [
        {
          path: 'server/api/v1/demo-documents/index.get.ts',
          source: 'await requireFeature(event, \'documents\')',
        },
        {
          path: 'server/api/v1/demo-documents/[id].delete.ts',
          source: 'export default defineEventHandler(async () => {})',
        },
        {
          path: 'server/api/v1/demo-documents/[id].patch.ts',
          source: 'await requireFeature(event, \'artifacts\')',
        },
        {
          path: 'server/api/v1/demo-documents/[id].get.ts',
          source: '// await requireFeature(event, \'documents\')\n'
            + '/* requireFeature(event, \'documents\') */',
        },
        {
          path: 'server/api/v1/demo-documents/pdf.post.ts',
          source: 'await requireFeature(event, \'documents.pdf\')',
        },
      ]
    }

    return []
  },
  readMcpToolSource: (toolName) => {
    if (toolName === 'list_chats') {
      return 'export default defineMcpTool({ handler: async () => {} })\n'
        + '// withMcpPrivateTool(\'list_chats\', handler)'
    }

    return toolName === 'list_memory'
      ? 'export default defineMcpTool({ handler: withMcpPrivateTool(...) })'
      : null
  },
  mcpToolScopes: MCP_PRIVATE_TOOL_SCOPES,
}

async function importContract() {
  const conformance = await import('~~/server/capabilities/conformance')
  const index = await import('~~/server/capabilities/index')

  return { ...conformance, ...index }
}

describe('capability conformance', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('passes for every registered capability', async () => {
    const {
      checkCapabilityConformance,
      listCapabilities,
    } = await importContract()

    const violations = listCapabilities().flatMap((capability) => {
      return checkCapabilityConformance(capability, repositoryReaders)
    })

    expect(violations).toEqual([])
  })

  it('reads the real route tree and MCP tool files', () => {
    expect(readRepositoryRouteFiles('features').map((file) => {
      return file.path
    })).toContain('server/api/v1/features/index.get.ts')
    expect(readRepositoryMcpToolSource('list_memory'))
      .toContain('withMcpPrivateTool(')
    expect(readRepositoryMcpToolSource('missing_tool')).toBeNull()
  })

  it('accepts a compliant fixture', async () => {
    const { checkCapabilityConformance } = await importContract()
    const fixtures = await import('./fixtures/demo')

    expect(checkCapabilityConformance(
      fixtures.demoCompliantCapability,
      fixtureReaders,
    )).toEqual([])
  })

  it('reports a feature that is not in the registry', async () => {
    const { checkCapabilityConformance } = await importContract()
    const fixtures = await import('./fixtures/demo')

    expect(checkCapabilityConformance(
      fixtures.demoUnknownFeatureCapability,
      fixtureReaders,
    )).toEqual([{
      feature: 'demo.unknown',
      rule: 'unknown_feature',
      detail: 'demo.unknown',
    }])
  })

  it('reports route files without a guard for the capability flag', async () => {
    const { checkCapabilityConformance } = await importContract()
    const fixtures = await import('./fixtures/demo')

    expect(checkCapabilityConformance(
      fixtures.demoUnguardedRouteCapability,
      fixtureReaders,
    )).toEqual([
      'server/api/v1/demo-documents/[id].delete.ts',
      'server/api/v1/demo-documents/[id].patch.ts',
      'server/api/v1/demo-documents/[id].get.ts',
    ].map((detail) => {
      return {
        feature: 'documents',
        rule: 'route_without_feature_guard',
        detail,
      }
    }))
  })

  it('reports a route prefix with no route files', async () => {
    const { checkCapabilityConformance } = await importContract()
    const { defineCapability } = await import('~~/server/capabilities/types')

    expect(checkCapabilityConformance(
      defineCapability({ feature: 'skills', routesPrefix: ['demo-missing'] }),
      fixtureReaders,
    )).toEqual([{
      feature: 'skills',
      rule: 'route_prefix_without_routes',
      detail: 'demo-missing',
    }])
  })

  it('reports an MCP tool without a scope or private wrapper', async () => {
    const { checkCapabilityConformance } = await importContract()
    const fixtures = await import('./fixtures/demo')

    expect(checkCapabilityConformance(
      fixtures.demoUnscopedMcpCapability,
      fixtureReaders,
    )).toEqual([
      {
        feature: 'skills',
        rule: 'mcp_tool_without_scope',
        detail: 'demo_unscoped_tool',
      },
      {
        feature: 'skills',
        rule: 'mcp_tool_without_private_wrapper',
        detail: 'demo_unscoped_tool',
      },
    ])
  })

  it('reports a scoped MCP tool without the private wrapper', async () => {
    const { checkCapabilityConformance } = await importContract()
    const fixtures = await import('./fixtures/demo')

    expect(checkCapabilityConformance(
      fixtures.demoUnwrappedMcpCapability,
      fixtureReaders,
    )).toEqual([{
      feature: 'google.drive',
      rule: 'mcp_tool_without_private_wrapper',
      detail: 'list_chats',
    }])
  })

  it('reports jobs without the capability flag', async () => {
    const { checkCapabilityConformance } = await importContract()
    const fixtures = await import('./fixtures/demo')

    expect(checkCapabilityConformance(
      fixtures.demoUnflaggedJobCapability,
      fixtureReaders,
    )).toEqual([
      {
        feature: 'connectors',
        rule: 'job_without_feature',
        detail: 'demo-no-flag',
      },
      {
        feature: 'connectors',
        rule: 'job_without_feature',
        detail: 'demo-foreign-flag',
      },
      {
        feature: 'connectors',
        rule: 'job_without_feature',
        detail: 'demo-unknown-flag',
      },
    ])
  })
})

describe('capability modules', () => {
  it('imports every capability module from the index', () => {
    const contractFiles = new Set(['types.ts', 'index.ts', 'conformance.ts'])
    const indexSource = readFileSync('server/capabilities/index.ts', 'utf-8')
    const moduleFiles = readdirSync('server/capabilities', { recursive: true })
      .map((entry) => {
        return String(entry).split('\\').join('/')
      })
      .filter((entry) => {
        return entry.endsWith('.ts') && !contractFiles.has(entry)
      })

    for (const moduleFile of moduleFiles) {
      expect(indexSource).toContain(
        `~~/server/capabilities/${moduleFile.replace(/\.ts$/, '')}`,
      )
    }
  })
})

describe('capability registry', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('freezes definitions and lists them in registration order', async () => {
    const fixtures = await import('./fixtures/demo')
    const { listCapabilities } = await import('~~/server/capabilities/index')

    expect(Object.isFrozen(fixtures.demoCompliantCapability)).toBe(true)
    expect(Object.isFrozen(fixtures.demoCompliantCapability.jobs)).toBe(true)
    expect(listCapabilities()[0]).toBe(fixtures.demoCompliantCapability)
    expect(listCapabilities()).not.toBe(listCapabilities())
    expect(listCapabilities()).toHaveLength(6)
  })

  it('replaces an earlier definition of the same feature', async () => {
    const { listCapabilities } = await import('~~/server/capabilities/index')
    const { defineCapability } = await import('~~/server/capabilities/types')

    defineCapability({ feature: 'skills', clientChunk: 'first' })
    const second = defineCapability({ feature: 'skills', clientChunk: 'second' })

    expect(listCapabilities()).toEqual([second])
  })

  it('merges chat tools only from capabilities whose flag is active', async () => {
    const { getCapabilityTools } = await import('~~/server/capabilities/index')
    const { defineCapability } = await import('~~/server/capabilities/types')
    const artifactTools = vi.fn(() => {
      return { artifact_tool: {} as never }
    })
    const documentTools = vi.fn(async () => {
      return { document_tool: {} as never }
    })
    const capabilities = [
      defineCapability({ feature: 'artifacts', aiTools: artifactTools }),
      defineCapability({ feature: 'documents', aiTools: documentTools }),
      defineCapability({ feature: 'skills' }),
    ]
    const context = {
      userId: 1,
      chatId: 'chat',
      db: {} as never,
      kv: {} as never,
      model: {} as never,
      logger: { set: vi.fn() },
      isFeatureActive: (flag: string) => {
        return flag === 'documents'
      },
    }

    const tools = await getCapabilityTools(context, capabilities)

    expect(Object.keys(tools)).toEqual(['document_tool'])
    expect(artifactTools).not.toHaveBeenCalled()
    expect(documentTools).toHaveBeenCalledWith(context)
  })
})

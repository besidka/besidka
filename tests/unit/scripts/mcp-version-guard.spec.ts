import { describe, expect, it } from 'vitest'
import {
  bumpVersion,
  checkMcpVersion,
  compareVersions,
  parseVersion,
  readFileAtRevision,
  readServerVersion,
  readSnapshot,
  suggestBump,
} from '../../../scripts/mcp-version-guard.mjs'

function createTool(overrides: Record<string, unknown> = {}) {
  return {
    name: 'list_models',
    title: 'List models',
    description: 'List the models.',
    public: true,
    requiredScopes: [],
    annotations: {
      destructiveHint: null,
      idempotentHint: true,
      openWorldHint: false,
      readOnlyHint: true,
    },
    inputSchema: {
      type: 'object',
      properties: { provider: { type: 'string' } },
    },
    ...overrides,
  }
}

function createSurface(tools = [createTool()]) {
  return {
    server: { name: 'com.besidka/mcp', title: 'Besidka', description: 'Text' },
    tools,
  }
}

const SERVER_MANIFEST = {
  name: 'com.besidka/mcp',
  version: '1.1.0',
  description: 'Text',
}

function createSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    surface: createSurface(),
    serverManifest: SERVER_MANIFEST,
    version: '1.1.0',
    ...overrides,
  }
}

describe('compareVersions', () => {
  it('compares numerically per part', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1)
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1)
    expect(compareVersions('1.1.0', '1.1.0')).toBe(0)
    expect(compareVersions('1.1.1', '1.1.0')).toBe(1)
  })

  it('rejects versions that are not plain semver', () => {
    expect(() => parseVersion('1.1')).toThrow(/MAJOR.MINOR.PATCH/)
    expect(() => parseVersion('1.1.0-beta')).toThrow(/MAJOR.MINOR.PATCH/)
    expect(() => parseVersion('latest')).toThrow(/MAJOR.MINOR.PATCH/)
    expect(() => parseVersion(undefined)).toThrow(/MAJOR.MINOR.PATCH/)
  })
})

describe('readServerVersion', () => {
  it('reads the declared version', () => {
    expect(readServerVersion('export const MCP_SERVER_VERSION = \'1.2.3\'\n'))
      .toBe('1.2.3')
  })

  it('returns null when the declaration is missing', () => {
    expect(readServerVersion('export const OTHER = 1')).toBeNull()
    expect(readServerVersion(null)).toBeNull()
  })
})

describe('bumpVersion', () => {
  it('resets the lower parts', () => {
    expect(bumpVersion('1.4.2', 'major')).toBe('2.0.0')
    expect(bumpVersion('1.4.2', 'minor')).toBe('1.5.0')
    expect(bumpVersion('1.4.2', 'patch')).toBe('1.4.3')
  })
})

describe('suggestBump', () => {
  it('asks for major when a tool is removed', () => {
    const { level, reasons } = suggestBump(
      createSurface([createTool(), createTool({ name: 'get_page' })]),
      createSurface([createTool()]),
    )

    expect(level).toBe('major')
    expect(reasons).toContain('tool "get_page" removed')
  })

  it('asks for major when an input is removed or renamed', () => {
    const { level } = suggestBump(
      createSurface(),
      createSurface([createTool({
        inputSchema: {
          type: 'object',
          properties: { providerId: { type: 'string' } },
        },
      })]),
    )

    expect(level).toBe('major')
  })

  it('asks for major when an input becomes required', () => {
    const { level } = suggestBump(
      createSurface(),
      createSurface([createTool({
        inputSchema: {
          type: 'object',
          properties: { provider: { type: 'string' } },
          required: ['provider'],
        },
      })]),
    )

    expect(level).toBe('major')
  })

  it('asks for major when the required scopes change', () => {
    const { level } = suggestBump(
      createSurface(),
      createSurface([createTool({ requiredScopes: ['chats:read'] })]),
    )

    expect(level).toBe('major')
  })

  it('asks for minor when a tool is added', () => {
    const { level } = suggestBump(
      createSurface(),
      createSurface([createTool(), createTool({ name: 'get_page' })]),
    )

    expect(level).toBe('minor')
  })

  it('asks for minor when an optional input is added', () => {
    const { level } = suggestBump(
      createSurface(),
      createSurface([createTool({
        inputSchema: {
          type: 'object',
          properties: {
            provider: { type: 'string' },
            includeDeprecated: { type: 'boolean' },
          },
        },
      })]),
    )

    expect(level).toBe('minor')
  })

  it('asks for patch when only text changes', () => {
    const { level, reasons } = suggestBump(
      createSurface(),
      createSurface([createTool({ description: 'Another text.' })]),
    )

    expect(level).toBe('patch')
    expect(reasons).toEqual(['list_models: text or schema details changed'])
  })

  it('keeps the highest level across tools', () => {
    const { level } = suggestBump(
      createSurface([createTool(), createTool({ name: 'get_page' })]),
      createSurface([
        createTool({ description: 'Another text.' }),
        createTool({ name: 'new_tool' }),
      ]),
    )

    expect(level).toBe('major')
  })
})

describe('checkMcpVersion', () => {
  it('passes when nothing MCP related changed', () => {
    const result = checkMcpVersion({
      base: createSnapshot(),
      head: createSnapshot(),
    })

    expect(result.ok).toBe(true)
    expect(result.changes).toEqual([])
  })

  it('passes when only the server.json version changed', () => {
    const result = checkMcpVersion({
      base: createSnapshot(),
      head: createSnapshot({
        serverManifest: { ...SERVER_MANIFEST, version: '1.2.0' },
        version: '1.2.0',
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.changes).toEqual([])
  })

  it('treats a snapshot file new on this branch as the baseline', () => {
    const result = checkMcpVersion({
      base: createSnapshot({ surface: null }),
      head: createSnapshot(),
    })

    expect(result.ok).toBe(true)
    expect(result.changes).toEqual([])
  })

  it('fails when the surface changed and the version did not', () => {
    const result = checkMcpVersion({
      base: createSnapshot(),
      head: createSnapshot({
        surface: createSurface([
          createTool(),
          createTool({ name: 'get_page' }),
        ]),
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('config/mcp-surface.json changed')
    expect(result.message).toContain('Suggested bump: minor (1.2.0)')
  })

  it('fails when the version went down', () => {
    const result = checkMcpVersion({
      base: createSnapshot(),
      head: createSnapshot({
        surface: createSurface([createTool({ description: 'Other.' })]),
        version: '1.0.9',
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Suggested bump: patch (1.1.1)')
  })

  it('passes when the surface changed and the version went up', () => {
    const result = checkMcpVersion({
      base: createSnapshot(),
      head: createSnapshot({
        surface: createSurface([createTool({ description: 'Other.' })]),
        version: '1.1.1',
      }),
    })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('1.1.0 to 1.1.1')
  })

  it('fails when server.json changed beyond the version', () => {
    const result = checkMcpVersion({
      base: createSnapshot(),
      head: createSnapshot({
        serverManifest: { ...SERVER_MANIFEST, description: 'Other text' },
      }),
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('server.json changed beyond its version')
    expect(result.message).toContain('Suggested bump: patch (1.1.1)')
  })
})

describe('checkMcpVersion against the origin/main tip', () => {
  const changedSurface = createSurface([createTool({ description: 'Other.' })])

  it('fails when main already holds the same version', () => {
    const result = checkMcpVersion({
      base: createSnapshot(),
      head: createSnapshot({ surface: changedSurface, version: '1.2.0' }),
      main: { version: '1.2.0' },
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('main is already at 1.2.0; bump above it')
    expect(result.message).toContain('Suggested bump: patch (1.2.1)')
  })

  it('fails when main is ahead of the head version', () => {
    const result = checkMcpVersion({
      base: createSnapshot(),
      head: createSnapshot({ surface: changedSurface, version: '1.1.5' }),
      main: { version: '1.3.0' },
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('main is already at 1.3.0')
  })

  it('passes when the head is above both the base and main', () => {
    const result = checkMcpVersion({
      base: createSnapshot(),
      head: createSnapshot({ surface: changedSurface, version: '1.2.1' }),
      main: { version: '1.2.0' },
    })

    expect(result.ok).toBe(true)
    expect(result.message).toContain('1.2.0 to 1.2.1')
  })

  it('ignores main when it has no version', () => {
    const result = checkMcpVersion({
      base: createSnapshot(),
      head: createSnapshot({ surface: changedSurface, version: '1.1.1' }),
      main: { version: null },
    })

    expect(result.ok).toBe(true)
  })

  it('still passes without changes when main moved ahead', () => {
    const result = checkMcpVersion({
      base: createSnapshot(),
      head: createSnapshot(),
      main: { version: '2.0.0' },
    })

    expect(result.ok).toBe(true)
  })

  it('throws when the head version cannot be parsed, with or without changes',
    () => {
      expect(() => checkMcpVersion({
        base: createSnapshot(),
        head: createSnapshot({ version: null }),
      })).toThrow(/MAJOR.MINOR.PATCH/)
      expect(() => checkMcpVersion({
        base: createSnapshot(),
        head: createSnapshot({ surface: changedSurface, version: 'x' }),
      })).toThrow(/MAJOR.MINOR.PATCH/)
    })
})

describe('readFileAtRevision', () => {
  it('returns null when the path is not in the tree', () => {
    const calls: string[][] = []
    const content = readFileAtRevision('abc', 'config/mcp-surface.json',
      (args: string[]) => {
        calls.push(args)

        return ''
      })

    expect(content).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]![0]).toBe('ls-tree')
  })

  it('returns the file content when the path exists', () => {
    const content = readFileAtRevision('abc', 'server.json',
      (args: string[]) => {
        return args[0] === 'ls-tree' ? 'server.json' : '{"a":1}'
      })

    expect(content).toBe('{"a":1}')
  })

  it('lets other git errors propagate', () => {
    expect(() => readFileAtRevision('missing-rev', 'server.json', () => {
      throw new Error('fatal: Not a valid object name missing-rev')
    })).toThrow(/Not a valid object name/)
  })
})

describe('readSnapshot', () => {
  it('parses the three files and tolerates missing ones', () => {
    const files: Record<string, string> = {
      'config/mcp-server.ts': 'export const MCP_SERVER_VERSION = \'1.1.0\'',
      'server.json': JSON.stringify(SERVER_MANIFEST),
    }
    const snapshot = readSnapshot((path: string) => {
      return files[path] ?? null
    })

    expect(snapshot.surface).toBeNull()
    expect(snapshot.serverManifest).toEqual(SERVER_MANIFEST)
    expect(snapshot.version).toBe('1.1.0')
  })
})

import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { isMcpDeleteScope } from '#shared/utils/mcp-oauth-scopes'
import type { BesidkaTool } from '~~/server/utils/besidka-tools/types'
import { MCP_PRIVATE_TOOL_SCOPES } from '~~/server/utils/mcp/tool-scopes'

const MCP_TOOLS_DIRECTORY = fileURLToPath(
  new URL('../../../../../server/mcp/tools/', import.meta.url),
)
const SURFACE_FILE = '../../../../../config/besidka-tools-surface.json'
const CHAT_DESCRIPTION_MAX_CHARS = 300
const PUBLIC_TOOLS_REASON = 'no user data'
const PUBLIC_MCP_TOOLS = [
  'get_key_guide',
  'get_page',
  'list_models',
  'list_providers',
]
const EXPECTED_EXPOSURE = {
  'read': [
    'get_artifact',
    'get_project',
    'get_settings',
    'list_artifact_shares',
    'list_artifacts',
    'list_files',
    'list_my_features',
    'list_projects',
    'list_shared_chats',
    'read_file',
    'read_project_knowledge_item',
  ],
  'write': [
    'branch_chat',
    'create_file',
    'create_project',
    'move_chats_to_project',
    'rename_file',
    'update_chat',
    'update_project',
    'update_project_knowledge_item',
  ],
  'ask-every-time': [
    'add_project_note',
    'add_project_text',
    'delete_artifacts',
    'delete_chat_message',
    'delete_chats',
    'delete_files',
    'delete_project',
    'delete_project_knowledge_items',
    'revoke_artifact_shares',
    'revoke_chat_shares',
    'share_artifact',
    'update_project_instructions',
    'update_settings',
  ],
  'excluded': [
    'add_connector',
    'add_memory',
    'create_artifact',
    'create_document',
    'create_skill',
    'delete_connectors',
    'delete_memory',
    'delete_skills',
    'get_chat',
    'get_connector',
    'get_skill',
    'list_chats',
    'list_connectors',
    'list_feature_access',
    'list_feature_flags',
    'list_memory',
    'list_skills',
    'rename_skill',
    'reset_memory',
    'set_feature_access',
    'update_artifact',
    'update_connector_tools',
    'update_memory',
    'update_skill',
  ],
}

function compareStrings(left: string, right: string): number {
  if (left === right) {
    return 0
  }

  return left < right ? -1 : 1
}

function describeChat(tool: BesidkaTool) {
  if ('excluded' in tool.chat) {
    return { excluded: tool.chat.excluded }
  }

  return { expose: true, tier: tool.chat.tier }
}

function describeTool(tool: BesidkaTool) {
  return {
    name: tool.name,
    mcpScope: tool.mcpScope,
    access: tool.access,
    readOnlyHint: tool.annotations.readOnlyHint ?? null,
    destructiveHint: tool.annotations.destructiveHint ?? null,
    chat: describeChat(tool),
    chatDescription: tool.chatDescription ?? null,
    hasSummary: Boolean(tool.summarize),
  }
}

function namesOf(tools: BesidkaTool[]): string[] {
  return tools
    .map((tool) => {
      return tool.name
    })
    .sort(compareStrings)
}

describe('Besidka tools registry parity', () => {
  let tools: BesidkaTool[] = []

  beforeAll(async () => {
    vi.stubGlobal('defineCachedFunction', (handler: unknown) => {
      return handler
    })
    vi.stubGlobal('useDb', () => {
      return {}
    })

    const registry = await import('~~/server/utils/besidka-tools/registry')

    tools = registry.listBesidkaTools()
  })

  it('has one entry per private MCP tool, keyed by its name and scope', async () => {
    const registry = await import('~~/server/utils/besidka-tools/registry')

    expect(namesOf(tools)).toEqual(
      Object.keys(MCP_PRIVATE_TOOL_SCOPES).sort(compareStrings),
    )

    for (const [key, tool] of Object.entries(registry.BESIDKA_TOOLS)) {
      expect(tool.name, key).toBe(key)
      expect(tool.mcpScope, key).toBe(
        MCP_PRIVATE_TOOL_SCOPES[key as keyof typeof MCP_PRIVATE_TOOL_SCOPES],
      )
    }
  })

  it('serves every private MCP tool through a shim over its entry', () => {
    const shimFiles = readdirSync(MCP_TOOLS_DIRECTORY).filter((file) => {
      return file.endsWith('.ts')
    })
    const publicNames: string[] = []

    for (const file of shimFiles) {
      const name = file.replace('.ts', '').replaceAll('-', '_')

      if (!Object.hasOwn(MCP_PRIVATE_TOOL_SCOPES, name)) {
        publicNames.push(name)
        continue
      }

      const source = readFileSync(`${MCP_TOOLS_DIRECTORY}${file}`, 'utf8')

      expect(source, file).toContain('toMcpToolDefinition(')
      expect(source, file).toContain(
        `'~~/server/utils/besidka-tools/tools/${file.replace('.ts', '')}'`,
      )
      expect(source, file).not.toContain('withMcpPrivateTool')
    }

    expect(publicNames.sort(compareStrings)).toEqual(PUBLIC_MCP_TOOLS)
  })

  it('exposes or excludes every tool, and excludes with a reason', () => {
    for (const tool of tools) {
      if ('excluded' in tool.chat) {
        expect(tool.chat.excluded.trim().length, tool.name).toBeGreaterThan(0)
      } else {
        expect(tool.chat.expose, tool.name).toBe(true)
      }
    }
  })

  it('matches the planned exposure lists', () => {
    const exposedIn = (tier: string) => {
      return namesOf(tools.filter((tool) => {
        return 'expose' in tool.chat && tool.chat.tier === tier
      }))
    }

    expect(exposedIn('read')).toEqual(EXPECTED_EXPOSURE.read)
    expect(exposedIn('write')).toEqual(EXPECTED_EXPOSURE.write)
    expect(exposedIn('ask-every-time')).toEqual(
      EXPECTED_EXPOSURE['ask-every-time'],
    )
    expect(namesOf(tools.filter((tool) => {
      return 'excluded' in tool.chat
    }))).toEqual(EXPECTED_EXPOSURE.excluded)
  })

  it('keeps access in line with the annotations and the scope', () => {
    for (const tool of tools) {
      const { readOnlyHint, destructiveHint } = tool.annotations

      expect(tool.access === 'read', tool.name).toBe(readOnlyHint === true)

      expect(tool.access === 'delete', tool.name)
        .toBe(isMcpDeleteScope(tool.mcpScope))

      if (tool.access === 'delete') {
        expect(destructiveHint, tool.name).toBe(true)
      }

      if (tool.access === 'read') {
        expect(destructiveHint, tool.name).toBeUndefined()
      }
    }
  })

  it('puts reads in the read tier and deletes and instructions behind '
    + 'approval every time', () => {
    for (const tool of tools) {
      if (!('expose' in tool.chat)) {
        continue
      }

      expect(tool.chat.tier === 'read', tool.name)
        .toBe(tool.access === 'read')

      if (tool.access === 'delete' || tool.access === 'instructions') {
        expect(tool.chat.tier, tool.name).toBe('ask-every-time')
      }
    }
  })

  it('writes a chat description of at most 300 characters', () => {
    for (const tool of tools) {
      if (tool.chatDescription !== undefined) {
        expect(tool.chatDescription.length, tool.name)
          .toBeLessThanOrEqual(CHAT_DESCRIPTION_MAX_CHARS)
      }

      if (!('expose' in tool.chat)) {
        continue
      }

      expect(tool.chatDescription?.trim().length, tool.name)
        .toBeGreaterThan(0)
      expect(tool.chatDescription, tool.name)
        .not.toContain('Requires signing in')
      expect(tool.chatDescription, tool.name).not.toMatch(/\bMCP\b/)
    }
  })

  it('summarizes every exposed tool that changes something', () => {
    for (const tool of tools) {
      if (!('expose' in tool.chat)) {
        continue
      }

      expect(typeof tool.summarize, tool.name)
        .toBe(tool.chat.tier === 'read' ? 'undefined' : 'function')
    }
  })

  it('matches config/besidka-tools-surface.json', async () => {
    const surface = {
      tools: tools
        .map(describeTool)
        .sort((left, right) => {
          return compareStrings(left.name, right.name)
        }),
      publicMcpToolsExcluded: PUBLIC_MCP_TOOLS.map((name) => {
        return { name, excluded: PUBLIC_TOOLS_REASON }
      }),
    }

    await expect(
      `${JSON.stringify(surface, null, 2)}\n`,
      'The Besidka tools surface changed. Run "pnpm run '
      + 'besidka-tools:surface" to update config/besidka-tools-surface.json.',
    ).toMatchFileSnapshot(SURFACE_FILE)
  })
})

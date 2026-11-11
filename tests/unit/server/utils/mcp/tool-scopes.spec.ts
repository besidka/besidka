import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  MCP_DELETE_SCOPES,
  MCP_OAUTH_SCOPES,
  MCP_RESOURCE_SCOPES,
  isMcpDeleteScope,
  isMcpWriteScope,
} from '#shared/utils/mcp-oauth-scopes'
import {
  MCP_PRIVATE_TOOL_SCOPES,
  findMissingMcpScopes,
  getMcpToolRequiredScopes,
  isMcpDeleteTool,
  isMcpPrivateToolName,
  isMcpWriteTool,
  mergeMcpScopes,
} from '~~/server/utils/mcp/tool-scopes'

const TOOLS_DIRECTORY = fileURLToPath(
  new URL('../../../../../server/mcp/tools/', import.meta.url),
)
const TOOL_NAME = /name: '([a-z_]+)'/
const PRIVATE_WRAPPER = /withMcpPrivateTool\(\s*'([a-z_]+)'/
const DELETE_SCOPE_MENTION = /\(data:delete\)/
const READ_ONLY_HINT = /readOnlyHint: (true|false)/
const DESTRUCTIVE_HINT = /destructiveHint: (true|false)/
const DESTRUCTIVE_TOOLS = [
  'delete_memory',
  'update_memory',
  'update_project_instructions',
  'update_chat',
  'delete_chats',
  'delete_chat_message',
  'revoke_chat_shares',
  'update_project',
  'delete_project',
  'update_project_knowledge_item',
  'delete_project_knowledge_items',
  'rename_file',
  'delete_files',
  'reset_memory',
  'update_settings',
  'set_feature_access',
  'revoke_artifact_shares',
  'delete_artifacts',
]

function readToolSources() {
  return readdirSync(TOOLS_DIRECTORY)
    .filter((file) => {
      return file.endsWith('.ts')
    })
    .map((file) => {
      const source = readFileSync(`${TOOLS_DIRECTORY}${file}`, 'utf8')

      return {
        file,
        name: TOOL_NAME.exec(source)?.[1] ?? '',
        mentionsDeleteScope: DELETE_SCOPE_MENTION.test(source),
        wrapperName: PRIVATE_WRAPPER.exec(source)?.[1] ?? null,
        readOnly: READ_ONLY_HINT.exec(source)?.[1] === 'true',
        destructive: DESTRUCTIVE_HINT.exec(source)?.[1] === 'true',
      }
    })
}

describe('mcp tool scopes', () => {
  it('maps every private tool to a resource scope', () => {
    for (const scope of Object.values(MCP_PRIVATE_TOOL_SCOPES)) {
      expect(MCP_RESOURCE_SCOPES).toContain(scope)
    }
  })

  it('returns no scopes for public or unknown tools', () => {
    expect(getMcpToolRequiredScopes('list_models')).toEqual([])
    expect(getMcpToolRequiredScopes('__proto__')).toEqual([])
    expect(getMcpToolRequiredScopes('toString')).toEqual([])
    expect(getMcpToolRequiredScopes(undefined)).toEqual([])
    expect(isMcpPrivateToolName('constructor')).toBe(false)
  })

  it('returns the scope of a private tool', () => {
    expect(getMcpToolRequiredScopes('get_chat')).toEqual(['chats:read'])
    expect(getMcpToolRequiredScopes('add_project_text'))
      .toEqual(['projects:write'])
    expect(getMcpToolRequiredScopes('create_project'))
      .toEqual(['projects:write'])
    expect(isMcpWriteTool('create_project')).toBe(true)
    expect(isMcpWriteTool('delete_memory')).toBe(true)
    expect(isMcpWriteTool('list_memory')).toBe(false)
  })

  it('puts every deletion behind the dedicated delete scope', () => {
    const deleteTools = [
      'delete_chats',
      'delete_chat_message',
      'delete_project',
      'delete_project_knowledge_items',
      'delete_files',
      'delete_memory',
      'reset_memory',
      'delete_artifacts',
    ] as const

    for (const name of deleteTools) {
      expect(getMcpToolRequiredScopes(name), name).toEqual(['data:delete'])
      expect(isMcpDeleteTool(name), name).toBe(true)
      expect(isMcpWriteTool(name), name).toBe(true)
    }

    const deleteToolNames = Object.keys(MCP_PRIVATE_TOOL_SCOPES).filter(
      (name) => {
        return isMcpDeleteTool(name as never)
      },
    )

    expect(deleteToolNames.sort()).toEqual([...deleteTools].sort())
    expect(isMcpDeleteTool('revoke_chat_shares')).toBe(false)
    expect(getMcpToolRequiredScopes('revoke_chat_shares'))
      .toEqual(['chats:write'])
    expect(isMcpDeleteTool('update_chat')).toBe(false)
  })

  it('puts the feature admin tools behind admin:features', () => {
    expect(getMcpToolRequiredScopes('list_my_features'))
      .toEqual(['settings:read'])

    for (const name of [
      'list_feature_flags',
      'list_feature_access',
      'set_feature_access',
    ] as const) {
      expect(getMcpToolRequiredScopes(name), name).toEqual(['admin:features'])
      expect(isMcpDeleteTool(name), name).toBe(false)
    }

    expect(isMcpWriteScope('admin:features')).toBe(true)
    expect(isMcpWriteTool('set_feature_access')).toBe(true)
    expect(isMcpWriteTool('list_feature_flags')).toBe(false)
    expect(isMcpWriteTool('list_feature_access')).toBe(false)
  })

  it('puts the artifact tools behind their own scopes', () => {
    const readTools = [
      'list_artifacts',
      'get_artifact',
      'list_artifact_shares',
    ] as const
    const writeTools = [
      'create_artifact',
      'update_artifact',
      'revoke_artifact_shares',
    ] as const

    for (const name of readTools) {
      expect(getMcpToolRequiredScopes(name), name).toEqual(['artifacts:read'])
      expect(isMcpWriteTool(name), name).toBe(false)
    }

    for (const name of writeTools) {
      expect(getMcpToolRequiredScopes(name), name)
        .toEqual(['artifacts:write'])
      expect(isMcpWriteTool(name), name).toBe(true)
      expect(isMcpDeleteTool(name), name).toBe(false)
    }

    expect(getMcpToolRequiredScopes('share_artifact'))
      .toEqual(['artifacts:share'])
    expect(isMcpWriteTool('share_artifact')).toBe(true)
    expect(isMcpDeleteTool('share_artifact')).toBe(false)
    expect(getMcpToolRequiredScopes('delete_artifacts'))
      .toEqual(['data:delete'])
    expect(isMcpWriteScope('artifacts:write')).toBe(true)
    expect(isMcpWriteScope('artifacts:share')).toBe(true)
    expect(isMcpWriteScope('artifacts:read')).toBe(false)
  })

  it('never lets a tool write feature rules', () => {
    for (const tool of readToolSources()) {
      const source = readFileSync(`${TOOLS_DIRECTORY}${tool.file}`, 'utf8')

      expect(source, tool.file).not.toMatch(/setFeatureRule|featureFlagRules/)
    }

    const privateFeatures = readFileSync(fileURLToPath(new URL(
      '../../../../../server/utils/mcp/private/features.ts',
      import.meta.url,
    )), 'utf8')

    expect(privateFeatures).not.toMatch(/setFeatureRule|featureFlagRules/)
  })

  it('keeps the delete scope a write scope', () => {
    expect(MCP_DELETE_SCOPES).toEqual(['data:delete'])
    expect(isMcpDeleteScope('data:delete')).toBe(true)
    expect(isMcpDeleteScope('chats:write')).toBe(false)
    expect(isMcpWriteScope('data:delete')).toBe(true)
  })

  it('finds missing scopes', () => {
    expect(findMissingMcpScopes(['memory:write'], ['memory:read']))
      .toEqual(['memory:write'])
    expect(findMissingMcpScopes(['memory:read'], ['memory:read']))
      .toEqual([])
  })

  it('wraps every mapped tool file with its own name and the right hints',
    () => {
      const tools = readToolSources()
      const privateTools = tools.filter((tool) => {
        return isMcpPrivateToolName(tool.name)
      })

      expect(privateTools.map(tool => tool.name).sort())
        .toEqual(Object.keys(MCP_PRIVATE_TOOL_SCOPES).sort())

      for (const tool of privateTools) {
        const isWrite = isMcpWriteTool(tool.name as never)

        expect(tool.wrapperName, tool.file).toBe(tool.name)
        expect(tool.mentionsDeleteScope, tool.file)
          .toBe(isMcpDeleteTool(tool.name as never))
        expect(tool.readOnly, tool.file).toBe(!isWrite)
        expect(tool.destructive, tool.file)
          .toBe(DESTRUCTIVE_TOOLS.includes(tool.name))
      }

      for (const tool of tools) {
        if (!isMcpPrivateToolName(tool.name)) {
          expect(tool.wrapperName, tool.file).toBeNull()
        }
      }
    })

  it('merges scope lists deduplicated in MCP_OAUTH_SCOPES order', () => {
    expect(mergeMcpScopes(
      ['data:delete', 'chats:read', 'openid'],
      ['chats:read', 'memory:write', 'bogus'],
    )).toEqual(['openid', 'chats:read', 'memory:write', 'data:delete'])
    expect(mergeMcpScopes([...MCP_OAUTH_SCOPES]))
      .toEqual([...MCP_OAUTH_SCOPES])
  })
})

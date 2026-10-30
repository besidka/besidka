import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { MCP_RESOURCE_SCOPES } from '#shared/utils/mcp-oauth-scopes'
import {
  MCP_PRIVATE_TOOL_SCOPES,
  findMissingMcpScopes,
  getMcpToolRequiredScopes,
  isMcpPrivateToolName,
  isMcpWriteTool,
} from '~~/server/utils/mcp/tool-scopes'

const TOOLS_DIRECTORY = fileURLToPath(
  new URL('../../../../../server/mcp/tools/', import.meta.url),
)
const TOOL_NAME = /name: '([a-z_]+)'/
const PRIVATE_WRAPPER = /withMcpPrivateTool\(\s*'([a-z_]+)'/
const READ_ONLY_HINT = /readOnlyHint: (true|false)/
const DESTRUCTIVE_HINT = /destructiveHint: (true|false)/
const DESTRUCTIVE_TOOLS = [
  'delete_memory',
  'update_memory',
  'update_project_instructions',
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
})

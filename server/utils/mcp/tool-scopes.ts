import type { McpResourceScope } from '#shared/utils/mcp-oauth-scopes'
import {
  isMcpDeleteScope,
  isMcpWriteScope,
} from '#shared/utils/mcp-oauth-scopes'

export const MCP_PRIVATE_TOOL_SCOPES = {
  list_chats: 'chats:read',
  get_chat: 'chats:read',
  list_shared_chats: 'chats:read',
  update_chat: 'chats:write',
  move_chats_to_project: 'chats:write',
  delete_chats: 'data:delete',
  delete_chat_message: 'data:delete',
  revoke_chat_shares: 'chats:write',
  branch_chat: 'chats:write',
  list_projects: 'projects:read',
  get_project: 'projects:read',
  read_project_knowledge_item: 'projects:read',
  create_project: 'projects:write',
  update_project_instructions: 'projects:write',
  add_project_note: 'projects:write',
  add_project_text: 'projects:write',
  update_project: 'projects:write',
  delete_project: 'data:delete',
  update_project_knowledge_item: 'projects:write',
  delete_project_knowledge_items: 'data:delete',
  list_files: 'files:read',
  read_file: 'files:read',
  create_file: 'files:write',
  rename_file: 'files:write',
  delete_files: 'data:delete',
  list_memory: 'memory:read',
  add_memory: 'memory:write',
  update_memory: 'memory:write',
  delete_memory: 'data:delete',
  reset_memory: 'data:delete',
  get_settings: 'settings:read',
  update_settings: 'settings:write',
} as const satisfies Record<string, McpResourceScope>

export type McpPrivateToolName = keyof typeof MCP_PRIVATE_TOOL_SCOPES

export function isMcpPrivateToolName(
  name: unknown,
): name is McpPrivateToolName {
  return typeof name === 'string'
    && Object.hasOwn(MCP_PRIVATE_TOOL_SCOPES, name)
}

export function getMcpToolRequiredScopes(name: unknown): McpResourceScope[] {
  if (!isMcpPrivateToolName(name)) {
    return []
  }

  return [MCP_PRIVATE_TOOL_SCOPES[name]]
}

export function isMcpWriteTool(name: McpPrivateToolName): boolean {
  return isMcpWriteScope(MCP_PRIVATE_TOOL_SCOPES[name])
}

export function isMcpDeleteTool(name: McpPrivateToolName): boolean {
  return isMcpDeleteScope(MCP_PRIVATE_TOOL_SCOPES[name])
}

export function findMissingMcpScopes(
  requiredScopes: readonly string[],
  grantedScopes: readonly string[],
): string[] {
  const granted = new Set(grantedScopes)

  return requiredScopes.filter((scope) => {
    return !granted.has(scope)
  })
}

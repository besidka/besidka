import { moveChatsToProjectBesidkaTool } from '~~/server/utils/besidka-tools/tools/move-chats-to-project'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(moveChatsToProjectBesidkaTool),
)

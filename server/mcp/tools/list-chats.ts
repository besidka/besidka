import { listChatsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-chats'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listChatsBesidkaTool),
)

import { deleteChatsBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-chats'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(deleteChatsBesidkaTool),
)

import { deleteChatMessageBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-chat-message'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(deleteChatMessageBesidkaTool),
)

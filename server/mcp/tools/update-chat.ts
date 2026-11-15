import { updateChatBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-chat'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(updateChatBesidkaTool),
)

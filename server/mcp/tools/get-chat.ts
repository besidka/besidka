import { getChatBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-chat'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(getChatBesidkaTool),
)

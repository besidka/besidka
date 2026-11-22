import { getChatCostBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-chat-cost'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(getChatCostBesidkaTool),
)

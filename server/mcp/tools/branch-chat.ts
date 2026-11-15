import { branchChatBesidkaTool } from '~~/server/utils/besidka-tools/tools/branch-chat'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(branchChatBesidkaTool),
)

import { revokeChatSharesBesidkaTool } from '~~/server/utils/besidka-tools/tools/revoke-chat-shares'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(revokeChatSharesBesidkaTool),
)

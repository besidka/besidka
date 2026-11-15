import { listSharedChatsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-shared-chats'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listSharedChatsBesidkaTool),
)

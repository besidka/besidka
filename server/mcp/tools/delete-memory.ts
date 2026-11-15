import { deleteMemoryBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-memory'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(deleteMemoryBesidkaTool),
)

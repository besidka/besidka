import { addMemoryBesidkaTool } from '~~/server/utils/besidka-tools/tools/add-memory'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(addMemoryBesidkaTool),
)

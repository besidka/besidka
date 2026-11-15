import { updateMemoryBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-memory'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(updateMemoryBesidkaTool),
)

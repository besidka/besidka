import { resetMemoryBesidkaTool } from '~~/server/utils/besidka-tools/tools/reset-memory'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(resetMemoryBesidkaTool),
)

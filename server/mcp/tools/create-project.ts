import { createProjectBesidkaTool } from '~~/server/utils/besidka-tools/tools/create-project'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(createProjectBesidkaTool),
)

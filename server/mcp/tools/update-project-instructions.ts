import { updateProjectInstructionsBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-project-instructions'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(updateProjectInstructionsBesidkaTool),
)

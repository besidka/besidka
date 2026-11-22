import { addProjectNoteBesidkaTool } from '~~/server/utils/besidka-tools/tools/add-project-note'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(addProjectNoteBesidkaTool),
)

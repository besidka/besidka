import { addProjectTextBesidkaTool } from '~~/server/utils/besidka-tools/tools/add-project-text'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(addProjectTextBesidkaTool),
)

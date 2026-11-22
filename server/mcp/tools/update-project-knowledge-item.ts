import { updateProjectKnowledgeItemBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-project-knowledge-item'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(updateProjectKnowledgeItemBesidkaTool),
)

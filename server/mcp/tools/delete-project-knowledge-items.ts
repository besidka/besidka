import { deleteProjectKnowledgeItemsBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-project-knowledge-items'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(deleteProjectKnowledgeItemsBesidkaTool),
)

import { readProjectKnowledgeItemBesidkaTool } from '~~/server/utils/besidka-tools/tools/read-project-knowledge-item'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(readProjectKnowledgeItemBesidkaTool),
)

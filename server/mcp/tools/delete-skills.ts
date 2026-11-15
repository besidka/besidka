import { deleteSkillsBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-skills'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(deleteSkillsBesidkaTool),
)

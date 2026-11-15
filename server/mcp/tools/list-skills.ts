import { listSkillsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-skills'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(listSkillsBesidkaTool),
)

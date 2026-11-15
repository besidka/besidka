import { updateSkillBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-skill'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(updateSkillBesidkaTool),
)

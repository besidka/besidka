import { getSkillBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-skill'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(getSkillBesidkaTool),
)

import { createSkillBesidkaTool } from '~~/server/utils/besidka-tools/tools/create-skill'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(createSkillBesidkaTool),
)

import { getArtifactBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-artifact'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(getArtifactBesidkaTool),
)

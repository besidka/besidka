import { createArtifactBesidkaTool } from '~~/server/utils/besidka-tools/tools/create-artifact'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(createArtifactBesidkaTool),
)

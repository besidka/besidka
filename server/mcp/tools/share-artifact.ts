import { shareArtifactBesidkaTool } from '~~/server/utils/besidka-tools/tools/share-artifact'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(shareArtifactBesidkaTool),
)

import { revokeArtifactSharesBesidkaTool } from '~~/server/utils/besidka-tools/tools/revoke-artifact-shares'
import { toMcpToolDefinition } from '~~/server/utils/besidka-tools/mcp-adapter'

export default defineMcpTool(
  toMcpToolDefinition(revokeArtifactSharesBesidkaTool),
)

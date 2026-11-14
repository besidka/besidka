import { getMcpSettings, getMcpStorage } from '~~/server/utils/mcp/private/settings'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

export default defineMcpTool({
  name: 'get_settings',
  title: 'Get my settings',
  description: 'Read your Besidka preferences: reasoning display and '
    + 'default level, favorite models, sidebar pinning, memory and chat '
    + 'search switches. The memory extraction switch and the memory models '
    + 'are included for reference but cannot be changed through MCP. Also '
    + 'returns your storage: bytes used, the allowance and a breakdown by '
    + 'AI images, uploads, generated files, artifacts and project knowledge. '
    + 'Requires signing in (settings:read).',
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'get_settings',
    async (_input: unknown, context) => {
      const [settings, storage] = await Promise.all([
        getMcpSettings(context.db, context.userId),
        getMcpStorage(context.db, context.userId),
      ])

      return { ...settings, storage }
    },
  ),
})

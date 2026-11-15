import { getMcpSettings, getMcpStorage } from '~~/server/utils/mcp/private/settings'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

export const getSettingsBesidkaTool = defineBesidkaTool({
  name: 'get_settings',
  title: 'Get my settings',
  description: 'Read your Besidka preferences: reasoning display and '
    + 'default level, favorite models, sidebar pinning, memory and chat '
    + 'search switches. The memory extraction switch and the memory models '
    + 'are included for reference but cannot be changed through MCP. Also '
    + 'returns your storage: bytes used, the allowance and a breakdown by '
    + 'AI images, uploads, generated files, artifacts, project knowledge '
    + 'and skills. Requires signing in (settings:read).',
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: { expose: true, tier: 'read' },
  chatDescription: 'Read your preferences (reasoning display and default level, '
    + 'favorite models, sidebar pinning, memory and chat search '
    + 'switches) and your storage usage.',
  handler: async (_input: unknown, context) => {
    const [settings, storage] = await Promise.all([
      getMcpSettings(context.db, context.userId),
      getMcpStorage(context.db, context.userId),
    ])

    return { ...settings, storage }
  },
})

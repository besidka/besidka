import type { z } from 'zod'
import {
  mcpSettingsPatchShape,
  updateMcpSettings,
} from '~~/server/utils/mcp/private/settings'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import { joinPhrases } from '~~/server/utils/besidka-tools/summary'

type UpdateSettingsInput = z.infer<z.ZodObject<typeof mcpSettingsPatchShape>>

export const updateSettingsBesidkaTool = defineBesidkaTool({
  name: 'update_settings',
  title: 'Change my settings',
  description: 'Change one or more of your Besidka preferences: '
    + 'reasoningExpanded, reasoningAutoHide, defaultReasoningLevel (null '
    + 'clears it), favoriteModels, favoriteGatewayModels, sidebarPinned, '
    + 'memoryEnabled and chatSearchEnabled. Each value replaces the '
    + 'previous one: favoriteModels and favoriteGatewayModels are replaced '
    + 'as a whole, so read get_settings first and send the full list or map. '
    + 'Automatic memory extraction, memory models, TypeSafe '
    + 'AI roles, the about-me text and consents cannot be changed through '
    + 'MCP. Requires signing in (settings:write).',
  inputSchema: mcpSettingsPatchShape,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'write',
  chat: { expose: true, tier: 'ask-every-time' },
  chatDescription: 'Change preferences: reasoning display and default level, '
    + 'favorite models, sidebar pinning, memory and chat search '
    + 'switches. Each value replaces the previous one.',
  summarize: (input: UpdateSettingsInput) => {
    const changedFields = Object.entries(input)
      .filter(([, value]) => {
        return value !== undefined
      })
      .map(([field]) => {
        return field
      })

    if (changedFields.length === 0) {
      return 'Change your settings'
    }

    return `Change your settings: ${joinPhrases(changedFields)}`
  },
  handler: async (input: UpdateSettingsInput, context) => {
    const updated = await updateMcpSettings(
      context.db,
      context.userId,
      input,
    )

    context.log({ settings_field_count: Object.keys(updated).length })

    return updated
  },
})

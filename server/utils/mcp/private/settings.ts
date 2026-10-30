import { createError } from 'evlog'
import { z } from 'zod'
import { MEMORY_SETTING_DEFAULTS } from '#shared/utils/memory-policy'
import { parseReasoningLevel } from '#shared/utils/reasoning'
import {
  defaultReasoningLevelSchema,
  favoriteGatewayModelsSchema,
  favoriteModelIdsSchema,
} from '#shared/utils/user-settings-schemas'
import {
  applyUserSettingsUpdate,
  dedupeFavoriteGatewayModels,
} from '~~/server/utils/settings/apply-user-settings'
import type {
  UserSettingsFieldUpdates,
} from '~~/server/utils/settings/apply-user-settings'

type DbClient = ReturnType<typeof useDb>

export const mcpSettingsPatchShape = {
  reasoningExpanded: z.boolean().optional(),
  reasoningAutoHide: z.boolean().optional(),
  defaultReasoningLevel: defaultReasoningLevelSchema.optional(),
  favoriteModels: favoriteModelIdsSchema.optional(),
  favoriteGatewayModels: favoriteGatewayModelsSchema.strict().optional(),
  sidebarPinned: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  chatSearchEnabled: z.boolean().optional(),
}

const mcpSettingsPatchSchema = z.object(mcpSettingsPatchShape).strict()

export type McpSettingsPatch = z.infer<typeof mcpSettingsPatchSchema>

export async function getMcpSettings(db: DbClient, userId: number) {
  const settings = await db.query.userSettings.findFirst({
    where: {
      userId,
    },
    columns: {
      reasoningExpanded: true,
      reasoningAutoHide: true,
      defaultReasoningLevel: true,
      sidebarPinned: true,
      favoriteModels: true,
      favoriteGatewayModels: true,
      memoryEnabled: true,
      memoryExtractionEnabled: true,
      chatSearchEnabled: true,
      profileMemoryModel: true,
      projectMemoryModel: true,
    },
  })

  return {
    reasoningExpanded: settings?.reasoningExpanded ?? false,
    reasoningAutoHide: settings?.reasoningAutoHide ?? true,
    defaultReasoningLevel: parseReasoningLevel(
      settings?.defaultReasoningLevel,
    ),
    favoriteModels: settings?.favoriteModels ?? [],
    favoriteGatewayModels: settings?.favoriteGatewayModels ?? {},
    sidebarPinned: settings?.sidebarPinned ?? false,
    memoryEnabled: settings?.memoryEnabled
      ?? MEMORY_SETTING_DEFAULTS.memoryEnabled,
    chatSearchEnabled: settings?.chatSearchEnabled
      ?? MEMORY_SETTING_DEFAULTS.chatSearchEnabled,
    memoryExtractionEnabled: settings?.memoryExtractionEnabled
      ?? MEMORY_SETTING_DEFAULTS.memoryExtractionEnabled,
    profileMemoryModel: settings?.profileMemoryModel ?? null,
    projectMemoryModel: settings?.projectMemoryModel ?? null,
  }
}

function buildFieldUpdates(patch: McpSettingsPatch): UserSettingsFieldUpdates {
  const fieldUpdates: UserSettingsFieldUpdates = {}

  if (patch.reasoningExpanded !== undefined) {
    fieldUpdates.reasoningExpanded = patch.reasoningExpanded
  }

  if (patch.reasoningAutoHide !== undefined) {
    fieldUpdates.reasoningAutoHide = patch.reasoningAutoHide
  }

  if (patch.defaultReasoningLevel !== undefined) {
    fieldUpdates.defaultReasoningLevel = patch.defaultReasoningLevel
  }

  if (patch.favoriteModels !== undefined) {
    fieldUpdates.favoriteModels = [...new Set(patch.favoriteModels)]
  }

  if (patch.favoriteGatewayModels !== undefined) {
    fieldUpdates.favoriteGatewayModels = dedupeFavoriteGatewayModels(
      patch.favoriteGatewayModels,
    )
  }

  if (patch.sidebarPinned !== undefined) {
    fieldUpdates.sidebarPinned = patch.sidebarPinned
  }

  if (patch.memoryEnabled !== undefined) {
    fieldUpdates.memoryEnabled = patch.memoryEnabled
  }

  if (patch.chatSearchEnabled !== undefined) {
    fieldUpdates.chatSearchEnabled = patch.chatSearchEnabled
  }

  return fieldUpdates
}

async function assertMemoryEnableDoesNotResumeExtraction(
  db: DbClient,
  userId: number,
): Promise<void> {
  const current = await getMcpSettings(db, userId)

  if (current.memoryEnabled) {
    return
  }

  if (!current.memoryExtractionEnabled) {
    const projectWithAutoUpdateOn = await db.query.projects.findFirst({
      where: { userId, memoryAutoUpdate: 'on' },
      columns: { id: true },
    })

    if (!projectWithAutoUpdateOn) {
      return
    }
  }

  throw createError({
    status: 400,
    message: 'Turning memory on would also resume automatic memory '
      + 'updates from your chats, which use your API keys. Turn memory on '
      + 'in Besidka (Profile, Memory) instead.',
  })
}

/**
 * Updates the display and chat preferences a connected app may change.
 * Settings that authorise spend or change who receives data (automatic
 * memory extraction, the memory models and gateways, the TypeSafe AI roles,
 * the "about me" text, consents) are not in the schema, and a strict
 * schema refuses any key it does not list. Writes go through the same
 * `applyUserSettingsUpdate` as the web settings route.
 */
export async function updateMcpSettings(
  db: DbClient,
  userId: number,
  input: unknown,
) {
  const parsed = mcpSettingsPatchSchema.safeParse(input)

  if (!parsed.success) {
    throw createError({
      status: 400,
      message: 'Invalid settings: '
        + `${parsed.error.issues[0]?.message ?? 'check the fields'}`,
      why: parsed.error.message,
    })
  }

  const fieldUpdates = buildFieldUpdates(parsed.data)

  if (Object.keys(fieldUpdates).length === 0) {
    throw createError({
      status: 400,
      message: 'Send at least one setting to change.',
    })
  }

  if (fieldUpdates.memoryEnabled === true) {
    await assertMemoryEnableDoesNotResumeExtraction(db, userId)
  }

  await applyUserSettingsUpdate({ db, userId, fieldUpdates })

  return fieldUpdates
}

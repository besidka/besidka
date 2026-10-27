import { defineEventHandler } from 'nuxt/server'
import type { AboutMeNotMigratedReason } from '#shared/types/memory.d'
import { MEMORY_SETTING_DEFAULTS } from '#shared/utils/memory-policy'
import { parseReasoningLevel } from '#shared/utils/reasoning'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { migrateAboutMeToProfileEntry } from '~~/server/utils/memory/about-me-migration'
import type { AboutMeMigrationSettings } from '~~/server/utils/memory/about-me-migration'

type DbClient = ReturnType<typeof useDb>
type RequestLogger = ReturnType<typeof useRequestLogger>

interface AboutMeMigrationResult {
  isMigrated: boolean
  reason: AboutMeNotMigratedReason | null
}

async function migrateAboutMe(
  db: DbClient,
  userId: number,
  settings: AboutMeMigrationSettings | null,
  logger: RequestLogger,
): Promise<AboutMeMigrationResult> {
  try {
    const outcome = await migrateAboutMeToProfileEntry({
      db,
      userId,
      logger,
      settings,
      recordCompliance: false,
    })

    if (outcome.status === 'migrated') {
      return { isMigrated: true, reason: null }
    }

    return {
      isMigrated: false,
      reason: outcome.reason === 'empty' ? null : outcome.reason,
    }
  } catch (exception) {
    logger.set({
      attributes: {
        memoryMigration: { aboutMeError: exceptionMessage(exception) },
      },
    })

    return { isMigrated: false, reason: null }
  }
}

export default defineEventHandler(async (event) => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const settings = await db.query.userSettings.findFirst({
    where: {
      userId,
    },
    columns: {
      reasoningExpanded: true,
      reasoningAutoHide: true,
      defaultReasoningLevel: true,
      allowExternalLinks: true,
      notificationPromptState: true,
      sidebarPinned: true,
      favoriteModels: true,
      favoriteGatewayModels: true,
      memoryEnabled: true,
      memoryExtractionEnabled: true,
      chatSearchEnabled: true,
      aboutMe: true,
      profileMemoryModel: true,
      profileMemoryGateway: true,
      projectMemoryModel: true,
      projectMemoryGateway: true,
      typesafeRoles: true,
    },
  })
  const migration = await migrateAboutMe(
    db,
    userId,
    settings ?? null,
    useRequestLogger(event),
  )
  const aboutMe = migration.isMigrated
    ? null
    : settings?.aboutMe ?? MEMORY_SETTING_DEFAULTS.aboutMe

  return {
    reasoningExpanded: settings?.reasoningExpanded ?? false,
    reasoningAutoHide: settings?.reasoningAutoHide ?? true,
    defaultReasoningLevel: parseReasoningLevel(
      settings?.defaultReasoningLevel,
    ),
    allowExternalLinks: settings?.allowExternalLinks ?? null,
    notificationPromptState: settings?.notificationPromptState ?? null,
    sidebarPinned: settings?.sidebarPinned ?? false,
    favoriteModels: settings?.favoriteModels ?? [],
    favoriteGatewayModels: settings?.favoriteGatewayModels ?? {},
    memoryEnabled: settings?.memoryEnabled
      ?? MEMORY_SETTING_DEFAULTS.memoryEnabled,
    memoryExtractionEnabled: settings?.memoryExtractionEnabled
      ?? MEMORY_SETTING_DEFAULTS.memoryExtractionEnabled,
    chatSearchEnabled: settings?.chatSearchEnabled
      ?? MEMORY_SETTING_DEFAULTS.chatSearchEnabled,
    memoryIncludeSensitive: MEMORY_SETTING_DEFAULTS.memoryIncludeSensitive,
    aboutMe,
    aboutMeNotMigratedReason: aboutMe?.trim() ? migration.reason : null,
    profileMemoryModel: settings?.profileMemoryModel ?? null,
    profileMemoryGateway: settings?.profileMemoryGateway ?? null,
    projectMemoryModel: settings?.projectMemoryModel ?? null,
    projectMemoryGateway: settings?.projectMemoryGateway ?? null,
    typesafeRoles: settings?.typesafeRoles ?? null,
  }
})

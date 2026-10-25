import { defineEventHandler } from 'nuxt/server'
import type { AboutMeNotMigratedReason } from '#shared/types/memory.d'
import { MEMORY_SETTING_DEFAULTS } from '#shared/utils/memory-policy'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { migrateAboutMeToProfileEntry } from '~~/server/utils/memory/about-me-migration'

type DbClient = ReturnType<typeof useDb>
type RequestLogger = ReturnType<typeof useRequestLogger>

async function migrateAboutMe(
  db: DbClient,
  userId: number,
  logger: RequestLogger,
): Promise<AboutMeNotMigratedReason | null> {
  try {
    const outcome = await migrateAboutMeToProfileEntry({ db, userId, logger })

    if (outcome.status === 'migrated' || outcome.reason === 'empty') {
      return null
    }

    return outcome.reason
  } catch (exception) {
    logger.set({
      attributes: {
        memoryMigration: { aboutMeError: exceptionMessage(exception) },
      },
    })

    return null
  }
}

export default defineEventHandler(async (event) => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const aboutMeNotMigratedReason = await migrateAboutMe(
    db,
    userId,
    useRequestLogger(event),
  )

  const settings = await db.query.userSettings.findFirst({
    where: {
      userId,
    },
    columns: {
      reasoningExpanded: true,
      reasoningAutoHide: true,
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
    },
  })

  return {
    reasoningExpanded: settings?.reasoningExpanded ?? false,
    reasoningAutoHide: settings?.reasoningAutoHide ?? true,
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
    aboutMe: settings?.aboutMe ?? MEMORY_SETTING_DEFAULTS.aboutMe,
    aboutMeNotMigratedReason: settings?.aboutMe?.trim()
      ? aboutMeNotMigratedReason
      : null,
    profileMemoryModel: settings?.profileMemoryModel ?? null,
    profileMemoryGateway: settings?.profileMemoryGateway ?? null,
    projectMemoryModel: settings?.projectMemoryModel ?? null,
    projectMemoryGateway: settings?.projectMemoryGateway ?? null,
  }
})

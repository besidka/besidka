import { defineEventHandler } from 'nuxt/server'
import { MEMORY_SETTING_DEFAULTS } from '#shared/utils/memory-policy'

export default defineEventHandler(async () => {
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const settings = await useDb().query.userSettings.findFirst({
    where: {
      userId: parseInt(session.user.id),
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
      memoryIncludeSensitive: true,
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
    memoryIncludeSensitive: settings?.memoryIncludeSensitive
      ?? MEMORY_SETTING_DEFAULTS.memoryIncludeSensitive,
    aboutMe: settings?.aboutMe ?? MEMORY_SETTING_DEFAULTS.aboutMe,
    profileMemoryModel: settings?.profileMemoryModel ?? null,
    profileMemoryGateway: settings?.profileMemoryGateway ?? null,
    projectMemoryModel: settings?.projectMemoryModel ?? null,
    projectMemoryGateway: settings?.projectMemoryGateway ?? null,
  }
})

import { MEMORY_SETTING_DEFAULTS } from '#shared/utils/memory-policy'

type DbClient = ReturnType<typeof useDb>

export interface MemoryRuntimeSettings {
  memoryEnabled: boolean
  chatSearchEnabled: boolean
  memoryIncludeSensitive: boolean
  aboutMe: string | null
}

export async function loadMemoryRuntimeSettings(input: {
  db: DbClient
  userId: number
}): Promise<MemoryRuntimeSettings> {
  const settings = await input.db.query.userSettings.findFirst({
    where: { userId: input.userId },
    columns: {
      memoryEnabled: true,
      chatSearchEnabled: true,
      aboutMe: true,
    },
  })

  const aboutMe = settings?.aboutMe?.trim() ?? ''

  return {
    memoryEnabled: settings?.memoryEnabled
      ?? MEMORY_SETTING_DEFAULTS.memoryEnabled,
    chatSearchEnabled: settings?.chatSearchEnabled
      ?? MEMORY_SETTING_DEFAULTS.chatSearchEnabled,
    memoryIncludeSensitive: MEMORY_SETTING_DEFAULTS.memoryIncludeSensitive,
    aboutMe: aboutMe === '' ? MEMORY_SETTING_DEFAULTS.aboutMe : aboutMe,
  }
}

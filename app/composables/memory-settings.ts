import { parseError } from 'evlog'
import type { Ref } from 'vue'
import type { MemorySettingsFields } from '#shared/types/memory.d'
import type {
  MemorySaveResult,
  MemorySettingsSave,
} from '~/types/memory-settings.d'

const memorySettingKeys: Array<keyof MemorySettingsFields> = [
  'memoryEnabled',
  'chatSearchEnabled',
  'memoryIncludeSensitive',
  'aboutMe',
  'profileMemoryModel',
  'profileMemoryGateway',
  'projectMemoryModel',
  'projectMemoryGateway',
]

function pickMemorySettings(
  source: Partial<MemorySettingsFields>,
): Partial<MemorySettingsFields> {
  const picked: Partial<MemorySettingsFields> = {}

  for (const key of memorySettingKeys) {
    if (key in source) {
      Object.assign(picked, { [key]: source[key] })
    }
  }

  return picked
}

export function useMemorySettingsSaver(
  settings: Ref<MemorySettingsFields | null | undefined>,
) {
  const values = computed<MemorySettingsFields>(() => {
    return {
      memoryEnabled: MEMORY_SETTING_DEFAULTS.memoryEnabled,
      chatSearchEnabled: MEMORY_SETTING_DEFAULTS.chatSearchEnabled,
      memoryIncludeSensitive: MEMORY_SETTING_DEFAULTS.memoryIncludeSensitive,
      aboutMe: MEMORY_SETTING_DEFAULTS.aboutMe,
      profileMemoryModel: null,
      profileMemoryGateway: null,
      projectMemoryModel: null,
      projectMemoryGateway: null,
      ...settings.value,
    }
  })

  const save: MemorySettingsSave = async (patch) => {
    const previous = pickMemorySettings(values.value)
    const rollback: Partial<MemorySettingsFields> = {}

    for (const key of Object.keys(patch) as Array<keyof MemorySettingsFields>) {
      Object.assign(rollback, { [key]: previous[key] })
    }

    settings.value = { ...values.value, ...patch }

    try {
      const response: MemorySaveResult = await $fetch(
        '/api/v1/profiles/settings',
        {
          method: 'PATCH',
          body: patch,
        },
      )

      settings.value = {
        ...values.value,
        ...pickMemorySettings(response ?? {}),
      }

      return { ok: true, result: response ?? {} }
    } catch (exception) {
      settings.value = { ...values.value, ...rollback }

      return { ok: false, parsed: parseError(exception) }
    }
  }

  return {
    values,
    save,
  }
}

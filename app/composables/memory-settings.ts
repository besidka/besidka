import { parseError } from 'evlog'
import type { Ref } from 'vue'
import type { MemorySettingsFields } from '#shared/types/memory.d'
import type {
  MemorySaveOutcome,
  MemorySaveResult,
  MemorySettingsSave,
} from '~/types/memory-settings.d'

const memorySettingKeys: Array<keyof MemorySettingsFields> = [
  'memoryEnabled',
  'memoryExtractionEnabled',
  'chatSearchEnabled',
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
      memoryExtractionEnabled: MEMORY_SETTING_DEFAULTS.memoryExtractionEnabled,
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

  let persisted: Partial<MemorySettingsFields> | null = null
  let versionCounter = 0
  let requestQueue: Promise<unknown> = Promise.resolve()
  const latestVersions: Partial<Record<keyof MemorySettingsFields, number>> = {}

  function isLatestForKey(
    key: keyof MemorySettingsFields,
    version: number,
  ): boolean {
    return (latestVersions[key] ?? 0) <= version
  }

  async function sendPatch(
    patch: Partial<MemorySettingsFields>,
    version: number,
  ): Promise<MemorySaveOutcome> {
    try {
      const response: MemorySaveResult = await $fetch(
        '/api/v1/profiles/settings',
        {
          method: 'PATCH',
          body: patch,
        },
      )
      const confirmed = pickMemorySettings(response ?? {})
      const visible: Partial<MemorySettingsFields> = {}

      persisted = { ...persisted, ...confirmed }

      for (const key of Object.keys(confirmed) as Array<
        keyof MemorySettingsFields
      >) {
        if (isLatestForKey(key, version)) {
          Object.assign(visible, { [key]: confirmed[key] })
        }
      }

      settings.value = { ...values.value, ...visible }

      return { ok: true, result: response ?? {} }
    } catch (exception) {
      const rollback: Partial<MemorySettingsFields> = {}

      for (const key of Object.keys(patch) as Array<
        keyof MemorySettingsFields
      >) {
        if (isLatestForKey(key, version)) {
          Object.assign(rollback, { [key]: persisted?.[key] })
        }
      }

      settings.value = { ...values.value, ...rollback }

      return { ok: false, parsed: parseError(exception) }
    }
  }

  const save: MemorySettingsSave = (patch) => {
    persisted ??= pickMemorySettings(values.value)
    versionCounter += 1

    const version = versionCounter

    for (const key of Object.keys(patch) as Array<keyof MemorySettingsFields>) {
      latestVersions[key] = version
    }

    settings.value = { ...values.value, ...patch }

    const outcome = requestQueue.then(() => {
      return sendPatch(patch, version)
    })

    requestQueue = outcome

    return outcome
  }

  return {
    values,
    save,
  }
}

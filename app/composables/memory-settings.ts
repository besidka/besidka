import { parseError } from 'evlog'
import type { Ref } from 'vue'
import type {
  MemorySaveOutcome,
  MemorySaveResult,
  MemoryUiSettings,
  MemorySettingsSave,
} from '~/types/memory-settings.d'

const MEMORY_EXTRACTION_DEFAULT = false

const memorySettingKeys: Array<keyof MemoryUiSettings> = [
  'memoryEnabled',
  'memoryExtractionEnabled',
  'chatSearchEnabled',
  'memoryIncludeSensitive',
  'aboutMe',
  'profileMemoryModel',
  'profileMemoryGateway',
  'projectMemoryModel',
  'projectMemoryGateway',
]

function pickMemorySettings(
  source: Partial<MemoryUiSettings>,
): Partial<MemoryUiSettings> {
  const picked: Partial<MemoryUiSettings> = {}

  for (const key of memorySettingKeys) {
    if (key in source) {
      Object.assign(picked, { [key]: source[key] })
    }
  }

  return picked
}

export function useMemorySettingsSaver(
  settings: Ref<Partial<MemoryUiSettings> | null | undefined>,
) {
  const values = computed<MemoryUiSettings>(() => {
    return {
      memoryEnabled: MEMORY_SETTING_DEFAULTS.memoryEnabled,
      memoryExtractionEnabled: MEMORY_EXTRACTION_DEFAULT,
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

  let persisted: Partial<MemoryUiSettings> | null = null
  let versionCounter = 0
  let requestQueue: Promise<unknown> = Promise.resolve()
  const latestVersions: Partial<Record<keyof MemoryUiSettings, number>> = {}

  function isLatestForKey(
    key: keyof MemoryUiSettings,
    version: number,
  ): boolean {
    return (latestVersions[key] ?? 0) <= version
  }

  async function sendPatch(
    patch: Partial<MemoryUiSettings>,
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
      const visible: Partial<MemoryUiSettings> = {}

      persisted = { ...persisted, ...confirmed }

      for (const key of Object.keys(confirmed) as Array<
        keyof MemoryUiSettings
      >) {
        if (isLatestForKey(key, version)) {
          Object.assign(visible, { [key]: confirmed[key] })
        }
      }

      settings.value = { ...values.value, ...visible }

      return { ok: true, result: response ?? {} }
    } catch (exception) {
      const rollback: Partial<MemoryUiSettings> = {}

      for (const key of Object.keys(patch) as Array<keyof MemoryUiSettings>) {
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

    for (const key of Object.keys(patch) as Array<keyof MemoryUiSettings>) {
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

import { parseError } from 'evlog'
import {
  GOOGLE_TOOL_MODE_LABELS,
  findGoogleCatalogTool,
} from '#shared/utils/google-tool-catalog'
import type {
  GoogleService,
  GoogleToolPermissionMode,
} from '#shared/utils/google-tool-catalog'

export type GoogleToolPermissionTarget
  = | { tool: string }
    | { service: GoogleService }

export const GOOGLE_TOOL_PERMISSIONS_KEY = 'google-tool-permissions'

const NOT_FOUND_STATUS = 404

/**
 * The user's Google tool permissions with optimistic saves. A change shows
 * at once; the server answers with the stored list, which replaces the local
 * one, and a failure drops the optimistic value and reports the error.
 * `isUnavailable` is true when the account reaches no Google tool (a 404),
 * which is not an error to show. `announcement` is the text of the last
 * saved change for a polite live region.
 */
export function useGoogleToolPermissions() {
  const { data, status, error, refresh } = useLazyFetch(
    '/api/v1/google/tool-permissions',
    { key: GOOGLE_TOOL_PERMISSIONS_KEY },
  )
  const optimisticModes = shallowRef<Record<string, GoogleToolPermissionMode>>(
    {},
  )
  const savingCount = shallowRef<number>(0)
  const announcement = shallowRef<string>('')

  const tools = computed(() => {
    return (data.value?.tools ?? []).map((tool) => {
      return { ...tool, mode: optimisticModes.value[tool.name] ?? tool.mode }
    })
  })

  const isSaving = computed<boolean>(() => savingCount.value > 0)

  const isUnavailable = computed<boolean>(() => {
    const failure = error.value as { statusCode?: number } | null

    return failure?.statusCode === NOT_FOUND_STATUS
  })

  function findTargetNames(target: GoogleToolPermissionTarget): string[] {
    return (data.value?.tools ?? [])
      .filter((tool) => {
        return 'tool' in target
          ? tool.name === target.tool
          : tool.service === target.service
      })
      .map(tool => tool.name)
  }

  function setOptimistic(names: string[], mode: GoogleToolPermissionMode) {
    const next = { ...optimisticModes.value }

    for (const name of names) {
      next[name] = mode
    }

    optimisticModes.value = next
  }

  function clearOptimistic(names: string[], mode: GoogleToolPermissionMode) {
    const next = { ...optimisticModes.value }

    for (const name of names) {
      if (next[name] === mode) {
        Reflect.deleteProperty(next, name)
      }
    }

    optimisticModes.value = next
  }

  function describeChange(
    target: GoogleToolPermissionTarget,
    mode: GoogleToolPermissionMode,
  ): string {
    const subject = 'tool' in target
      ? findGoogleCatalogTool(target.tool)?.title ?? 'This tool'
      : 'All tools of this service'

    return `${subject}: ${GOOGLE_TOOL_MODE_LABELS[mode]}.`
  }

  async function save(
    target: GoogleToolPermissionTarget,
    mode: GoogleToolPermissionMode,
  ) {
    const names = findTargetNames(target)

    setOptimistic(names, mode)
    savingCount.value += 1

    try {
      const response = await $fetch('/api/v1/google/tool-permissions', {
        method: 'PUT',
        body: { ...target, mode },
      })

      data.value = response
      announcement.value = describeChange(target, mode)
    } catch (exception) {
      const parsedException = parseError(exception)

      announcement.value = ''
      useErrorMessage(
        parsedException.message || 'Failed to save the permission',
        parsedException.why,
      )
    } finally {
      clearOptimistic(names, mode)
      savingCount.value -= 1
    }
  }

  return {
    tools,
    status,
    error,
    refresh,
    isSaving,
    isUnavailable,
    announcement,
    save,
  }
}

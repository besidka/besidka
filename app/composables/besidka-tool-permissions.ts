import { parseError } from 'evlog'
import type { BesidkaToolPermissionTier } from '#shared/utils/besidka-tool-permissions'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'

export type BesidkaToolPermissionTarget
  = | { tool: string }
    | { tier: BesidkaToolPermissionTier }

export const BESIDKA_TOOL_PERMISSIONS_KEY = 'besidka-tool-permissions'

/**
 * The user's Besidka tool permissions with optimistic saves. A change shows
 * at once; the server answers with the stored list, which replaces the local
 * one, and a failure drops the optimistic value and reports the error.
 */
export function useBesidkaToolPermissions() {
  const { data, status, error, refresh } = useLazyFetch(
    '/api/v1/besidka-tools/permissions',
    { key: BESIDKA_TOOL_PERMISSIONS_KEY },
  )
  const optimisticModes = shallowRef<Record<string, ToolPermissionMode>>({})
  const savingCount = shallowRef<number>(0)

  const tools = computed(() => {
    return (data.value?.tools ?? []).map((tool) => {
      return { ...tool, mode: optimisticModes.value[tool.name] ?? tool.mode }
    })
  })

  const isSaving = computed<boolean>(() => savingCount.value > 0)

  function findTargetNames(target: BesidkaToolPermissionTarget): string[] {
    return (data.value?.tools ?? [])
      .filter((tool) => {
        return 'tool' in target
          ? tool.name === target.tool
          : tool.tier === target.tier
      })
      .map(tool => tool.name)
  }

  function setOptimistic(names: string[], mode: ToolPermissionMode) {
    const next = { ...optimisticModes.value }

    for (const name of names) {
      next[name] = mode
    }

    optimisticModes.value = next
  }

  function clearOptimistic(names: string[], mode: ToolPermissionMode) {
    const next = { ...optimisticModes.value }

    for (const name of names) {
      if (next[name] === mode) {
        Reflect.deleteProperty(next, name)
      }
    }

    optimisticModes.value = next
  }

  async function save(
    target: BesidkaToolPermissionTarget,
    mode: ToolPermissionMode,
  ) {
    const names = findTargetNames(target)

    setOptimistic(names, mode)
    savingCount.value += 1

    try {
      const response = await $fetch('/api/v1/besidka-tools/permissions', {
        method: 'PUT',
        body: { ...target, mode },
      })

      data.value = response
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to save the permission',
        parsedException.why,
      )
    } finally {
      clearOptimistic(names, mode)
      savingCount.value -= 1
    }
  }

  return { tools, status, error, refresh, isSaving, save }
}

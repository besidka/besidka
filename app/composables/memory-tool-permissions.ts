import { parseError } from 'evlog'
import type { MemoryPermissionToolName } from '#shared/utils/memory-tool-permissions'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'

export const MEMORY_TOOL_PERMISSIONS_KEY = 'memory-tool-permissions'

/**
 * The user's permission mode for the two memory write tools with optimistic
 * saves. A change shows at once; the server answers with the stored list,
 * which replaces the local one, and a failure drops the optimistic value and
 * reports the error. Saves run one after another, so an older answer can
 * never replace a newer one.
 */
export function useMemoryToolPermissions() {
  const { data, status, error, refresh } = useLazyFetch(
    '/api/v1/memory/tool-permissions',
    { key: MEMORY_TOOL_PERMISSIONS_KEY },
  )
  const optimisticModes = shallowRef<
    Partial<Record<MemoryPermissionToolName, ToolPermissionMode>>
  >({})
  const savingCount = shallowRef<number>(0)
  let queue: Promise<void> = Promise.resolve()

  const tools = computed(() => {
    return (data.value?.tools ?? []).map((tool) => {
      return { ...tool, mode: optimisticModes.value[tool.name] ?? tool.mode }
    })
  })

  const isSaving = computed<boolean>(() => savingCount.value > 0)

  function clearOptimistic(
    name: MemoryPermissionToolName,
    mode: ToolPermissionMode,
  ) {
    if (optimisticModes.value[name] !== mode) {
      return
    }

    const next = { ...optimisticModes.value }

    Reflect.deleteProperty(next, name)
    optimisticModes.value = next
  }

  async function send(
    name: MemoryPermissionToolName,
    mode: ToolPermissionMode,
  ) {
    try {
      data.value = await $fetch('/api/v1/memory/tool-permissions', {
        method: 'PUT',
        body: { tool: name, mode },
      })
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Failed to save the permission',
        parsedException.why,
      )
    } finally {
      clearOptimistic(name, mode)
      savingCount.value -= 1
    }
  }

  function save(
    name: MemoryPermissionToolName,
    mode: ToolPermissionMode,
  ): Promise<void> {
    optimisticModes.value = { ...optimisticModes.value, [name]: mode }
    savingCount.value += 1
    queue = queue.then(() => send(name, mode))

    return queue
  }

  return { tools, status, error, refresh, isSaving, save }
}

import { parseError } from 'evlog'
import {
  GOOGLE_TOOL_MODE_LABELS,
  findGoogleCatalogTool,
} from '#shared/utils/google-tool-catalog'
import type { GoogleToolKind } from '#shared/utils/google-tool-approvals'
import type {
  GoogleService,
  GoogleToolPermissionMode,
} from '#shared/utils/google-tool-catalog'

export type GoogleToolPermissionTarget
  = | { tool: string }
    | { service: GoogleService }
    | { service: GoogleService, kind: GoogleToolKind }

export const GOOGLE_TOOL_PERMISSIONS_KEY = 'google-tool-permissions'

export const googleToolPermissionPutQueue = createSpacedKeyedQueue()

function describeTargetKey(target: GoogleToolPermissionTarget): string {
  if ('tool' in target) {
    return `tool:${target.tool}`
  }

  if ('kind' in target) {
    return `kind:${target.service}:${target.kind}`
  }

  return `service:${target.service}`
}

const NOT_FOUND_STATUS = 404

const SERVICE_LABELS: Readonly<Record<GoogleService, string>> = {
  drive: 'Drive',
  gmail: 'Gmail',
  calendar: 'Calendar',
}

/**
 * The user's Google tool permissions with optimistic saves. A change shows
 * at once; the server answers with the stored list, which replaces the local
 * one, and a failure drops the optimistic value and reports the error.
 * Each save takes a sequence number and owns the tools it names until a
 * later save names them: a response only decides the tools its save still
 * owns, so overlapping saves that settle out of order leave the last click
 * on screen. A failure refetches once nothing is pending, so the list
 * matches what the server kept. `isUnavailable` is true when the account
 * reaches no Google tool (a 404), which is not an error to show.
 * `announcement` is the text of the last saved change for a polite live
 * region.
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
  const latestSaveByTool = new Map<string, number>()
  let saveSequence = 0
  let needsRefresh = false

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
        if ('tool' in target) {
          return tool.name === target.tool
        }

        if (tool.service !== target.service) {
          return false
        }

        return !('kind' in target)
          || findGoogleCatalogTool(tool.name)?.kind === target.kind
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

  function clearOptimistic(names: string[]) {
    const next = { ...optimisticModes.value }

    for (const name of names) {
      Reflect.deleteProperty(next, name)
    }

    optimisticModes.value = next
  }

  function describeChange(
    target: GoogleToolPermissionTarget,
    mode: GoogleToolPermissionMode,
  ): string {
    const modeLabel = GOOGLE_TOOL_MODE_LABELS[mode]

    if ('tool' in target) {
      const title = findGoogleCatalogTool(target.tool)?.title ?? 'This tool'

      return `${title}: ${modeLabel}.`
    }

    const service = SERVICE_LABELS[target.service]
    const subject = 'kind' in target
      ? `${service} ${target.kind} tools`
      : `${service} tools`

    return `${subject}: ${modeLabel}.`
  }

  function mergeSupersededTools(
    response: NonNullable<typeof data.value>,
    seq: number,
  ): NonNullable<typeof data.value> {
    const currentTools = data.value?.tools ?? []

    return {
      ...response,
      tools: response.tools.map((tool) => {
        if (latestSaveByTool.get(tool.name) === seq) {
          return tool
        }

        return currentTools.find(current => current.name === tool.name) ?? tool
      }),
    }
  }

  async function save(
    target: GoogleToolPermissionTarget,
    mode: GoogleToolPermissionMode,
  ) {
    const names = findTargetNames(target)

    saveSequence += 1

    const seq = saveSequence

    for (const name of names) {
      latestSaveByTool.set(name, seq)
    }

    setOptimistic(names, mode)
    savingCount.value += 1

    const ownedNames = () => {
      return names.filter(name => latestSaveByTool.get(name) === seq)
    }

    try {
      const response = await googleToolPermissionPutQueue.enqueue(
        describeTargetKey(target),
        () => {
          return $fetch('/api/v1/google/tool-permissions', {
            method: 'PUT',
            body: { ...target, mode },
          })
        },
      )

      data.value = mergeSupersededTools(response, seq)

      if (ownedNames().length > 0) {
        announcement.value = describeChange(target, mode)
      }
    } catch (exception) {
      const parsedException = parseError(exception)

      needsRefresh = true
      announcement.value = ''
      useErrorMessage(
        parsedException.message || 'Failed to save the permission',
        parsedException.why,
      )
    } finally {
      clearOptimistic(ownedNames())
      savingCount.value -= 1

      if (savingCount.value === 0 && needsRefresh) {
        needsRefresh = false
        await refresh()
      }
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

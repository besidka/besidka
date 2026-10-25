import { parseError } from 'evlog'
import type {
  KnowledgeItem,
  KnowledgeMode,
  ProjectKnowledgeSummary,
} from '#shared/types/project-knowledge.d'
import type {
  KnowledgeAddItemsOptions,
  KnowledgeCommitInput,
  KnowledgeItemInput,
  KnowledgeItemPatchInput,
  KnowledgeItemsAddResult,
  KnowledgeItemTextResult,
  KnowledgeModeResult,
  KnowledgeNoteCreateInput,
  KnowledgeNoteUpdateInput,
  KnowledgeVersionResult,
  ProjectKnowledgeOutcome,
} from '~/types/project-knowledge.d'

type KnowledgeTotals = ProjectKnowledgeSummary['totals']

interface OptimisticMode {
  projectId: string
  mode: KnowledgeMode
}

const DEFAULT_MODE: KnowledgeMode = 'auto'

const EMPTY_ITEMS: KnowledgeItem[] = []

const EMPTY_TOTALS: KnowledgeTotals = {
  latinChars: 0,
  cyrillicChars: 0,
  otherChars: 0,
  textBytes: 0,
  items: 0,
}

const mutationChains = new Map<string, Promise<void>>()

function computeTotals(items: KnowledgeItem[]): KnowledgeTotals {
  return items.reduce<KnowledgeTotals>((totals, item) => {
    return {
      latinChars: totals.latinChars + item.latinChars,
      cyrillicChars: totals.cyrillicChars + item.cyrillicChars,
      otherChars: totals.otherChars + item.otherChars,
      textBytes: totals.textBytes + item.textBytes,
      items: totals.items + 1,
    }
  }, { ...EMPTY_TOTALS })
}

function withItems(
  summary: ProjectKnowledgeSummary,
  items: KnowledgeItem[],
): ProjectKnowledgeSummary {
  return { ...summary, items, totals: computeTotals(items) }
}

function upsertItems(
  existingItems: KnowledgeItem[],
  incomingItems: KnowledgeItem[],
): KnowledgeItem[] {
  const incomingById = new Map<string, KnowledgeItem>(
    incomingItems.map(item => [item.id, item]),
  )
  const replacedItems = existingItems.map((item) => {
    return incomingById.get(item.id) ?? item
  })
  const existingIds = new Set<string>(existingItems.map(item => item.id))
  const appendedItems = incomingItems.filter(item => !existingIds.has(item.id))

  return [...replacedItems, ...appendedItems]
}

async function settle(operation: Promise<unknown>): Promise<void> {
  try {
    await operation
  } catch (exception) {
    void exception
  }
}

function baseUrl(projectId: string): `/${string}` {
  return `/api/v1/projects/${encodeURIComponent(projectId)}/knowledge`
}

function itemUrl(projectId: string, itemId: string): string {
  return `${baseUrl(projectId)}/items/${encodeURIComponent(itemId)}`
}

function missingProjectOutcome<Result>(): ProjectKnowledgeOutcome<Result> {
  return {
    ok: false,
    parsed: parseError(new Error('No project is selected')),
  }
}

export function useProjectKnowledge(
  projectId: MaybeRefOrGetter<string | undefined>,
) {
  const resolvedProjectId = computed<string | undefined>(() => {
    return toValue(projectId) || undefined
  })

  const {
    data,
    pending,
    error,
    refresh: refreshSummary,
  } = useLazyFetch<ProjectKnowledgeSummary>(
    () => baseUrl(resolvedProjectId.value ?? ''),
    {
      key: () => `project-knowledge:${resolvedProjectId.value ?? 'none'}`,
      enabled: () => Boolean(resolvedProjectId.value),
    },
  )

  const optimisticMode = shallowRef<OptimisticMode | null>(null)
  let mutationSequence = 0
  let modeSequence = 0

  const items = computed<KnowledgeItem[]>(() => {
    return data.value?.items ?? EMPTY_ITEMS
  })

  const totals = computed<KnowledgeTotals>(() => {
    return data.value?.totals ?? EMPTY_TOTALS
  })

  const version = computed<number | null>(() => {
    return data.value?.version ?? null
  })

  const packVersion = computed<number | null>(() => {
    return data.value?.packVersion ?? null
  })

  const mode = computed<KnowledgeMode>(() => {
    const optimistic = optimisticMode.value

    if (optimistic && optimistic.projectId === resolvedProjectId.value) {
      return optimistic.mode
    }

    return data.value?.mode ?? DEFAULT_MODE
  })

  function isCurrentProject(targetProjectId: string): boolean {
    return resolvedProjectId.value === targetProjectId
  }

  function patchSummary(
    targetProjectId: string,
    update: (summary: ProjectKnowledgeSummary) => ProjectKnowledgeSummary,
  ): boolean {
    const summary = data.value

    if (!summary || !isCurrentProject(targetProjectId)) {
      return false
    }

    data.value = update(summary)

    return true
  }

  function applyVersion(
    summary: ProjectKnowledgeSummary,
    result: KnowledgeVersionResult,
  ): ProjectKnowledgeSummary {
    return {
      ...summary,
      version: result.version,
      packVersion: result.packVersion,
    }
  }

  async function settleChain(targetProjectId: string): Promise<void> {
    await mutationChains.get(targetProjectId)
  }

  async function refresh(): Promise<void> {
    const targetProjectId = resolvedProjectId.value

    if (!targetProjectId) {
      return
    }

    await settleChain(targetProjectId)

    const sequenceAtStart = mutationSequence

    await refreshSummary()

    if (
      sequenceAtStart === mutationSequence
      || !isCurrentProject(targetProjectId)
    ) {
      return
    }

    await settleChain(targetProjectId)
    await refreshSummary()
  }

  function enqueue<Result>(
    targetProjectId: string,
    task: () => Promise<Result>,
  ): Promise<Result> {
    const previous = mutationChains.get(targetProjectId) ?? Promise.resolve()
    const run = previous.then(task)

    mutationChains.set(targetProjectId, settle(run))

    return run
  }

  async function runMutation<Result>(
    request: (targetProjectId: string) => Promise<Result>,
    apply?: (targetProjectId: string, result: Result) => void,
  ): Promise<ProjectKnowledgeOutcome<Result>> {
    const targetProjectId = resolvedProjectId.value

    if (!targetProjectId) {
      return missingProjectOutcome<Result>()
    }

    mutationSequence += 1

    return enqueue(targetProjectId, async () => {
      try {
        const result = await request(targetProjectId)

        if (isCurrentProject(targetProjectId)) {
          apply?.(targetProjectId, result)
        }

        return { ok: true, result } as const
      } catch (exception) {
        return { ok: false, parsed: parseError(exception) } as const
      }
    })
  }

  async function setMode(
    nextMode: KnowledgeMode | null,
  ): Promise<ProjectKnowledgeOutcome<KnowledgeModeResult>> {
    const targetProjectId = resolvedProjectId.value

    if (!targetProjectId) {
      return missingProjectOutcome<KnowledgeModeResult>()
    }

    modeSequence += 1

    const token = modeSequence

    optimisticMode.value = {
      projectId: targetProjectId,
      mode: nextMode ?? DEFAULT_MODE,
    }

    const outcome = await runMutation<KnowledgeModeResult>(
      (id) => {
        return $fetch<KnowledgeModeResult>(`${baseUrl(id)}/mode`, {
          method: 'PATCH',
          body: { mode: nextMode },
        })
      },
      (id, result) => {
        const confirmedMode = result.mode ?? DEFAULT_MODE
        const isPatched = patchSummary(id, (summary) => {
          return { ...summary, mode: confirmedMode }
        })

        if (!isPatched) {
          refreshSummary()
        }
      },
    )

    if (token === modeSequence) {
      optimisticMode.value = null
    }

    return outcome
  }

  function addItems(
    inputs: KnowledgeItemInput[],
    options: KnowledgeAddItemsOptions = {},
  ): Promise<ProjectKnowledgeOutcome<KnowledgeItemsAddResult>> {
    return runMutation<KnowledgeItemsAddResult>(
      (id) => {
        return $fetch<KnowledgeItemsAddResult>(`${baseUrl(id)}/items`, {
          method: 'POST',
          body: {
            items: inputs,
            ...(options.commit ? { commit: true } : {}),
          },
        })
      },
      (id, result) => {
        patchSummary(id, (summary) => {
          return withItems(
            applyVersion(summary, result),
            upsertItems(summary.items, result.items),
          )
        })
      },
    )
  }

  function removeItem(
    itemId: string,
  ): Promise<ProjectKnowledgeOutcome<KnowledgeVersionResult>> {
    return runMutation<KnowledgeVersionResult>(
      (id) => {
        return $fetch<KnowledgeVersionResult>(itemUrl(id, itemId), {
          method: 'DELETE',
        })
      },
      (id, result) => {
        patchSummary(id, (summary) => {
          return withItems(
            applyVersion(summary, result),
            summary.items.filter(item => item.id !== itemId),
          )
        })
      },
    )
  }

  function patchItem(
    itemId: string,
    patch: KnowledgeItemPatchInput,
  ): Promise<ProjectKnowledgeOutcome<KnowledgeItem>> {
    return runMutation<KnowledgeItem>(
      (id) => {
        return $fetch<KnowledgeItem>(itemUrl(id, itemId), {
          method: 'PATCH',
          body: patch,
        })
      },
      (id, result) => {
        patchSummary(id, (summary) => {
          return withItems(summary, upsertItems(summary.items, [result]))
        })
      },
    )
  }

  async function createNote(
    input: KnowledgeNoteCreateInput,
  ): Promise<ProjectKnowledgeOutcome<KnowledgeItem>> {
    const outcome = await runMutation<KnowledgeItem>(
      (id) => {
        return $fetch<KnowledgeItem>(`${baseUrl(id)}/notes`, {
          method: 'POST',
          body: input,
        })
      },
      (id, result) => {
        patchSummary(id, (summary) => {
          return withItems(summary, upsertItems(summary.items, [result]))
        })
      },
    )

    if (outcome.ok) {
      refresh()
    }

    return outcome
  }

  async function updateNote(
    itemId: string,
    input: KnowledgeNoteUpdateInput,
  ): Promise<ProjectKnowledgeOutcome<KnowledgeItem>> {
    const outcome = await runMutation<KnowledgeItem>(
      (id) => {
        return $fetch<KnowledgeItem>(
          `${baseUrl(id)}/notes/${encodeURIComponent(itemId)}`,
          { method: 'PATCH', body: input },
        )
      },
      (id, result) => {
        patchSummary(id, (summary) => {
          return withItems(summary, upsertItems(summary.items, [result]))
        })
      },
    )

    if (outcome.ok) {
      refresh()
    }

    return outcome
  }

  async function getItemText(
    itemId: string,
  ): Promise<ProjectKnowledgeOutcome<KnowledgeItemTextResult>> {
    const targetProjectId = resolvedProjectId.value

    if (!targetProjectId) {
      return missingProjectOutcome<KnowledgeItemTextResult>()
    }

    try {
      const result = await $fetch<KnowledgeItemTextResult>(
        `${itemUrl(targetProjectId, itemId)}/text`,
      )

      return { ok: true, result }
    } catch (exception) {
      return { ok: false, parsed: parseError(exception) }
    }
  }

  function commit(
    body: KnowledgeCommitInput = {},
  ): Promise<ProjectKnowledgeOutcome<KnowledgeVersionResult>> {
    return runMutation<KnowledgeVersionResult>(
      (id) => {
        return $fetch<KnowledgeVersionResult>(`${baseUrl(id)}/commit`, {
          method: 'POST',
          body,
        })
      },
      (id, result) => {
        const removedIds = new Set<string>(body.remove ?? [])

        patchSummary(id, (summary) => {
          return withItems(
            applyVersion(summary, result),
            summary.items.filter(item => !removedIds.has(item.id)),
          )
        })
      },
    )
  }

  return {
    summary: data,
    items,
    mode,
    totals,
    version,
    packVersion,
    pending,
    error,
    refresh,
    setMode,
    addItems,
    removeItem,
    patchItem,
    createNote,
    updateNote,
    getItemText,
    commit,
  }
}

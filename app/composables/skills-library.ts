import type { MaybeRefOrGetter, Ref } from 'vue'
import { parseError } from 'evlog'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import { formatSkillCatalogLine } from '#shared/utils/skills/compose'
import { getSkillSourceGroup } from '#shared/utils/skills/edit'
import {
  isSkillCommandKind,
  isSkillSkillKind,
} from '#shared/utils/skills/mode'
import type { SkillMode } from '#shared/utils/skills/mode'
import type { SkillSourceGroup } from '#shared/utils/skills/edit'
import type {
  SkillSummary,
  SkillsListResponse,
} from '#shared/types/skills.d'

export type SkillSourceFilter = SkillSourceGroup | 'all'
export type SkillKindFilter = 'skills' | 'commands' | 'all'

export interface SkillFilterOption<Value extends string> {
  value: Value
  label: string
  count: number
}

export const SKILLS_LIBRARY_KEY = 'skills-library'
export const SKILLS_LIBRARY_SKELETON_DELAY_MS = 300
export const SKILLS_LIBRARY_SKELETON_ROWS = 4
export const SKILLS_FILTER_MIN_OPTIONS = 2
export const SKILLS_SEARCH_MIN_ITEMS = 8
export const SKILLS_SEARCH_DEBOUNCE_MS = 300
export const SKILL_VIEW_KEY_PREFIX = 'skill:'

const SOURCE_FILTERS: readonly SkillSourceGroup[] = [
  'created',
  'imported',
  'apps',
]
const SOURCE_FILTER_LABELS: Record<SkillSourceGroup, string> = {
  created: 'Created',
  imported: 'Imported',
  apps: 'From apps',
}
const KIND_FILTERS = ['skills', 'commands'] as const
const KIND_FILTER_LABELS: Record<typeof KIND_FILTERS[number], string> = {
  skills: 'Skills',
  commands: 'Commands',
}
const SHORT_SHA_LENGTH = 7
const GITHUB_HOST_PREFIX = /^https?:\/\//

export function isSkillKind(
  skill: Pick<SkillSummary, 'modelInvocable' | 'slashCommand'>,
  kind: Exclude<SkillKindFilter, 'all'>,
): boolean {
  return kind === 'commands'
    ? isSkillCommandKind(skill)
    : isSkillSkillKind(skill)
}

/**
 * The source chips: only groups the user has, each with its count, preceded
 * by All sources. Empty when fewer than two groups exist, because All and the
 * single group would show the same list.
 */
export function buildSkillSourceOptions(
  counts: SkillsListResponse['counts'] | null,
): Array<SkillFilterOption<SkillSourceFilter>> {
  if (!counts) {
    return []
  }

  const available = SOURCE_FILTERS.filter((group) => {
    return counts.sources[group] > 0
  })

  if (available.length < SKILLS_FILTER_MIN_OPTIONS) {
    return []
  }

  return [
    { value: 'all', label: 'All sources', count: counts.sources.all },
    ...available.map((group) => {
      return {
        value: group,
        label: SOURCE_FILTER_LABELS[group],
        count: counts.sources[group],
      }
    }),
  ]
}

/**
 * The kind chips. A skill that is both a skill and a command counts in both,
 * so All uses the server's total and not the sum of the two.
 */
export function buildSkillKindOptions(
  counts: SkillsListResponse['counts'] | null,
): Array<SkillFilterOption<SkillKindFilter>> {
  if (!counts) {
    return []
  }

  const available = KIND_FILTERS.filter((kind) => {
    return counts.kinds[kind] > 0
  })

  if (available.length < SKILLS_FILTER_MIN_OPTIONS) {
    return []
  }

  return [
    { value: 'all', label: 'All', count: counts.kinds.all },
    ...available.map((kind) => {
      return {
        value: kind,
        label: KIND_FILTER_LABELS[kind],
        count: counts.kinds[kind],
      }
    }),
  ]
}

export function parseSkillSourceFilter(value: unknown): SkillSourceFilter {
  return typeof value === 'string'
    && (SOURCE_FILTERS as readonly string[]).includes(value)
    ? value as SkillSourceGroup
    : 'all'
}

export function parseSkillKindFilter(value: unknown): SkillKindFilter {
  return typeof value === 'string'
    && (KIND_FILTERS as readonly string[]).includes(value)
    ? value as typeof KIND_FILTERS[number]
    : 'all'
}

export function filterSkills(
  skills: SkillSummary[],
  filters: { source: SkillSourceFilter, kind: SkillKindFilter, query: string },
): SkillSummary[] {
  const term = filters.query.trim().toLowerCase()

  return skills.filter((skill) => {
    if (
      filters.source !== 'all'
      && getSkillSourceGroup(skill.sourceKind) !== filters.source
    ) {
      return false
    }

    if (filters.kind !== 'all' && !isSkillKind(skill, filters.kind)) {
      return false
    }

    if (!term) {
      return true
    }

    return skill.name.toLowerCase().includes(term)
      || skill.description.toLowerCase().includes(term)
  })
}

export function getSkillKindLabels(
  skill: Pick<SkillSummary, 'modelInvocable' | 'slashCommand'>,
): string[] {
  return KIND_FILTERS
    .filter(kind => isSkillKind(skill, kind))
    .map((kind) => {
      return kind === 'skills' ? 'Skill' : 'Command'
    })
}

export function getSkillDisplayName(
  skill: Pick<SkillSummary, 'name' | 'slashCommand' | 'modelInvocable'>,
): string {
  return isSkillCommandKind(skill) ? `/${skill.name}` : skill.name
}

export function formatSkillSource(
  skill: Pick<
    SkillSummary,
    'sourceKind' | 'sourceUrl' | 'sourcePath' | 'sourceVersion'
  >,
): string {
  if (skill.sourceKind === 'github' && skill.sourceUrl) {
    const repository = skill.sourceUrl.replace(GITHUB_HOST_PREFIX, '')
    const location = skill.sourcePath
      ? `${repository}/${skill.sourcePath}`
      : repository
    const commit = skill.sourceVersion?.slice(0, SHORT_SHA_LENGTH)

    return commit ? `${location} @ ${commit}` : location
  }

  if (skill.sourceKind === 'zip') {
    return 'Uploaded file'
  }

  if (skill.sourceKind === 'text') {
    return 'Pasted text'
  }

  if (skill.sourceKind === 'url') {
    return skill.sourceUrl?.replace(GITHUB_HOST_PREFIX, '') ?? 'From a link'
  }

  if (skill.sourceKind === 'mcp') {
    return 'Added by a connected app'
  }

  if (skill.sourceKind === 'share') {
    return 'From a shared link'
  }

  return 'Created by you'
}

/**
 * The size of the catalog line a model-invocable skill adds to every message,
 * with the most conservative tokenizer family (Anthropic), because the
 * catalog goes to whichever model the chat uses.
 */
export function estimateSkillCatalogTokens(
  skill: Pick<SkillSummary, 'name' | 'description'>,
): number {
  return estimateMemoryTokens(
    formatSkillCatalogLine(skill.name, skill.description),
    'anthropic',
  )
}

/**
 * The size of a skill body the model reads when it activates the skill, with
 * the same conservative family as the catalog estimate.
 */
export function estimateSkillBodyTokens(body: string): number {
  return estimateMemoryTokens(body, 'anthropic')
}

export function requiresEnableConfirmation(
  skill: Pick<SkillSummary, 'sourceKind'>,
): boolean {
  return getSkillSourceGroup(skill.sourceKind) !== 'created'
}

/**
 * Source, kind and search text of the manager. The URL query is the source of
 * truth (`?source=...&kind=...&query=...`), so a filter change is a history
 * entry and Back restores the previous filters.
 */
export function useSkillsFilters() {
  const route = useRoute()
  const router = useRouter()

  const appliedSource = computed<SkillSourceFilter>(() => {
    return parseSkillSourceFilter(route.query.source)
  })
  const appliedKind = computed<SkillKindFilter>(() => {
    return parseSkillKindFilter(route.query.kind)
  })
  const appliedQuery = computed<string>(() => {
    return toArtifactSearchTerm(parseArtifactSearch(route.query.query))
  })

  const search = shallowRef<string>(parseArtifactSearch(route.query.query))

  let isCommitting = false

  async function commitQuery(
    changes: Record<string, string | undefined>,
    options: { replace?: boolean } = {},
  ) {
    const query = Object.fromEntries(
      Object.entries({ ...route.query, ...changes }).filter(([, value]) => {
        return value !== undefined
      }),
    )

    isCommitting = true

    try {
      if (options.replace) {
        await router.replace({ path: route.path, query })
      } else {
        await router.push({ path: route.path, query })
      }
    } finally {
      isCommitting = false
    }
  }

  const commitSearch = useDebounceFn(async () => {
    const term = toArtifactSearchTerm(search.value)

    if (term === appliedQuery.value) {
      return
    }

    await commitQuery({ query: term || undefined })
  }, SKILLS_SEARCH_DEBOUNCE_MS)

  async function setSource(
    source: SkillSourceFilter,
    options: { replace?: boolean } = {},
  ) {
    if (source === appliedSource.value) {
      return
    }

    await commitQuery({ source: source === 'all' ? undefined : source }, options)
  }

  async function setKind(
    kind: SkillKindFilter,
    options: { replace?: boolean } = {},
  ) {
    if (kind === appliedKind.value) {
      return
    }

    await commitQuery({ kind: kind === 'all' ? undefined : kind }, options)
  }

  async function clearFilters() {
    search.value = ''

    await commitQuery({
      query: undefined,
      source: undefined,
      kind: undefined,
    })
  }

  watch(search, () => {
    commitSearch()
  })

  watch(() => route.query.query, (value) => {
    if (isCommitting) {
      return
    }

    const fromUrl = parseArtifactSearch(value)

    if (toArtifactSearchTerm(search.value) !== toArtifactSearchTerm(fromUrl)) {
      search.value = fromUrl
    }
  })

  return {
    search,
    appliedSource,
    appliedKind,
    appliedQuery,
    setSource,
    setKind,
    clearFilters,
  }
}

/**
 * The user's skills: one `useLazyFetch` with a 300 ms skeleton delay, so a
 * fast response never flashes a skeleton. Counts come from the server because
 * a skill that is both a skill and a command counts in both kinds.
 */
export function useSkillsLibrary(filters: {
  source: Ref<SkillSourceFilter>
  kind: Ref<SkillKindFilter>
  query: Ref<string>
}) {
  const { data, status, error, refresh } = useLazyFetch('/api/v1/skills', {
    key: SKILLS_LIBRARY_KEY,
  })

  const isSkeletonDelayElapsed = shallowRef<boolean>(false)

  let skeletonTimer: ReturnType<typeof setTimeout> | null = null

  const isPending = computed<boolean>(() => {
    return status.value === 'pending'
  })

  const hasLoaded = computed<boolean>(() => {
    return !!data.value
  })

  const hasError = computed<boolean>(() => {
    return !!error.value && !data.value
  })

  const errorMessage = computed<string>(() => {
    return error.value
      ? parseError(error.value).message || 'Please try again.'
      : ''
  })

  const isSkeletonVisible = computed<boolean>(() => {
    return isPending.value && !data.value && isSkeletonDelayElapsed.value
  })

  const skills = computed<SkillSummary[]>(() => {
    return data.value?.skills ?? []
  })

  const counts = computed<SkillsListResponse['counts'] | null>(() => {
    return data.value?.counts ?? null
  })

  const visibleSkills = computed<SkillSummary[]>(() => {
    return filterSkills(skills.value, {
      source: filters.source.value,
      kind: filters.kind.value,
      query: filters.query.value,
    })
  })

  const needsReviewSkills = computed<SkillSummary[]>(() => {
    return skills.value.filter((skill) => {
      return skill.status === 'needs-review' || skill.pendingVersion !== null
    })
  })

  const sourceOptions = computed(() => {
    return buildSkillSourceOptions(counts.value)
  })

  const kindOptions = computed(() => {
    return buildSkillKindOptions(counts.value)
  })

  const isSearchVisible = computed<boolean>(() => {
    return skills.value.length >= SKILLS_SEARCH_MIN_ITEMS
      || !!filters.query.value
  })

  function clearSkeletonTimer() {
    if (skeletonTimer) {
      clearTimeout(skeletonTimer)
      skeletonTimer = null
    }
  }

  watch(isPending, (pending) => {
    clearSkeletonTimer()

    if (!pending) {
      isSkeletonDelayElapsed.value = false

      return
    }

    skeletonTimer = setTimeout(() => {
      isSkeletonDelayElapsed.value = true
    }, SKILLS_LIBRARY_SKELETON_DELAY_MS)
  }, { immediate: true })

  onScopeDispose(clearSkeletonTimer)

  return {
    data,
    skills,
    visibleSkills,
    needsReviewSkills,
    counts,
    sourceOptions,
    kindOptions,
    isSearchVisible,
    hasLoaded,
    hasError,
    errorMessage,
    isSkeletonVisible,
    refresh,
  }
}

export function useSkillDetail(skillId: MaybeRefOrGetter<string>) {
  const { data, status, error, refresh } = useLazyFetch(
    () => `/api/v1/skills/${toValue(skillId)}`,
    { key: `${SKILLS_LIBRARY_KEY}-detail-${toValue(skillId)}` },
  )

  return { data, status, error, refresh }
}

/**
 * Reloads the list and the open detail after any change to a skill.
 */
export async function refreshSkillData(skillId?: string): Promise<void> {
  const keys = [SKILLS_LIBRARY_KEY]

  if (skillId) {
    keys.push(`${SKILLS_LIBRARY_KEY}-detail-${skillId}`)
    keys.push(`${SKILLS_LIBRARY_KEY}-versions-${skillId}`)
  }

  await refreshNuxtData(keys)
}

/**
 * The pending update the review dialog shows. The page mounts one dialog and
 * every entry point (a row, the detail panel, the review banner, an update
 * check) only names the skill.
 */
export function useSkillUpdateReview() {
  const skillId = useState<string | null>('skills:update-review', () => null)

  function open(id: string) {
    skillId.value = id
  }

  function close() {
    skillId.value = null
  }

  return { skillId, open, close }
}

/**
 * Changes that go through `PATCH /api/v1/skills/[id]` and the actions that
 * touch the skill as a whole. Every action reports its own failure, so a
 * caller only needs the boolean.
 */
export function useSkillActions() {
  const busyIds = useState<string[]>('skills:busy-ids', () => [])

  function isBusy(skillId: string): boolean {
    return busyIds.value.includes(skillId)
  }

  async function runExclusive<Result>(
    skillId: string,
    action: () => Promise<Result>,
  ): Promise<Result> {
    busyIds.value = [...busyIds.value, skillId]

    try {
      return await action()
    } finally {
      busyIds.value = busyIds.value.filter((id) => {
        return id !== skillId
      })
    }
  }

  async function saveSettings(
    skillId: string,
    changes: {
      mode?: SkillMode
      argumentHint?: string | null
    },
  ): Promise<boolean> {
    return await runExclusive(skillId, async () => {
      try {
        await $fetch(`/api/v1/skills/${skillId}`, {
          method: 'PATCH',
          body: changes,
        })
        await refreshSkillData(skillId)

        return true
      } catch (exception) {
        const parsedException = parseError(exception)

        useErrorMessage(
          parsedException.message || 'Failed to save the skill',
          parsedException.why,
        )
        await refreshSkillData(skillId)

        return false
      }
    })
  }

  async function setMode(
    skill: Pick<SkillSummary, 'id' | 'name' | 'sourceKind' | 'enabled'>,
    mode: SkillMode,
  ): Promise<boolean> {
    if (
      mode !== 'off'
      && !skill.enabled
      && requiresEnableConfirmation(skill)
    ) {
      const confirmation = await useConfirm({
        text: `Turn on "${skill.name}"?`,
        subtitle: 'This skill was not written by you. Once it is on, the '
          + 'model can read it and follow its instructions in your chats. '
          + 'Review it first if you have not.',
        actions: ['Turn on'],
        labelDecline: 'Keep off',
      })

      if (!confirmation) {
        await refreshSkillData(skill.id)

        return false
      }
    }

    return await saveSettings(skill.id, { mode })
  }

  async function deleteSkill(
    skill: Pick<SkillSummary, 'id' | 'name'>,
  ): Promise<boolean> {
    const confirmation = await useConfirm({
      text: `Delete "${skill.name}"?`,
      subtitle: 'Deletes the skill, all its versions and files. '
        + 'This cannot be undone.',
      alert: true,
      actions: ['Delete'],
    })

    if (!confirmation) {
      return false
    }

    return await runExclusive(skill.id, async () => {
      try {
        await $fetch(`/api/v1/skills/${skill.id}`, { method: 'DELETE' })
        await refreshSkillData()

        return true
      } catch (exception) {
        const parsedException = parseError(exception)

        useErrorMessage(
          parsedException.message || 'Failed to delete the skill',
          parsedException.why,
        )

        return false
      }
    })
  }

  async function checkForUpdates(
    skill: Pick<SkillSummary, 'id' | 'name'>,
  ): Promise<'update' | 'up-to-date' | 'failed'> {
    return await runExclusive(skill.id, async () => {
      try {
        const result = await $fetch(
          `/api/v1/skills/${skill.id}/update/check`,
          { method: 'POST' },
        )

        await refreshSkillData(skill.id)

        if (result.upToDate) {
          useSuccessMessage(
            `${skill.name} is up to date`,
            'pinned' in result && result.pinned
              ? 'It is pinned to a commit, so there is nothing to check.'
              : undefined,
          )

          return 'up-to-date'
        }

        return 'update'
      } catch (exception) {
        const parsedException = parseError(exception)

        useErrorMessage(
          parsedException.message || 'Failed to check for updates',
          parsedException.why,
        )

        return 'failed'
      }
    })
  }

  return {
    busyIds,
    isBusy,
    saveSettings,
    setMode,
    deleteSkill,
    checkForUpdates,
  }
}

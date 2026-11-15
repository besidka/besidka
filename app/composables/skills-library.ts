import type { MaybeRefOrGetter, Ref } from 'vue'
import { parseError } from 'evlog'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import { formatSkillCatalogLine } from '#shared/utils/skills/compose'
import { getSkillSourceGroup } from '#shared/utils/skills/edit'
import { scanSkillText } from '#shared/utils/skills/findings'
import {
  formatGithubSourceVersion,
  isSemverTag,
} from '#shared/utils/skills/release'
import type { SkillMode } from '#shared/utils/skills/mode'
import type { SkillSourceGroup } from '#shared/utils/skills/edit'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import type {
  SkillSummary,
  SkillsListResponse,
} from '#shared/types/skills.d'

export type SkillSourceFilter = SkillSourceGroup | 'all'

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
export const SKILL_HIGHLIGHT_SCAN_MAX_FILES = 20

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
const GITHUB_HOST_PREFIX = /^https?:\/\//

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

export function parseSkillSourceFilter(value: unknown): SkillSourceFilter {
  return typeof value === 'string'
    && (SOURCE_FILTERS as readonly string[]).includes(value)
    ? value as SkillSourceGroup
    : 'all'
}

export function filterSkills(
  skills: SkillSummary[],
  filters: { source: SkillSourceFilter, query: string },
): SkillSummary[] {
  const term = filters.query.trim().toLowerCase()

  return skills.filter((skill) => {
    if (
      filters.source !== 'all'
      && getSkillSourceGroup(skill.sourceKind) !== filters.source
    ) {
      return false
    }

    if (!term) {
      return true
    }

    return skill.name.toLowerCase().includes(term)
      || skill.description.toLowerCase().includes(term)
      || (skill.command ?? '').includes(term)
  })
}

export function formatSkillSource(
  skill: Pick<
    SkillSummary,
    'sourceKind' | 'sourceUrl' | 'sourceRef' | 'sourcePath' | 'sourceVersion'
  >,
): string {
  if (skill.sourceKind === 'github' && skill.sourceUrl) {
    const repository = skill.sourceUrl.replace(GITHUB_HOST_PREFIX, '')
    const location = skill.sourcePath
      ? `${repository}/${skill.sourcePath}`
      : repository
    const version = formatGithubSourceVersion(skill)

    return version ? `${location} @ ${version}` : location
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
 * The version words of a skill's meta line. A release tag already sits in the
 * source (`github.com/o/r @ 2.1.2`); a `metadata.version` from the SKILL.md
 * is added when no tag applies. Besidka's own numbering then reads "edit v3",
 * so it is not mistaken for the author's version, and plain "v3" when there
 * is no other version on the line.
 */
export function formatSkillVersions(
  skill: Pick<
    SkillSummary,
    'sourceKind' | 'sourceRef' | 'metadataVersion' | 'currentVersion'
  >,
): string[] {
  const isTagged = skill.sourceKind === 'github'
    && !!skill.sourceRef
    && isSemverTag(skill.sourceRef)
  const authorVersion = isTagged ? null : skill.metadataVersion
  const parts: string[] = []

  if (authorVersion) {
    parts.push(`version ${authorVersion}`)
  }

  const hasAuthorVersion = isTagged || !!authorVersion

  parts.push(hasAuthorVersion
    ? `edit v${skill.currentVersion}`
    : `v${skill.currentVersion}`)

  return parts
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
 * Source and search text of the manager. The URL query is the source of
 * truth (`?source=...&query=...`), so a filter change is a history
 * entry and Back restores the previous filters.
 */
export function useSkillsFilters() {
  const route = useRoute()
  const router = useRouter()

  const appliedSource = computed<SkillSourceFilter>(() => {
    return parseSkillSourceFilter(route.query.source)
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

  async function clearFilters() {
    search.value = ''

    await commitQuery({
      query: undefined,
      source: undefined,
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
    appliedQuery,
    setSource,
    clearFilters,
  }
}

/**
 * The user's skills: one `useLazyFetch` with a 300 ms skeleton delay, so a
 * fast response never flashes a skeleton. Counts come from the server.
 */
export function useSkillsLibrary(filters: {
  source: Ref<SkillSourceFilter>
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

async function readSkillFileListing(skillId: string) {
  const listing = await $fetch(`/api/v1/skills/${skillId}/files`)

  return 'files' in listing && listing.files ? listing.files : []
}

function pickHighlightScanPaths(
  files: Array<{ path: string, kind?: string }>,
): string[] {
  const textFiles = files.filter((file) => {
    return file.kind !== 'asset'
  })
  const skillFile = textFiles.filter((file) => {
    return file.path === SKILL_MD_FILE_NAME
  })
  const otherFiles = textFiles.filter((file) => {
    return file.path !== SKILL_MD_FILE_NAME
  })

  return [...skillFile, ...otherFiles]
    .slice(0, SKILL_HIGHLIGHT_SCAN_MAX_FILES)
    .map((file) => {
      return file.path
    })
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
      command?: string | null
      argumentHint?: string | null
      licenseAcknowledged?: boolean
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

  /**
   * Saves the command (and its hint) without a toast: the settings form shows
   * the server's reason next to the field. Returns that message, or null once
   * the save went through.
   */
  async function saveCommand(
    skillId: string,
    changes: { command: string | null, argumentHint?: string | null },
  ): Promise<string | null> {
    return await runExclusive(skillId, async () => {
      try {
        await $fetch(`/api/v1/skills/${skillId}`, {
          method: 'PATCH',
          body: changes,
        })
        await refreshSkillData(skillId)

        return null
      } catch (exception) {
        const parsedException = parseError(exception)

        return parsedException.message
          || 'The command could not be saved.'
      }
    })
  }

  /**
   * The "Look closely" kinds of the current version, read by scanning its
   * files here in the browser: SKILL.md first, then up to the next
   * `SKILL_HIGHLIGHT_SCAN_MAX_FILES - 1` text files. A file that cannot be
   * read is skipped; an empty string comes back when none can be read.
   */
  async function readHighlightCategories(skillId: string): Promise<string> {
    const [listing] = await Promise.allSettled([
      readSkillFileListing(skillId),
    ])

    if (listing.status === 'rejected') {
      return ''
    }

    const scans = await Promise.allSettled(
      pickHighlightScanPaths(listing.value).map(async (path) => {
        const file = await $fetch(`/api/v1/skills/${skillId}/files`, {
          query: { path },
        })

        return 'text' in file ? scanSkillText(path, file.text) : []
      }),
    )
    const findings = scans.flatMap((scan) => {
      return scan.status === 'fulfilled' ? scan.value : []
    })

    return describeHighlightCategories(findings)
  }

  async function describeHighlightsForConfirmation(
    skill: Pick<SkillSummary, 'id'> & Partial<Pick<SkillSummary, 'highlightCount'>>,
  ): Promise<string> {
    if (!skill.highlightCount) {
      return ''
    }

    const categories = await runExclusive(skill.id, async () => {
      return await readHighlightCategories(skill.id)
    })
    const count = skill.highlightCount === 1
      ? '1 highlight is marked Look closely'
      : `${skill.highlightCount} highlights are marked Look closely`

    return categories
      ? ` ${count}: ${categories}.`
      : ` ${count}.`
  }

  async function setMode(
    skill: Pick<SkillSummary, 'id' | 'name' | 'sourceKind' | 'enabled'>
      & Partial<Pick<SkillSummary, 'status' | 'licenseClass' | 'highlightCount'>>,
    mode: SkillMode,
  ): Promise<boolean> {
    const needsLicenseTick = mode !== 'off'
      && !skill.enabled
      && skill.status === 'needs-review'
      && (skill.licenseClass === 'none' || skill.licenseClass === 'custom')

    if (
      mode !== 'off'
      && !skill.enabled
      && (requiresEnableConfirmation(skill) || needsLicenseTick)
    ) {
      const licenseWarning = skill.licenseClass === 'custom'
        ? ' It carries a custom license: confirm that you may use it.'
        : ' It states no license, so its author keeps all rights: confirm '
          + 'that you may use it.'
      const confirmation = await useConfirm({
        text: `Turn on "${skill.name}"?`,
        subtitle: 'This skill was not written by you. Once it is on, the '
          + 'model can read it and follow its instructions in your chats. '
          + 'Review it first if you have not.'
          + await describeHighlightsForConfirmation(skill)
          + (needsLicenseTick ? licenseWarning : ''),
        actions: [needsLicenseTick ? 'Turn on and confirm' : 'Turn on'],
        labelDecline: 'Keep off',
      })

      if (!confirmation) {
        await refreshSkillData(skill.id)

        return false
      }
    }

    return await saveSettings(skill.id, {
      mode,
      ...(needsLicenseTick ? { licenseAcknowledged: true } : {}),
    })
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
          if ('contentUnchanged' in result && result.contentUnchanged) {
            const newVersion = result.latestTag
              ?? result.latestVersion?.slice(0, 7)

            useSuccessMessage(
              `No changes in ${newVersion ?? 'the new version'}`,
              `${skill.name} is the same there, so nothing needs updating.`,
            )

            return 'up-to-date'
          }

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
    saveCommand,
    setMode,
    deleteSkill,
    checkForUpdates,
  }
}

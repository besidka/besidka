export const PROJECT_AUTO_UPDATE_VALUES = ['inherit', 'on', 'off'] as const

export type ProjectAutoUpdate = typeof PROJECT_AUTO_UPDATE_VALUES[number]

export type ProjectAutoUpdateSource = 'project' | 'account'

export type StoredProjectAutoUpdate = 'on' | 'off' | null

export interface ProjectAutoUpdateProjectFields {
  memoryAutoUpdate: StoredProjectAutoUpdate | undefined
  memoryAutoUpdateEnabledAt: Date | null | undefined
}

export interface ProjectAutoUpdateSettingsFields {
  memoryEnabled: boolean | null | undefined
  memoryExtractionEnabled: boolean | null | undefined
  memoryExtractionEnabledAt: Date | null | undefined
}

export interface ResolvedProjectAutoUpdate {
  autoUpdate: ProjectAutoUpdate
  source: ProjectAutoUpdateSource
  isEffective: boolean
  cutOver: Date | null
}

function laterOf(first: Date | null, second: Date | null): Date | null {
  if (!first || !second) {
    return first ?? second
  }

  return first > second ? first : second
}

export function toProjectAutoUpdate(
  stored: StoredProjectAutoUpdate | undefined,
): ProjectAutoUpdate {
  return stored ?? 'inherit'
}

/**
 * The single rule for automatic project-memory updates. `on` and `off` on
 * the project beat the account switch ("Generate memory from chats"); with
 * `inherit` the account switch decides. Memory turned off in the account
 * settings blocks everything. `cutOver` is the forward-only floor for project
 * chats: a chat is read only when its last activity is after it. `null` means
 * no project chat is eligible (not effective, or no cut-over was ever
 * recorded). With `on` it is the later of the account cut-over (only while the
 * account switch is on) and the project cut-over. With `inherit` it is the
 * later of the account cut-over and the project cut-over, which is only set
 * when the project left `off`, so chats written while it was off are never
 * read. The SQL twin of this rule is
 * `projectChatSweepCondition`; keep the two in step.
 */
export function resolveProjectAutoUpdate(
  project: ProjectAutoUpdateProjectFields,
  settings: ProjectAutoUpdateSettingsFields | null | undefined,
): ResolvedProjectAutoUpdate {
  const autoUpdate = toProjectAutoUpdate(project.memoryAutoUpdate)
  const source: ProjectAutoUpdateSource = autoUpdate === 'inherit'
    ? 'account'
    : 'project'
  const isMemoryOn = settings?.memoryEnabled !== false
  const isAccountExtractionOn = settings?.memoryExtractionEnabled === true
  const accountCutOver = isAccountExtractionOn
    ? settings?.memoryExtractionEnabledAt ?? null
    : null
  const projectCutOver = project.memoryAutoUpdateEnabledAt ?? null
  const isEffective = isMemoryOn && (
    autoUpdate === 'on'
    || (autoUpdate === 'inherit' && isAccountExtractionOn)
  )

  if (!isEffective) {
    return { autoUpdate, source, isEffective, cutOver: null }
  }

  if (autoUpdate === 'inherit' && !accountCutOver) {
    return { autoUpdate, source, isEffective, cutOver: null }
  }

  if (autoUpdate === 'on' && !projectCutOver) {
    return { autoUpdate, source, isEffective, cutOver: null }
  }

  const cutOver = laterOf(accountCutOver, projectCutOver)

  return { autoUpdate, source, isEffective, cutOver }
}

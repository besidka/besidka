import { parseError } from 'evlog'
import type { MaybeRefOrGetter } from 'vue'
import type {
  SkillDetail,
  SkillVersionDiffResponse,
} from '#shared/types/skills.d'
import {
  composeSkillMarkdown,
  formatSkillCatalogLine,
  splitSkillMarkdownParts,
} from '#shared/utils/skills/compose'
import type { SkillMarkdownParts } from '#shared/utils/skills/compose'
import { isSkillLicenceRootFile } from '#shared/utils/skills/edit'
import { scanSkillTextWithCounts } from '#shared/utils/skills/findings'
import { parseSkillMarkdown } from '#shared/utils/skills/frontmatter'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import { SKILL_EDIT_MAX_FILE_BYTES } from '#shared/utils/skills-policy'

export type SkillEditorPart = 'name' | 'description' | 'advanced' | 'body'

export interface SkillEditorSaveError {
  message: string
  why?: string
  fix?: string
}

export interface SkillEditorSaveResult {
  isSaved: boolean
  version?: number
  isUnchanged?: boolean
  isRenamed?: boolean
}

const READ_ONLY_REASON_LOCKED
  = 'This licence file stays as it was published. Licence files of an open '
    + 'or custom licence cannot be edited, renamed or deleted.'
const READ_ONLY_REASON_LARGE = `Files over ${
  SKILL_EDIT_MAX_FILE_BYTES / 1024
} KiB open read-only. You can still rename or delete this file.`

/**
 * The skill the editor is open on. The page mounts one editor and every entry
 * point (the row menu, the detail header, a new skill) only names the skill.
 */
export function useSkillEditSession() {
  const skillId = useState<string | null>('skills:edit-session', () => null)
  const isJustCreated = useState<boolean>(
    'skills:edit-session-created',
    () => false,
  )

  function open(id: string, options: { isJustCreated?: boolean } = {}) {
    skillId.value = id
    isJustCreated.value = options.isJustCreated ?? false
  }

  function close() {
    skillId.value = null
    isJustCreated.value = false
  }

  return { skillId, isJustCreated, open, close }
}

function createEditorFile(
  summary: SkillDetail['files'][number],
  filesLocked: boolean,
): SkillEditorFile {
  const isLocked = filesLocked && isSkillLicenceRootFile(summary.path)

  return {
    key: `file:${summary.path}`,
    originalPath: summary.path,
    path: summary.path,
    bytes: summary.bytes,
    text: null,
    originalText: null,
    loadState: 'idle',
    loadError: '',
    isDeleted: false,
    isLocked,
    isTooLarge: summary.bytes > SKILL_EDIT_MAX_FILE_BYTES,
  }
}

/**
 * The state of the skill editor: the working set of files, the fields of
 * `SKILL.md`, the changes a save would send and the problems that block it.
 * Nothing leaves the editor until `save()`; closing it discards the draft.
 * Every file is read from the version the editor opened on, and only files
 * that were opened and changed, or are new, become `put` changes.
 */
export function useSkillEditor(skillId: MaybeRefOrGetter<string>) {
  const librarySkills = useNuxtData(SKILLS_LIBRARY_KEY)

  const loadState = shallowRef<'loading' | 'ready' | 'error'>('loading')
  const loadError = shallowRef<string>('')
  const skill = shallowRef<SkillDetail | null>(null)
  const baseVersion = shallowRef<number>(0)
  const files = shallowRef<SkillEditorFile[]>([])
  const selectedKey = shallowRef<string>('')
  const originalSkillMd = shallowRef<string>('')
  const initialParts = shallowRef<SkillMarkdownParts | null>(null)
  const parts = shallowRef<SkillMarkdownParts | null>(null)
  const note = shallowRef<string>('')
  const isSaving = shallowRef<boolean>(false)
  const isConflict = shallowRef<boolean>(false)
  const saveError = shallowRef<SkillEditorSaveError | null>(null)
  const serverNameError = shallowRef<string>('')
  const isNameTaken = shallowRef<boolean>(false)
  const conflictDiff = shallowRef<SkillVersionDiffResponse | null>(null)
  const conflictDiffError = shallowRef<string>('')
  const isComparing = shallowRef<boolean>(false)

  let newFileCounter = 0

  const filesLocked = computed<boolean>(() => {
    return skill.value?.licence.filesLocked ?? false
  })

  const slashCommand = computed<boolean>(() => {
    return skill.value?.slashCommand ?? false
  })

  const skillMdText = computed<string>(() => {
    const current = parts.value
    const initial = initialParts.value

    if (!current || !initial) {
      return ''
    }

    const isTouched = current.body !== initial.body
      || current.name !== initial.name
      || current.description !== initial.description
      || current.advanced !== initial.advanced

    return isTouched
      ? composeSkillMarkdown(current, initial)
      : originalSkillMd.value
  })

  const workingFiles = computed<SkillEditorFile[]>(() => {
    return files.value.map((file) => {
      if (file.originalPath !== SKILL_MD_FILE_NAME) {
        return file
      }

      return { ...file, text: skillMdText.value }
    })
  })

  const visibleFiles = computed<SkillEditorFile[]>(() => {
    return workingFiles.value.filter((file) => {
      return !file.isDeleted
    })
  })

  const selectedFile = computed<SkillEditorFile | null>(() => {
    return visibleFiles.value.find((file) => {
      return file.key === selectedKey.value
    }) ?? null
  })

  const isSkillMdSelected = computed<boolean>(() => {
    return selectedFile.value?.originalPath === SKILL_MD_FILE_NAME
  })

  const isFieldsMode = computed<boolean>(() => {
    return parts.value?.mode === 'fields'
  })

  const changes = computed(() => {
    return buildSkillEditorChanges(workingFiles.value)
  })

  const isDirty = computed<boolean>(() => {
    return changes.value.length > 0
  })

  const saveBlockers = computed<string[]>(() => {
    return getSkillEditorSaveBlockers(workingFiles.value, changes.value)
  })

  const selectedReadOnlyReason = computed<string>(() => {
    const file = selectedFile.value

    if (!file) {
      return ''
    }

    if (file.isLocked) {
      return READ_ONLY_REASON_LOCKED
    }

    return file.isTooLarge ? READ_ONLY_REASON_LARGE : ''
  })

  const selectedValue = computed<string>(() => {
    if (isSkillMdSelected.value) {
      return parts.value?.body ?? ''
    }

    return selectedFile.value?.text ?? ''
  })

  const canRenameSelected = computed<boolean>(() => {
    const file = selectedFile.value

    return !!file && !file.isLocked && file.originalPath !== SKILL_MD_FILE_NAME
  })

  const canDeleteSelected = computed<boolean>(() => {
    return canRenameSelected.value
  })

  const treeFiles = computed(() => {
    return visibleFiles.value.map((file) => {
      return { path: file.path, bytes: getSkillEditorFileBytes(file) }
    })
  })

  const fileBadges = computed<Record<string, string>>(() => {
    const badges: Record<string, string> = {}

    for (const file of visibleFiles.value) {
      if (file.isLocked) {
        badges[file.path] = 'Read-only'
      } else if (file.originalPath === null) {
        badges[file.path] = 'New'
      } else if (file.path !== file.originalPath) {
        badges[file.path] = 'Renamed'
      } else if (file.text !== null && file.text !== file.originalText) {
        badges[file.path] = 'Edited'
      } else if (file.isTooLarge) {
        badges[file.path] = 'Read-only'
      }
    }

    return badges
  })

  const debouncedSnapshot = refDebounced(
    computed(() => {
      return {
        parts: parts.value,
        skillMd: skillMdText.value,
        path: selectedFile.value?.path ?? '',
        isSkillMd: isSkillMdSelected.value,
        text: selectedValue.value,
      }
    }),
    SKILL_EDITOR_VALIDATION_DEBOUNCE_MS,
  )

  const selectedScan = computed(() => {
    const snapshot = debouncedSnapshot.value

    return snapshot.path
      ? scanSkillTextWithCounts(snapshot.path, snapshot.text)
      : { findings: [], counts: {} }
  })

  const problems = computed<SkillEditorProblem[]>(() => {
    const snapshot = debouncedSnapshot.value
    const found: SkillEditorProblem[] = []

    if (snapshot.parts) {
      const parsed = parseSkillMarkdown(snapshot.skillMd)

      if (!parsed.ok) {
        const scope = getSkillFrontmatterProblemScope(parsed.code)
        const yamlIssue = scope === 'advanced'
          ? findAdvancedYamlIssue(snapshot.parts.advanced)
          : null

        found.push({
          id: `frontmatter-${parsed.code}`,
          severity: 'error',
          scope: snapshot.parts.mode === 'text' ? 'file' : scope,
          line: yamlIssue?.line ?? (scope === 'file' ? 1 : null),
          message: yamlIssue
            ? `${parsed.message}: ${yamlIssue.message}`
            : parsed.message,
        })
      } else {
        for (const [index, warning] of parsed.warnings.entries()) {
          found.push({
            id: `frontmatter-warning-${index}`,
            severity: 'warning',
            scope: snapshot.parts.mode === 'text' ? 'file' : 'advanced',
            line: null,
            message: warning,
          })
        }
      }

      if (snapshot.parts.mode === 'fields') {
        found.push(
          ...findHiddenCharacterProblems(snapshot.parts.name, 'name'),
          ...findHiddenCharacterProblems(
            snapshot.parts.description,
            'description',
          ),
          ...findHiddenCharacterProblems(snapshot.parts.advanced, 'advanced'),
        )
      }
    }

    if (snapshot.path && snapshot.path === selectedFile.value?.path) {
      found.push(...findHiddenCharacterProblems(
        snapshot.text,
        snapshot.isSkillMd && snapshot.parts?.mode === 'fields'
          ? 'body'
          : 'file',
      ))
    }

    return found
  })

  const nameError = computed<string>(() => {
    if (!parts.value || parts.value.mode !== 'fields') {
      return ''
    }

    const syntaxError = getSkillEditorNameError(parts.value.name, {
      slashCommand: slashCommand.value,
    })

    if (syntaxError) {
      return syntaxError
    }

    if (serverNameError.value) {
      return serverNameError.value
    }

    return isNameTaken.value
      ? `A skill named ${parts.value.name} exists. Pick another name.`
      : ''
  })

  const descriptionError = computed<string>(() => {
    return parts.value?.mode === 'fields'
      ? getSkillEditorDescriptionError(parts.value.description)
      : ''
  })

  const skillMdIssue = computed<string>(() => {
    return nameError.value
      || descriptionError.value
      || problems.value.find((problem) => {
        return problem.severity === 'error'
      })?.message
      || ''
  })

  const hasBlockingProblems = computed<boolean>(() => {
    return !!nameError.value
      || !!descriptionError.value
      || problems.value.some((problem) => {
        return problem.severity === 'error'
      })
      || saveBlockers.value.length > 0
  })

  const canSave = computed<boolean>(() => {
    return loadState.value === 'ready'
      && isDirty.value
      && !isSaving.value
      && !isConflict.value
      && !hasBlockingProblems.value
  })

  const catalogLine = computed<string>(() => {
    return parts.value?.mode === 'fields'
      ? formatSkillCatalogLine(parts.value.name, parts.value.description)
      : ''
  })

  const catalogTokens = computed<number>(() => {
    return catalogLine.value
      ? estimateMemoryTokens(catalogLine.value, 'anthropic')
      : 0
  })

  const bodyTokens = computed<number>(() => {
    return estimateSkillBodyTokens(parts.value?.body ?? '')
  })

  function updateFile(
    key: string,
    patch: Partial<SkillEditorFile>,
  ) {
    files.value = files.value.map((file) => {
      return file.key === key ? { ...file, ...patch } : file
    })
  }

  async function loadFile(key: string) {
    const file = files.value.find((candidate) => {
      return candidate.key === key
    })

    if (!file || file.originalPath === null || file.loadState === 'loading') {
      return
    }

    updateFile(key, { loadState: 'loading', loadError: '' })

    try {
      const response = await $fetch(
        `/api/v1/skills/${toValue(skillId)}/files`,
        { query: { path: file.originalPath, version: baseVersion.value } },
      )

      if (!('text' in response)) {
        throw new Error('The file could not be read.')
      }

      updateFile(key, {
        text: response.text,
        originalText: response.text,
        loadState: 'ready',
      })
    } catch (exception) {
      updateFile(key, {
        loadState: 'error',
        loadError: parseError(exception).message
          || 'The file could not be loaded.',
      })
    }
  }

  async function selectFile(path: string) {
    const file = visibleFiles.value.find((candidate) => {
      return candidate.path === path
    })

    if (!file) {
      return
    }

    selectedKey.value = file.key

    if (file.loadState === 'idle') {
      await loadFile(file.key)
    }
  }

  function resetDraftState() {
    note.value = ''
    isConflict.value = false
    saveError.value = null
    serverNameError.value = ''
    isNameTaken.value = false
    conflictDiff.value = null
    conflictDiffError.value = ''
  }

  async function load() {
    loadState.value = 'loading'
    loadError.value = ''
    resetDraftState()

    try {
      const detail = await $fetch(`/api/v1/skills/${toValue(skillId)}`)
      const locked = detail.licence.filesLocked

      skill.value = detail
      baseVersion.value = detail.currentVersion
      files.value = detail.files.map((summary) => {
        return createEditorFile(summary, locked)
      })

      const response = await $fetch(
        `/api/v1/skills/${toValue(skillId)}/files`,
        {
          query: {
            path: SKILL_MD_FILE_NAME,
            version: detail.currentVersion,
          },
        },
      )

      if (!('text' in response)) {
        throw new Error('SKILL.md could not be read.')
      }

      const skillMd = files.value.find((file) => {
        return file.originalPath === SKILL_MD_FILE_NAME
      })

      if (!skillMd) {
        throw new Error('This skill has no SKILL.md.')
      }

      originalSkillMd.value = response.text
      initialParts.value = splitSkillMarkdownParts(response.text)
      parts.value = initialParts.value
      updateFile(skillMd.key, {
        text: response.text,
        originalText: response.text,
        loadState: 'ready',
      })
      selectedKey.value = skillMd.key
      loadState.value = 'ready'
    } catch (exception) {
      loadError.value = parseError(exception).message
        || 'The skill could not be loaded.'
      loadState.value = 'error'
    }
  }

  function setPart(part: SkillEditorPart, value: string) {
    if (!parts.value) {
      return
    }

    parts.value = { ...parts.value, [part]: value }
    saveError.value = null

    if (part === 'name') {
      serverNameError.value = ''
      isNameTaken.value = false
    }
  }

  function setSelectedValue(value: string) {
    saveError.value = null

    if (isSkillMdSelected.value) {
      setPart('body', value)

      return
    }

    const file = selectedFile.value

    if (file && !file.isLocked && !file.isTooLarge) {
      updateFile(file.key, { text: value })
    }
  }

  function applyProblemFix(problem: SkillEditorProblem) {
    if (problem.fix !== 'remove-hidden-characters') {
      return
    }

    if (
      problem.scope === 'name'
      || problem.scope === 'description'
      || problem.scope === 'advanced'
      || problem.scope === 'body'
    ) {
      setPart(
        problem.scope,
        removeSkillHiddenCharacters(parts.value?.[problem.scope] ?? ''),
      )

      return
    }

    setSelectedValue(removeSkillHiddenCharacters(selectedValue.value))
  }

  async function checkNameOnBlur() {
    if (!parts.value || parts.value.mode !== 'fields') {
      return
    }

    const name = parts.value.name

    if (getSkillEditorNameError(name, { slashCommand: slashCommand.value })) {
      return
    }

    let known = librarySkills.data.value?.skills

    if (!known) {
      try {
        known = (await $fetch('/api/v1/skills')).skills
      } catch {
        return
      }
    }

    if (parts.value?.name !== name) {
      return
    }

    isNameTaken.value = isSkillEditorNameTaken(name, toValue(skillId), known)
  }

  function validatePath(path: string, editingKey: string | null = null) {
    return validateSkillEditorPath(path, {
      files: workingFiles.value,
      filesLocked: filesLocked.value,
      editingKey,
    })
  }

  function addFile(path: string): boolean {
    if (validatePath(path)) {
      return false
    }

    newFileCounter += 1

    const key = `${SKILL_EDITOR_NEW_FILE_KEY_PREFIX}${newFileCounter}`

    files.value = [...files.value, {
      key,
      originalPath: null,
      path,
      bytes: 0,
      text: '',
      originalText: null,
      loadState: 'ready',
      loadError: '',
      isDeleted: false,
      isLocked: false,
      isTooLarge: false,
    }]
    selectedKey.value = key

    return true
  }

  function renameSelected(path: string): boolean {
    const file = selectedFile.value

    if (!file || !canRenameSelected.value || validatePath(path, file.key)) {
      return false
    }

    updateFile(file.key, { path })

    return true
  }

  function deleteSelected() {
    const file = selectedFile.value

    if (!file || !canDeleteSelected.value) {
      return
    }

    if (file.originalPath === null) {
      files.value = files.value.filter((candidate) => {
        return candidate.key !== file.key
      })
    } else {
      updateFile(file.key, { isDeleted: true })
    }

    const skillMd = files.value.find((candidate) => {
      return candidate.originalPath === SKILL_MD_FILE_NAME
    })

    selectedKey.value = skillMd?.key ?? ''
  }

  async function save(): Promise<SkillEditorSaveResult> {
    if (!canSave.value) {
      return { isSaved: false }
    }

    isSaving.value = true
    saveError.value = null

    try {
      const trimmedNote = note.value.trim()
      const result = await $fetch(
        `/api/v1/skills/${toValue(skillId)}/versions`,
        {
          method: 'POST',
          body: {
            baseVersion: baseVersion.value,
            changes: changes.value,
            ...(trimmedNote ? { note: trimmedNote } : {}),
          },
        },
      )

      await refreshSkillData(toValue(skillId))

      return {
        isSaved: true,
        version: result.version,
        isUnchanged: result.unchanged,
        isRenamed: 'renamed' in result ? result.renamed : false,
      }
    } catch (exception) {
      const parsedException = parseError(exception)

      if (parsedException.code === 'stale-base') {
        isConflict.value = true
      } else if (
        parsedException.code === 'name-taken'
        || parsedException.code === 'reserved-name'
      ) {
        serverNameError.value = parsedException.message
      } else {
        saveError.value = {
          message: parsedException.message || 'The skill could not be saved',
          why: parsedException.why,
          fix: parsedException.fix,
        }
      }

      return { isSaved: false }
    } finally {
      isSaving.value = false
    }
  }

  async function compareWithLatest() {
    isComparing.value = true
    conflictDiff.value = null
    conflictDiffError.value = ''

    try {
      const latest = await $fetch(`/api/v1/skills/${toValue(skillId)}`)

      conflictDiff.value = await $fetch(
        `/api/v1/skills/${toValue(skillId)}/versions/${
          latest.currentVersion
        }/diff`,
        { query: { against: baseVersion.value } },
      )
    } catch (exception) {
      const parsedException = parseError(exception)

      conflictDiffError.value = parsedException.status === 404
        ? 'The version you started from is no longer kept, so there is '
        + 'nothing to compare. Reload to see the latest version.'
        : parsedException.message || 'The comparison could not be loaded.'
    } finally {
      isComparing.value = false
    }
  }

  return {
    loadState,
    loadError,
    skill,
    baseVersion,
    files,
    selectedKey,
    selectedFile,
    selectedValue,
    selectedReadOnlyReason,
    selectedScan,
    isSkillMdSelected,
    isFieldsMode,
    parts,
    note,
    isSaving,
    isConflict,
    saveError,
    conflictDiff,
    conflictDiffError,
    isComparing,
    changes,
    isDirty,
    canSave,
    problems,
    saveBlockers,
    nameError,
    descriptionError,
    skillMdIssue,
    hasBlockingProblems,
    canRenameSelected,
    canDeleteSelected,
    filesLocked,
    treeFiles,
    fileBadges,
    catalogLine,
    catalogTokens,
    bodyTokens,
    load,
    selectFile,
    loadFile,
    setPart,
    setSelectedValue,
    applyProblemFix,
    checkNameOnBlur,
    validatePath,
    addFile,
    renameSelected,
    deleteSelected,
    save,
    compareWithLatest,
  }
}

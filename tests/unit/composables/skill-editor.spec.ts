import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { useSkillEditor } from '../../../app/composables/skill-editor'
import { createSkillDetail } from '../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refreshNuxtData: vi.fn(),
}))

const libraryData = ref<unknown>(undefined)

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('refreshNuxtData', () => mocks.refreshNuxtData)
mockNuxtImport('useNuxtData', () => {
  return () => ({ data: libraryData })
})

enableAutoUnmount(afterEach)

const SKILL_MD = [
  '---',
  'name: review-pr',
  'description: Review a pull request',
  '---',
  '# Review',
  '',
  'Read the diff.',
  '',
].join('\n')

const FILE_TEXTS: Record<string, string> = {
  'SKILL.md': SKILL_MD,
  'references/guide.md': '# Guide\n',
  'LICENSE.txt': 'MIT License\n',
}

function createDetail(overrides = {}) {
  return createSkillDetail({
    id: 'S1',
    name: 'review-pr',
    currentVersion: 3,
    slashCommand: false,
    licence: {
      class: 'open',
      field: 'MIT',
      fileSha256: 'a'.repeat(64),
      filesLocked: true,
    },
    files: [
      { path: 'SKILL.md', bytes: 100, kind: 'skill-md', sha256: 'a', editable: true },
      { path: 'references/guide.md', bytes: 8, kind: 'reference', sha256: 'b', editable: true },
      { path: 'LICENSE.txt', bytes: 12, kind: 'licence', sha256: 'c', editable: false },
    ],
    ...overrides,
  })
}

function respond(detail = createDetail()) {
  mocks.fetch.mockImplementation(async (url: string, options?: {
    query?: { path?: string }
    method?: string
  }) => {
    if (url === '/api/v1/skills/S1' && !options?.method) {
      return detail
    }

    if (url === '/api/v1/skills/S1/files') {
      const path = options?.query?.path ?? ''

      return { path, text: FILE_TEXTS[path] ?? '', version: 3 }
    }

    return {}
  })
}

async function mountEditor() {
  let editor!: ReturnType<typeof useSkillEditor>

  await mountSuspended(defineComponent({
    setup() {
      editor = useSkillEditor('S1')

      return () => h('div')
    },
  }))
  await editor.load()
  await flushPromises()

  return editor
}

function saveCall() {
  return mocks.fetch.mock.calls.find((call) => {
    return call[0] === '/api/v1/skills/S1/versions'
  })
}

describe('useSkillEditor', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.refreshNuxtData.mockReset()
    libraryData.value = undefined
    respond()
  })

  it('loads the skill and SKILL.md from the current version', async () => {
    const editor = await mountEditor()

    expect(editor.loadState.value).toBe('ready')
    expect(editor.baseVersion.value).toBe(3)
    expect(editor.selectedFile.value?.path).toBe('SKILL.md')
    expect(editor.parts.value?.name).toBe('review-pr')
    expect(editor.selectedValue.value).toBe('# Review\n\nRead the diff.\n')
    expect(editor.isDirty.value).toBe(false)
    expect(editor.canSave.value).toBe(false)
    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/S1/files', {
      query: { path: 'SKILL.md', version: 3 },
    })
  })

  it('reports a load failure', async () => {
    mocks.fetch.mockRejectedValue({ data: { message: 'Skill not found' } })

    const editor = await mountEditor()

    expect(editor.loadState.value).toBe('error')
    expect(editor.loadError.value).toBe('Skill not found')
  })

  it('stays clean for a file that is opened and not changed', async () => {
    const editor = await mountEditor()

    await editor.selectFile('references/guide.md')

    expect(editor.selectedValue.value).toBe('# Guide\n')
    expect(editor.isDirty.value).toBe(false)
  })

  it('reads other files from the version the editor opened on', async () => {
    const editor = await mountEditor()

    await editor.selectFile('references/guide.md')

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/S1/files', {
      query: { path: 'references/guide.md', version: 3 },
    })
  })

  it('puts SKILL.md with the body changed and the frontmatter untouched', async () => {
    const editor = await mountEditor()

    editor.setSelectedValue('# Review\n\nRead the diff twice.\n')

    expect(editor.changes.value).toEqual([{
      op: 'put',
      path: 'SKILL.md',
      content: SKILL_MD.replace('the diff.', 'the diff twice.'),
    }])
    expect(editor.canSave.value).toBe(true)
  })

  it('rewrites the frontmatter when the name changes', async () => {
    const editor = await mountEditor()

    editor.setPart('name', 'review-code')

    const [change] = editor.changes.value

    expect(change).toMatchObject({ op: 'put', path: 'SKILL.md' })
    expect(change!.op === 'put' && change!.content)
      .toContain('name: review-code')
  })

  it('blocks Save with an invalid name until it is fixed', async () => {
    const editor = await mountEditor()

    editor.setPart('name', 'Bad Name')

    expect(editor.nameError.value).toContain('lowercase')
    expect(editor.canSave.value).toBe(false)

    editor.setPart('name', 'good-name')

    expect(editor.nameError.value).toBe('')
    expect(editor.canSave.value).toBe(true)
  })

  it('checks the name against the skills list on blur', async () => {
    libraryData.value = {
      skills: [{ id: 'S1', name: 'review-pr' }, { id: 'S2', name: 'taken' }],
    }

    const editor = await mountEditor()

    editor.setPart('name', 'taken')
    await editor.checkNameOnBlur()

    expect(editor.nameError.value).toContain('A skill named taken exists')
    expect(editor.canSave.value).toBe(false)

    editor.setPart('name', 'review-pr')
    await editor.checkNameOnBlur()

    expect(editor.nameError.value).toBe('')
  })

  it('refuses a reserved name while the command toggle is on', async () => {
    respond(createDetail({ slashCommand: true }))

    const editor = await mountEditor()

    editor.setPart('name', 'help')

    expect(editor.nameError.value).toContain('reserved')
  })

  it('requires a description', async () => {
    const editor = await mountEditor()

    editor.setPart('description', '')

    expect(editor.descriptionError.value).toContain('Add a description')
    expect(editor.canSave.value).toBe(false)
  })

  it('adds, renames and deletes files and sends them in order', async () => {
    const editor = await mountEditor()

    expect(editor.addFile('references/new.md')).toBe(true)
    editor.setSelectedValue('new text')
    await editor.selectFile('references/guide.md')
    expect(editor.renameSelected('references/manual.md')).toBe(true)

    expect(editor.changes.value).toEqual([
      { op: 'rename', from: 'references/guide.md', to: 'references/manual.md' },
      { op: 'put', path: 'references/new.md', content: 'new text' },
    ])

    editor.deleteSelected()

    expect(editor.changes.value).toEqual([
      { op: 'delete', path: 'references/guide.md' },
      { op: 'put', path: 'references/new.md', content: 'new text' },
    ])
    expect(editor.selectedFile.value?.path).toBe('SKILL.md')
  })

  it('drops a new file that is deleted before saving', async () => {
    const editor = await mountEditor()

    editor.addFile('scratch.md')
    editor.deleteSelected()

    expect(editor.changes.value).toEqual([])
  })

  it('refuses a path that exists or breaks the path rules', async () => {
    const editor = await mountEditor()

    expect(editor.addFile('references/GUIDE.md')).toBe(false)
    expect(editor.addFile('run.exe')).toBe(false)
    expect(editor.addFile('NOTICE.md')).toBe(false)
    expect(editor.changes.value).toEqual([])
  })

  it('does not rename or delete SKILL.md or a locked licence file', async () => {
    const editor = await mountEditor()

    expect(editor.canRenameSelected.value).toBe(false)
    expect(editor.canDeleteSelected.value).toBe(false)

    await editor.selectFile('LICENSE.txt')

    expect(editor.canRenameSelected.value).toBe(false)
    expect(editor.canDeleteSelected.value).toBe(false)
    expect(editor.selectedReadOnlyReason.value).toContain('licence file')

    editor.setSelectedValue('changed')

    expect(editor.changes.value).toEqual([])
  })

  it('opens a file over the editing cap read-only', async () => {
    respond(createDetail({
      licence: { class: 'authored', field: null, fileSha256: null, filesLocked: false },
      files: [
        { path: 'SKILL.md', bytes: 100, kind: 'skill-md', sha256: 'a', editable: true },
        { path: 'data/big.csv', bytes: 300 * 1024, kind: 'other', sha256: 'b', editable: false },
      ],
    }))
    FILE_TEXTS['data/big.csv'] = 'a,b\n'

    const editor = await mountEditor()

    await editor.selectFile('data/big.csv')

    expect(editor.selectedReadOnlyReason.value).toContain('open read-only')
    expect(editor.canRenameSelected.value).toBe(true)

    editor.setSelectedValue('changed')

    expect(editor.changes.value).toEqual([])
    delete FILE_TEXTS['data/big.csv']
  })

  it('saves with the base version and the trimmed note', async () => {
    mocks.fetch.mockImplementation(async (url: string, options?: {
      query?: { path?: string }
      method?: string
    }) => {
      if (options?.method === 'POST') {
        return { unchanged: false, id: 'S1', version: 4, renamed: false }
      }

      return url === '/api/v1/skills/S1'
        ? createDetail()
        : { text: FILE_TEXTS[options?.query?.path ?? ''] ?? '' }
    })

    const editor = await mountEditor()

    editor.setSelectedValue('changed')
    editor.note.value = '  Tightened  '

    const result = await editor.save()

    expect(result).toMatchObject({ isSaved: true, version: 4 })
    expect(saveCall()![1]).toEqual({
      method: 'POST',
      body: {
        baseVersion: 3,
        changes: [expect.objectContaining({ op: 'put', path: 'SKILL.md' })],
        note: 'Tightened',
      },
    })
    expect(mocks.refreshNuxtData).toHaveBeenCalled()
  })

  it('omits an empty note', async () => {
    mocks.fetch.mockImplementation(async (url: string, options?: {
      query?: { path?: string }
      method?: string
    }) => {
      if (options?.method === 'POST') {
        return { unchanged: false, id: 'S1', version: 4, renamed: false }
      }

      return url === '/api/v1/skills/S1'
        ? createDetail()
        : { text: FILE_TEXTS[options?.query?.path ?? ''] ?? '' }
    })

    const editor = await mountEditor()

    editor.setSelectedValue('changed')
    editor.note.value = '   '
    await editor.save()

    expect(saveCall()![1].body).not.toHaveProperty('note')
  })

  it('does not save when nothing changed', async () => {
    const editor = await mountEditor()

    expect(await editor.save()).toEqual({ isSaved: false })
    expect(saveCall()).toBeUndefined()
  })

  it('treats an unchanged result as a save', async () => {
    mocks.fetch.mockImplementation(async (url: string, options?: {
      query?: { path?: string }
      method?: string
    }) => {
      if (options?.method === 'POST') {
        return { unchanged: true, id: 'S1', version: 3 }
      }

      return url === '/api/v1/skills/S1'
        ? createDetail()
        : { text: FILE_TEXTS[options?.query?.path ?? ''] ?? '' }
    })

    const editor = await mountEditor()

    editor.setSelectedValue('changed')

    expect(await editor.save()).toMatchObject({
      isSaved: true,
      isUnchanged: true,
    })
  })

  describe('failed saves', () => {
    async function mountFailing(error: unknown) {
      mocks.fetch.mockImplementation(async (url: string, options?: {
        query?: { path?: string }
        method?: string
      }) => {
        if (options?.method === 'POST') {
          throw error
        }

        return url === '/api/v1/skills/S1'
          ? createDetail()
          : { text: FILE_TEXTS[options?.query?.path ?? ''] ?? '' }
      })

      const editor = await mountEditor()

      editor.setSelectedValue('changed')

      return editor
    }

    it('shows the stale base as a conflict and keeps the edits', async () => {
      const editor = await mountFailing({
        data: { code: 'stale-base', message: 'This skill changed since you opened it' },
      })

      expect(await editor.save()).toEqual({ isSaved: false })
      expect(editor.isConflict.value).toBe(true)
      expect(editor.saveError.value).toBeNull()
      expect(editor.isDirty.value).toBe(true)
      expect(editor.canSave.value).toBe(false)
    })

    it('puts a taken name on the Name field, not in the banner', async () => {
      const editor = await mountFailing({
        data: { code: 'name-taken', message: 'A skill named review-pr exists' },
      })

      await editor.save()

      expect(editor.isConflict.value).toBe(false)
      expect(editor.nameError.value).toBe('A skill named review-pr exists')
      expect(editor.canSave.value).toBe(false)
    })

    it('clears the server name error when the name is edited', async () => {
      const editor = await mountFailing({
        data: { code: 'name-taken', message: 'A skill named review-pr exists' },
      })

      await editor.save()
      editor.setPart('name', 'review-code')

      expect(editor.nameError.value).toBe('')
    })

    it('shows any other failure with its reason and fix', async () => {
      const editor = await mountFailing({
        data: {
          code: 'licence-restricted',
          message: 'This skill cannot be saved',
          why: 'The licence forbids copying',
          fix: 'Remove the licence file',
        },
      })

      await editor.save()

      expect(editor.saveError.value).toEqual({
        message: 'This skill cannot be saved',
        why: 'The licence forbids copying',
        fix: 'Remove the licence file',
      })
    })
  })

  it('compares the base version with the latest one after a conflict', async () => {
    const editor = await mountEditor()

    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === '/api/v1/skills/S1') {
        return createDetail({ currentVersion: 5 })
      }

      return {
        diff: { files: [], added: 1, removed: 0, truncated: false },
        skipped: [],
      }
    })
    await editor.compareWithLatest()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/skills/S1/versions/5/diff',
      { query: { against: 3 } },
    )
    expect(editor.conflictDiff.value?.diff.added).toBe(1)
  })

  it('explains a base version that is no longer kept', async () => {
    const editor = await mountEditor()

    mocks.fetch.mockImplementation(async (url: string) => {
      if (url === '/api/v1/skills/S1') {
        return createDetail({ currentVersion: 30 })
      }

      throw { data: { message: 'Version not found' }, statusCode: 404 }
    })
    await editor.compareWithLatest()

    expect(editor.conflictDiff.value).toBeNull()
    expect(editor.conflictDiffError.value).toBeTruthy()
  })

  describe('validation', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('finds a hidden character after the 300 ms debounce', async () => {
      const editor = await mountEditor()

      editor.setSelectedValue('# Review\n\nbad‮ line\n')

      expect(editor.problems.value).toEqual([])

      await vi.advanceTimersByTimeAsync(299)

      expect(editor.problems.value).toEqual([])

      await vi.advanceTimersByTimeAsync(2)

      expect(editor.problems.value).toEqual([
        expect.objectContaining({
          scope: 'body',
          line: 3,
          severity: 'warning',
          fix: 'remove-hidden-characters',
        }),
      ])
    })

    it('removes hidden characters with the quick fix', async () => {
      const editor = await mountEditor()

      editor.setSelectedValue('a‮b')
      await vi.advanceTimersByTimeAsync(400)
      editor.applyProblemFix(editor.problems.value[0]!)

      expect(editor.selectedValue.value).toBe('ab')
    })

    it('reports invalid advanced YAML as an error that blocks Save', async () => {
      const editor = await mountEditor()

      editor.setPart('advanced', 'license: [MIT')
      await vi.advanceTimersByTimeAsync(400)

      const error = editor.problems.value.find((problem) => {
        return problem.severity === 'error'
      })

      expect(error).toMatchObject({ scope: 'advanced' })
      expect(editor.skillMdIssue.value).toBeTruthy()
      expect(editor.canSave.value).toBe(false)
    })

    it('collects findings of the selected text for the Model view', async () => {
      const editor = await mountEditor()

      editor.setSelectedValue('See https://example.com\n')
      await vi.advanceTimersByTimeAsync(400)

      expect(editor.selectedScan.value.counts).toEqual({ url: 1 })
    })
  })

  it('estimates the catalog and the body tokens', async () => {
    const editor = await mountEditor()

    expect(editor.catalogLine.value)
      .toBe('- review-pr: Review a pull request')
    expect(editor.catalogTokens.value).toBeGreaterThan(0)
    expect(editor.bodyTokens.value).toBeGreaterThan(0)
  })

  it('reloads and drops the draft', async () => {
    const editor = await mountEditor()

    editor.setSelectedValue('changed')
    editor.isConflict.value = true
    await editor.load()

    expect(editor.isDirty.value).toBe(false)
    expect(editor.isConflict.value).toBe(false)
  })
})

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import EditDialog from '../../../../../app/components/Profile/Skills/EditDialog.client.vue'
import { createSkillDetail } from '../../../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  refreshNuxtData: vi.fn(),
  successMessage: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('refreshNuxtData', () => mocks.refreshNuxtData)
mockNuxtImport('useSuccessMessage', () => mocks.successMessage)
mockNuxtImport('useNuxtData', () => {
  return () => ({ data: ref(undefined) })
})

enableAutoUnmount(afterEach)

const SKILL_MD = [
  '---',
  'name: review-pr',
  'description: Review a pull request',
  '---',
  '# Review',
  '',
].join('\n')

const TEXTS: Record<string, string> = {
  'SKILL.md': SKILL_MD,
  'references/guide.md': '# Guide\n',
  'LICENSE.txt': 'MIT\n',
}

function detail(overrides = {}) {
  return createSkillDetail({
    id: 'S1',
    name: 'review-pr',
    currentVersion: 3,
    licence: {
      class: 'open',
      field: 'MIT',
      fileSha256: 'a'.repeat(64),
      filesLocked: true,
    },
    files: [
      { path: 'SKILL.md', bytes: 60, kind: 'skill-md', sha256: 'a', editable: true },
      { path: 'references/guide.md', bytes: 8, kind: 'reference', sha256: 'b', editable: true },
      { path: 'LICENSE.txt', bytes: 4, kind: 'licence', sha256: 'c', editable: false },
    ],
    ...overrides,
  })
}

function find(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`)
}

function get(id: string): HTMLElement {
  const element = find(id)

  if (!element) {
    throw new Error(`Missing ${id}`)
  }

  return element
}

async function setValue(id: string, value: string) {
  const input = get(id) as HTMLInputElement | HTMLTextAreaElement

  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

async function click(id: string) {
  get(id).click()
  await flushPromises()
}

function postCall() {
  return mocks.fetch.mock.calls.find((call) => {
    return call[0] === '/api/v1/skills/S1/versions'
  })
}

async function mountDialog() {
  const wrapper = await mountSuspended(EditDialog, {
    props: { skillId: 'S1' },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })

  await flushPromises()

  return wrapper
}

describe('Profile/Skills/EditDialog', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
    document.body.innerHTML = ''
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.refreshNuxtData.mockReset()
    mocks.successMessage.mockReset()
    mocks.fetch.mockImplementation(async (url: string, options?: {
      method?: string
      query?: { path?: string }
    }) => {
      if (options?.method === 'POST') {
        return { unchanged: false, id: 'S1', version: 4, renamed: false }
      }

      if (url === '/api/v1/skills/S1') {
        return detail()
      }

      return { text: TEXTS[options?.query?.path ?? ''] ?? '' }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens in edit mode with the name, version and fields of the skill', async () => {
    await mountDialog()

    expect(get('skills-dialog-title').textContent)
      .toContain('Edit review-pr · v3')
    expect(get('skills-dialog-box').className).toContain('max-w-5xl')
    expect((get('skill-edit-name') as HTMLInputElement).value)
      .toBe('review-pr')
    expect((get('skill-edit-description') as HTMLTextAreaElement).value)
      .toBe('Review a pull request')
    expect((get('skill-editor-textarea') as HTMLTextAreaElement).value)
      .toBe('# Review\n')
    expect((get('skill-edit-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a skeleton while loading', async () => {
    mocks.fetch.mockReturnValue(new Promise(() => {}))

    await mountSuspended(EditDialog, {
      props: { skillId: 'S1' },
      attachTo: document.body,
      global: { stubs: { teleport: false } },
    })

    expect(find('skill-edit-loading')).not.toBeNull()
  })

  it('shows a load error with Retry', async () => {
    mocks.fetch.mockRejectedValue({ data: { message: 'Skill not found' } })
    await mountDialog()

    expect(get('skill-edit-load-error').textContent).toContain('Skill not found')
  })

  it('enables Save after an edit and posts the changes', async () => {
    const wrapper = await mountDialog()

    await setValue('skill-editor-textarea', '# Review\n\nMore.\n')
    await setValue('skill-edit-note', 'Added more')

    expect((get('skill-edit-save') as HTMLButtonElement).disabled).toBe(false)
    expect(get('skill-edit-dirty').textContent).toContain('Unsaved changes')

    await click('skill-edit-save')

    expect(postCall()![1]).toEqual({
      method: 'POST',
      body: {
        baseVersion: 3,
        changes: [{
          op: 'put',
          path: 'SKILL.md',
          content: SKILL_MD.replace('# Review\n', '# Review\n\nMore.\n'),
        }],
        note: 'Added more',
      },
    })
    expect(mocks.successMessage).toHaveBeenCalledWith('Saved v4')
    expect(wrapper.emitted('saved')).toEqual([[{
      id: 'S1',
      version: 4,
      isRenamed: false,
    }]])
    expect(wrapper.emitted('close')).toBeTruthy()
    expect(mocks.confirm).not.toHaveBeenCalled()
  })

  it('asks before Cancel discards unsaved changes', async () => {
    mocks.confirm.mockResolvedValue(false)

    const wrapper = await mountDialog()

    await setValue('skill-editor-textarea', 'changed')
    await click('skill-edit-cancel')

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Discard your unsaved changes?',
    }))
    expect(wrapper.emitted('close')).toBeUndefined()

    mocks.confirm.mockResolvedValue(true)
    await click('skill-edit-cancel')

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('cancels without a question when nothing changed', async () => {
    const wrapper = await mountDialog()

    await click('skill-edit-cancel')

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('shows the name error and keeps Save off', async () => {
    await mountDialog()
    await setValue('skill-edit-name', 'Bad Name')

    expect(get('skill-edit-name-help').textContent).toContain('lowercase')
    expect((get('skill-edit-save') as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows the 409 as a banner with Reload and Compare, not as a field error', async () => {
    const wrapper = await mountDialog()

    await setValue('skill-editor-textarea', 'changed')
    mocks.fetch.mockRejectedValueOnce({
      data: {
        code: 'stale-base',
        message: 'This skill changed since you opened it',
      },
    })
    await click('skill-edit-save')

    expect(get('skill-edit-conflict').textContent)
      .toContain('This skill changed since you opened it')
    expect(find('skill-edit-save-error')).toBeNull()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(find('skill-edit-conflict-compare')).not.toBeNull()
    expect(find('skill-edit-conflict-reload')).not.toBeNull()
  })

  it('compares with the latest version after a conflict', async () => {
    await mountDialog()
    await setValue('skill-editor-textarea', 'changed')
    mocks.fetch.mockRejectedValueOnce({ data: { code: 'stale-base' } })
    await click('skill-edit-save')

    mocks.fetch.mockImplementation(async (url: string) => {
      return url === '/api/v1/skills/S1'
        ? detail({ currentVersion: 5 })
        : {
          diff: { files: [], added: 0, removed: 0, truncated: false },
          skipped: [],
        }
    })
    await click('skill-edit-conflict-compare')

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/skills/S1/versions/5/diff',
      { query: { against: 3 } },
    )
    expect(find('skill-edit-conflict-diff')).not.toBeNull()
  })

  it('reloads the latest version after confirming the loss of edits', async () => {
    await mountDialog()
    await setValue('skill-editor-textarea', 'changed')
    mocks.fetch.mockRejectedValueOnce({ data: { code: 'stale-base' } })
    await click('skill-edit-save')

    mocks.confirm.mockResolvedValueOnce(false)
    await click('skill-edit-conflict-reload')

    expect(find('skill-edit-conflict')).not.toBeNull()

    mocks.confirm.mockResolvedValueOnce(true)
    await click('skill-edit-conflict-reload')

    expect(find('skill-edit-conflict')).toBeNull()
    expect((get('skill-editor-textarea') as HTMLTextAreaElement).value)
      .toBe('# Review\n')
  })

  it('puts a taken name on the Name field and keeps the dialog open', async () => {
    const wrapper = await mountDialog()

    await setValue('skill-edit-name', 'meeting-recap')
    mocks.fetch.mockRejectedValueOnce({
      data: {
        code: 'name-taken',
        message: 'A skill named meeting-recap exists',
      },
    })
    await click('skill-edit-save')

    expect(get('skill-edit-name-help').textContent)
      .toContain('A skill named meeting-recap exists')
    expect(find('skill-edit-conflict')).toBeNull()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('shows any other save failure with its reason', async () => {
    await mountDialog()
    await setValue('skill-editor-textarea', 'changed')
    mocks.fetch.mockRejectedValueOnce({
      data: {
        code: 'licence-restricted',
        message: 'This skill cannot be saved',
        why: 'The licence forbids copying',
      },
    })
    await click('skill-edit-save')

    expect(get('skill-edit-save-error').textContent)
      .toContain('The licence forbids copying')
  })

  it('opens another file, edits it and saves it with SKILL.md untouched', async () => {
    await mountDialog()

    const items = document.body.querySelectorAll(
      '[data-testid="skill-file-tree-item"]',
    )
    const guide = [...items].find(item => item.textContent?.includes('guide.md'))

    ;(guide as HTMLElement).click()
    await flushPromises()

    expect(find('skill-edit-name')).toBeNull()
    expect((get('skill-editor-textarea') as HTMLTextAreaElement).value)
      .toBe('# Guide\n')

    await setValue('skill-editor-textarea', '# Guide\n\nMore.\n')
    await click('skill-edit-save')

    expect(postCall()![1].body.changes).toEqual([{
      op: 'put',
      path: 'references/guide.md',
      content: '# Guide\n\nMore.\n',
    }])
  })

  it('opens a locked licence file read-only', async () => {
    await mountDialog()

    const items = document.body.querySelectorAll(
      '[data-testid="skill-file-tree-item"]',
    )
    const licence = [...items].find((item) => {
      return item.textContent?.includes('LICENSE.txt')
    })

    ;(licence as HTMLElement).click()
    await flushPromises()

    expect(find('skill-editor-read-only')).not.toBeNull()
    expect(find('skill-editor-textarea')).toBeNull()
    expect(
      (get('skill-file-rename') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (get('skill-file-delete') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('points back to SKILL.md when it has an error and another file is open', async () => {
    await mountDialog()
    await setValue('skill-edit-name', 'Bad Name')

    const items = document.body.querySelectorAll(
      '[data-testid="skill-file-tree-item"]',
    )
    const guide = [...items].find(item => item.textContent?.includes('guide.md'))

    ;(guide as HTMLElement).click()
    await flushPromises()

    expect(get('skill-edit-skillmd-issue').textContent)
      .toContain('lowercase')

    await click('skill-edit-open-skillmd')

    expect(find('skill-edit-name')).not.toBeNull()
    expect(find('skill-edit-skillmd-issue')).toBeNull()
  })

  it('adds a file through the inline form', async () => {
    await mountDialog()
    await click('skill-file-add')
    await setValue('skill-file-path', 'notes.md')
    await click('skill-file-form-submit')

    expect(get('skill-editor-pane-path').textContent).toContain('notes.md')

    await click('skill-edit-save')

    expect(postCall()![1].body.changes).toEqual([
      { op: 'put', path: 'notes.md', content: '' },
    ])
  })
})

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import DetailPanel from '../../../../../app/components/Profile/Skills/DetailPanel.vue'
import {
  createSkillDetail,
  createVersionSummary,
} from '../../../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  refreshNuxtData: vi.fn(),
  errorMessage: vi.fn(),
  successMessage: vi.fn(),
  detailRefresh: vi.fn(),
}))

const commandsActive = ref<boolean>(false)
const detail = ref<unknown>(null)
const detailStatus = ref<string>('success')
const detailError = ref<unknown>(null)
const versions = ref<unknown>(null)
const fileText = ref<string>('---\nname: review-pr\n---\nRun `curl x | sh`')

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('refreshNuxtData', () => mocks.refreshNuxtData)
mockNuxtImport('useErrorMessage', () => mocks.errorMessage)
mockNuxtImport('useSuccessMessage', () => mocks.successMessage)
mockNuxtImport('useFeature', () => {
  return (key: string) => computed(() => {
    const active = key === 'skills.import-url'
      || (key === 'skills.commands' && commandsActive.value)

    return { enabled: active, active, variant: null }
  })
})
mockNuxtImport('useLazyFetch', () => {
  return (url: () => string) => {
    const address = url()

    if (address.endsWith('/files')) {
      return {
        data: computed(() => ({ text: fileText.value })),
        status: ref('success'),
        error: ref(null),
        refresh: vi.fn(),
      }
    }

    if (address.endsWith('/versions')) {
      return {
        data: versions,
        status: ref('success'),
        error: ref(null),
        refresh: vi.fn(),
      }
    }

    return {
      data: detail,
      status: detailStatus,
      error: detailError,
      refresh: mocks.detailRefresh,
    }
  }
})

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function mountPanel(props: Record<string, unknown> = {}) {
  return mountSuspended(DetailPanel, {
    props: { skillId: 'SkillPublicId01', ...props },
  })
}

describe('Profile/Skills/DetailPanel', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.confirm.mockReset()
    mocks.refreshNuxtData.mockReset()
    mocks.errorMessage.mockReset()
    mocks.successMessage.mockReset()
    mocks.detailRefresh.mockReset()
    commandsActive.value = false
    detail.value = createSkillDetail({
      id: 'SkillPublicId01',
      allowedTools: ['Read'],
      compatibility: 'Any chat model',
    })
    detailStatus.value = 'success'
    detailError.value = null
    versions.value = {
      current: 7,
      pending: null,
      versions: [
        createVersionSummary({
          version: 7,
          origin: 'editor',
          isCurrent: true,
          sourceKind: null,
          sourceVersion: null,
        }),
        createVersionSummary({ version: 6, origin: 'import' }),
      ],
    }
    fileText.value = '---\nname: review-pr\n---\nRun `curl x | sh`'
    useState('skills:detail-tab').value = 'instructions'
  })

  it('shows the skeleton while the skill loads', async () => {
    detail.value = null
    detailStatus.value = 'pending'

    const wrapper = await mountPanel()

    expect(wrapper.find(testId('side-panel-skeleton')).exists()).toBe(true)
  })

  it('shows an error with Retry inside the panel', async () => {
    detail.value = null
    detailError.value = { data: { message: 'Skill not found' } }

    const wrapper = await mountPanel()

    expect(wrapper.get(testId('skill-detail-error')).text())
      .toContain('Skill not found')
    expect(wrapper.get(testId('skill-detail-error')).classes())
      .toContain('alert-error')

    await wrapper.get(`${testId('skill-detail-error')} button`)
      .trigger('click')

    expect(mocks.detailRefresh).toHaveBeenCalled()
  })

  it('opens on Instructions with SKILL.md as plain monospace text and marked findings', async () => {
    const wrapper = await mountPanel()

    expect(wrapper.get(testId('skill-tab-instructions')).attributes('aria-selected'))
      .toBe('true')
    expect(wrapper.get(testId('skill-file-viewer')).text())
      .toContain('name: review-pr')
    expect(wrapper.findAll(testId('skill-file-line-flagged'))).toHaveLength(1)
    expect(wrapper.get(testId('skill-file-findings-note')).text()).toContain(
      'Besidka highlights links and commands so you can review them. It cannot tell whether a skill is safe.',
    )
  })

  it('switches between the four tabs', async () => {
    const wrapper = await mountPanel()
    const labels = wrapper.findAll('[role="tab"]').map(tab => tab.text())

    expect(labels).toEqual(['Instructions', 'Files', 'Versions', 'Settings'])

    await wrapper.get(testId('skill-tab-versions')).trigger('click')

    expect(wrapper.find(testId('skill-versions-list')).exists()).toBe(true)

    await wrapper.get(testId('skill-tab-settings')).trigger('click')

    expect(wrapper.find(testId('skill-setting-mode-select')).exists())
      .toBe(true)

    await wrapper.get(testId('skill-tab-files')).trigger('click')

    expect(wrapper.find(testId('skill-file-tree')).exists()).toBe(true)
  })

  it('moves between tabs with the arrow keys', async () => {
    const wrapper = await mountPanel()

    await wrapper.get(testId('skill-tab-instructions'))
      .trigger('keydown', { key: 'ArrowRight' })

    expect(wrapper.get(testId('skill-tab-files')).attributes('aria-selected'))
      .toBe('true')
  })

  it('explains a broken skill', async () => {
    detail.value = createSkillDetail({ status: 'broken' })

    const wrapper = await mountPanel()

    expect(wrapper.get(testId('skill-detail-broken')).text())
      .toBe('Files are missing. Restore an earlier version or delete it.')
  })

  it('offers the pending update review and reports it to the caller', async () => {
    detail.value = createSkillDetail({ pendingVersion: 8 })

    const onReviewUpdate = vi.fn()
    const wrapper = await mountPanel({ onReviewUpdate })

    await wrapper.get(testId('skill-detail-review-update')).trigger('click')

    expect(onReviewUpdate).toHaveBeenCalledWith('SkillPublicId01')
  })

  it('lists versions with their origin and offers compare and restore', async () => {
    useState('skills:detail-tab').value = 'versions'

    const wrapper = await mountPanel()
    const older = wrapper.get(testId('skill-version-6'))

    expect(wrapper.get(testId('skill-version-7')).text())
      .toContain('Edited in Besidka')
    expect(wrapper.get(testId('skill-version-7')).text()).toContain('Current')
    expect(older.text()).toContain('Imported @abcdef1')
    expect(older.text()).toContain('Compare with current')
    expect(older.text()).toContain('Restore')
    expect(wrapper.get(testId('skill-version-7')).text())
      .not.toContain('Restore')
  })

  it('compares an older version with the current one', async () => {
    useState('skills:detail-tab').value = 'versions'
    mocks.fetch.mockResolvedValue({
      from: createVersionSummary({ version: 7 }),
      to: createVersionSummary({ version: 6 }),
      diff: {
        files: [{
          path: 'SKILL.md',
          status: 'modified',
          added: 1,
          removed: 0,
          truncated: false,
          lines: [{ kind: 'add', text: 'new' }],
        }],
        added: 1,
        removed: 0,
        unchanged: 0,
        truncated: false,
      },
      skipped: [],
      licence: { changed: false, before: { class: 'open', fileSha256: null }, after: { class: 'open', fileSha256: null } },
    })

    const wrapper = await mountPanel()

    await wrapper.get(`${testId('skill-version-6')} ${testId('skill-version-compare')}`)
      .trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/skills/SkillPublicId01/versions/6/diff',
    )
    expect(wrapper.get(testId('skill-version-diff')).text())
      .toContain('Restoring v6 would change')
  })

  it('restores only after a confirmation and creates a new version', async () => {
    useState('skills:detail-tab').value = 'versions'
    mocks.confirm.mockResolvedValueOnce(null)

    const wrapper = await mountPanel()
    const restore = wrapper.get(
      `${testId('skill-version-6')} ${testId('skill-version-restore')}`,
    )

    await restore.trigger('click')
    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()

    mocks.confirm.mockResolvedValueOnce({ label: 'Restore', index: 0 })
    mocks.fetch.mockResolvedValue({ unchanged: false, id: 'SkillPublicId01' })
    await restore.trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/skills/SkillPublicId01/versions/6/restore',
      { method: 'POST', body: {} },
    )
  })

  it('saves the mode through PATCH as one request', async () => {
    useState('skills:detail-tab').value = 'settings'
    mocks.fetch.mockResolvedValue({})

    const wrapper = await mountPanel()
    const select = wrapper.get(testId('skill-setting-mode-select'))
      .element as HTMLSelectElement

    select.value = 'ask'
    select.dispatchEvent(new Event('change'))
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/SkillPublicId01', {
      method: 'PATCH',
      body: { mode: 'ask' },
    })
  })

  it('shows no command form while the commands feature is off', async () => {
    useState('skills:detail-tab').value = 'settings'
    detail.value = createSkillDetail({
      command: 'run-it',
      slashCommand: true,
    })

    const wrapper = await mountPanel()

    expect(wrapper.find(testId('skill-setting-command-form')).exists())
      .toBe(false)
    expect(wrapper.find(testId('skill-setting-command')).exists()).toBe(false)
    expect(wrapper.find(testId('skill-setting-argument-hint')).exists())
      .toBe(false)
    expect(wrapper.find(testId('skill-detail-command')).exists()).toBe(false)
  })

  it('shows the command badge in the header when the feature is on', async () => {
    commandsActive.value = true
    detail.value = createSkillDetail({
      command: 'run-it',
      slashCommand: true,
    })

    const wrapper = await mountPanel()
    const badge = wrapper.get(testId('skill-detail-command'))

    expect(badge.text()).toBe('/run-it')
    expect(badge.classes()).toEqual(
      expect.arrayContaining(['badge', 'badge-soft']),
    )
    expect(wrapper.find(testId('skill-detail-kind')).exists()).toBe(false)
  })

  it('shows no command badge for a skill without a command', async () => {
    commandsActive.value = true

    const wrapper = await mountPanel()

    expect(wrapper.find(testId('skill-detail-command')).exists()).toBe(false)
  })

  it('shows the command input but no hint field for a skill without a command', async () => {
    commandsActive.value = true
    useState('skills:detail-tab').value = 'settings'

    const wrapper = await mountPanel()

    expect((wrapper.get(testId('skill-setting-command')).element as HTMLInputElement).value)
      .toBe('')
    expect(wrapper.find(testId('skill-setting-argument-hint')).exists())
      .toBe(false)
    expect(wrapper.get(testId('skill-setting-command-save'))
      .attributes('disabled')).toBeDefined()
  })

  it('shows the argument hint field once a command is typed and saves both trimmed', async () => {
    commandsActive.value = true
    useState('skills:detail-tab').value = 'settings'
    mocks.fetch.mockResolvedValue({})

    const wrapper = await mountPanel()

    await wrapper.get(testId('skill-setting-command')).setValue(' /summarise ')

    const input = wrapper.get(testId('skill-setting-argument-hint'))

    await input.setValue('  What to summarise  ')
    await wrapper.get(testId('skill-setting-command-form'))
      .trigger('submit')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/SkillPublicId01', {
      method: 'PATCH',
      body: { command: 'summarise', argumentHint: 'What to summarise' },
    })
  })

  it('prefills the saved command and clears it with null', async () => {
    commandsActive.value = true
    useState('skills:detail-tab').value = 'settings'
    detail.value = createSkillDetail({
      command: 'run-it',
      slashCommand: true,
      argumentHint: 'A link',
    })
    mocks.fetch.mockResolvedValue({})

    const wrapper = await mountPanel()
    const input = wrapper.get(testId('skill-setting-command'))
      .element as HTMLInputElement

    expect(input.value).toBe('run-it')
    expect((wrapper.get(testId('skill-setting-argument-hint')).element as HTMLInputElement).value)
      .toBe('A link')

    await wrapper.get(testId('skill-setting-command')).setValue('')

    expect(wrapper.find(testId('skill-setting-argument-hint')).exists())
      .toBe(false)

    await wrapper.get(testId('skill-setting-command-form'))
      .trigger('submit')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/SkillPublicId01', {
      method: 'PATCH',
      body: { command: null, argumentHint: null },
    })
  })

  it('shows a reserved command as a problem and disables Save', async () => {
    commandsActive.value = true
    useState('skills:detail-tab').value = 'settings'

    const wrapper = await mountPanel()

    await wrapper.get(testId('skill-setting-command')).setValue('/memory')

    expect(wrapper.get(testId('skill-setting-command-help')).text())
      .toContain('/memory is reserved by Besidka')
    expect(wrapper.get(testId('skill-setting-command-save'))
      .attributes('disabled')).toBeDefined()
  })

  it('shows the server reason next to the command field when the save fails', async () => {
    commandsActive.value = true
    useState('skills:detail-tab').value = 'settings'
    mocks.fetch.mockRejectedValue({
      data: { message: '/run-it is already a command' },
    })

    const wrapper = await mountPanel()

    await wrapper.get(testId('skill-setting-command')).setValue('run-it')
    await wrapper.get(testId('skill-setting-command-form'))
      .trigger('submit')
    await flushPromises()

    expect(wrapper.get(testId('skill-setting-command-help')).text())
      .toContain('/run-it is already a command')
    expect(wrapper.get(testId('skill-setting-command-help')).attributes('role'))
      .toBe('alert')
    expect(mocks.errorMessage).not.toHaveBeenCalled()

    await wrapper.get(testId('skill-setting-command')).setValue('run-it-2')

    expect(wrapper.get(testId('skill-setting-command-help')).text())
      .not.toContain('already a command')
  })

  it('has no separate invocation toggles, only the mode control', async () => {
    useState('skills:detail-tab').value = 'settings'

    const wrapper = await mountPanel()

    expect(wrapper.find(testId('skill-setting-model-invocable')).exists())
      .toBe(false)
    expect(wrapper.find(testId('skill-setting-slash-command')).exists())
      .toBe(false)
    expect(wrapper.get(testId('skill-setting-mode-select'))
      .attributes('disabled')).toBeUndefined()
    expect(wrapper.get(testId('skill-setting-mode-description')).text())
      .toContain('The model uses it when the description matches')
  })

  it('never says to rename a skill with a reserved name', async () => {
    useState('skills:detail-tab').value = 'settings'
    detail.value = createSkillDetail({
      name: 'memory',
      enabled: true,
    })

    const wrapper = await mountPanel()

    expect(wrapper.find(testId('skill-setting-slash-blocked')).exists())
      .toBe(false)
    expect(wrapper.text()).not.toContain('Rename to use')
  })

  it('shows licence, source and requested tools as not granted', async () => {
    useState('skills:detail-tab').value = 'settings'

    const wrapper = await mountPanel()

    expect(wrapper.get(testId('skill-setting-licence')).text())
      .toBe('Written by you')
    expect(wrapper.text()).toContain('requested by the author, not granted')
  })

  it('offers Check for updates only for GitHub skills and the download link always', async () => {
    useState('skills:detail-tab').value = 'settings'

    const plain = await mountPanel()

    expect(plain.find(testId('skill-setting-check-updates')).exists())
      .toBe(false)
    expect(plain.get(testId('skill-setting-download')).attributes('href'))
      .toBe('/api/v1/skills/SkillPublicId01/download')

    detail.value = createSkillDetail({ sourceKind: 'github' })

    const github = await mountPanel()

    expect(github.find(testId('skill-setting-check-updates')).exists())
      .toBe(true)
  })

  it('deletes after a confirmation and tells the caller', async () => {
    useState('skills:detail-tab').value = 'settings'
    mocks.confirm.mockResolvedValue({ label: 'Delete', index: 0 })
    mocks.fetch.mockResolvedValue({ deleted: true })

    const onDeleted = vi.fn()
    const wrapper = await mountPanel({ onDeleted })

    await wrapper.get(testId('skill-setting-delete')).trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/SkillPublicId01', {
      method: 'DELETE',
    })
    expect(onDeleted).toHaveBeenCalledWith('SkillPublicId01')
  })
})

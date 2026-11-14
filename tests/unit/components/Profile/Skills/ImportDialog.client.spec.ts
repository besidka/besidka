import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImportDialog from '../../../../../app/components/Profile/Skills/ImportDialog.client.vue'
import { createImportPreview } from '../../../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  inspect: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useSkillArchiveInspector', () => {
  return () => ({ inspect: mocks.inspect })
})

enableAutoUnmount(afterEach)

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

async function click(id: string) {
  get(id).click()
  await flushPromises()
}

async function check(id: string) {
  const input = get(id) as HTMLInputElement

  input.checked = true
  input.dispatchEvent(new Event('change'))
  await flushPromises()
}

async function setValue(id: string, value: string) {
  const input = get(id) as HTMLInputElement | HTMLTextAreaElement

  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mountSuspended(ImportDialog, {
    props: { initialTab: 'paste', ...props },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })
}

async function reachReview(preview = createImportPreview()) {
  mocks.fetch.mockResolvedValueOnce(preview)
  await setValue('skill-import-text', '---\nname: review-pr\n---\nBody')
  await click('skill-import-submit')
}

describe('Profile/Skills/ImportDialog', () => {
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
    mocks.fetch.mockReset()
    mocks.inspect.mockReset()
    mocks.inspect.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens as a bottom sheet that centres from sm, with the import hook class', async () => {
    await mountDialog()

    const dialog = document.body.querySelector('dialog.js-skill-import-modal')

    expect(dialog).not.toBeNull()
    expect(dialog!.classList.contains('modal-bottom')).toBe(true)
    expect(dialog!.classList.contains('sm:modal-middle')).toBe(true)
  })

  it('offers Upload and Paste, and GitHub only with the import flag', async () => {
    await mountDialog()

    expect(find('skill-import-tab-upload')).not.toBeNull()
    expect(find('skill-import-tab-paste')).not.toBeNull()
    expect(find('skill-import-tab-github')).toBeNull()

    document.body.innerHTML = ''
    await mountDialog({ canImportFromUrl: true, initialTab: 'github' })

    expect(find('skill-import-tab-github')).not.toBeNull()
    expect(find('skill-import-url')).not.toBeNull()
  })

  it('moves between the tabs with the arrow keys', async () => {
    await mountDialog({ canImportFromUrl: true, initialTab: 'upload' })

    const key = (name: string, id: string) => {
      get(id).dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true }),
      )

      return flushPromises()
    }

    await key('ArrowRight', 'skill-import-tab-upload')

    expect(get('skill-import-tab-paste').getAttribute('aria-selected'))
      .toBe('true')
    expect(find('skill-import-text')).not.toBeNull()

    await key('ArrowRight', 'skill-import-tab-paste')
    await key('ArrowRight', 'skill-import-tab-github')

    expect(get('skill-import-tab-upload').getAttribute('aria-selected'))
      .toBe('true')

    await key('ArrowLeft', 'skill-import-tab-upload')

    expect(get('skill-import-tab-github').getAttribute('aria-selected'))
      .toBe('true')
  })

  it('falls back to Upload when GitHub is asked for without the flag', async () => {
    await mountDialog({ initialTab: 'github' })

    expect(find('skill-import-url')).toBeNull()
    expect(find('skill-import-file')).not.toBeNull()
  })

  it('keeps Review disabled until there is something to review', async () => {
    await mountDialog()

    expect((get('skill-import-submit') as HTMLButtonElement).disabled)
      .toBe(true)

    await setValue('skill-import-text', 'text')

    expect((get('skill-import-submit') as HTMLButtonElement).disabled)
      .toBe(false)
  })

  it('posts pasted text and shows the review screen', async () => {
    await mountDialog()
    await reachReview()

    expect(mocks.fetch).toHaveBeenCalledWith('/api/v1/skills/import/text', {
      method: 'POST',
      body: { text: '---\nname: review-pr\n---\nBody' },
    })
    expect(find('skill-review')).not.toBeNull()
    expect(get('skills-dialog-title').textContent).toContain('Review review-pr')
  })

  it('makes install impossible without ticking I reviewed this skill', async () => {
    await mountDialog()
    await reachReview()

    const install = get('skill-import-install') as HTMLButtonElement

    expect(install.disabled).toBe(true)
    expect(install.textContent?.trim()).toBe('Install')
    expect(get('skill-import-install-note').textContent?.trim())
      .toBe('Installs switched off. Turn it on from the skill\'s mode.')

    install.click()
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledTimes(1)

    await check('skill-import-reviewed')

    expect(install.disabled).toBe(false)
  })

  it('needs the extra license tick when no license is stated', async () => {
    await mountDialog()
    await reachReview(createImportPreview({
      requiresLicenseAcknowledgement: true,
      license: {
        class: 'none',
        text: 'No license stated.',
        matched: [],
        file: null,
        spdx: null,
        licenseText: null,
        licenseField: null,
      },
    }))

    const install = get('skill-import-install') as HTMLButtonElement

    await check('skill-import-reviewed')

    expect(install.disabled).toBe(true)
    expect(get('skill-import-license').parentElement!.textContent)
      .toContain('I have the right to use this skill')

    await check('skill-import-license')

    expect(install.disabled).toBe(false)
  })

  it('commits with the license acknowledgement and reports what was installed', async () => {
    const wrapper = await mountDialog()

    await reachReview(createImportPreview({
      requiresLicenseAcknowledgement: true,
    }))
    await check('skill-import-reviewed')
    await check('skill-import-license')
    mocks.fetch.mockResolvedValueOnce({
      kind: 'created',
      id: 'NewSkillId',
      name: 'review-pr',
      version: 1,
      licenseClass: 'none',
      filesCount: 2,
    })
    await click('skill-import-install')

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/skills/import/commit',
      {
        method: 'POST',
        body: {
          stageId: 'a'.repeat(32),
          acknowledged: true,
          licenseAcknowledged: true,
        },
      },
    )
    expect(wrapper.emitted('installed')?.[0]).toEqual([{
      kind: 'created',
      id: 'NewSkillId',
      name: 'review-pr',
    }])
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('offers Replace as an update and a new name after a name collision', async () => {
    const wrapper = await mountDialog()

    await reachReview()
    await check('skill-import-reviewed')
    mocks.fetch.mockRejectedValueOnce({
      data: {
        message: 'A skill named review-pr exists',
        code: 'name-taken',
        data: { stageId: 'a'.repeat(32), asUpdateOf: 'ExistingId', name: 'review-pr' },
      },
    })
    await click('skill-import-install')

    expect(find('skill-import-collision')).not.toBeNull()

    mocks.fetch.mockResolvedValueOnce({
      kind: 'pending',
      id: 'ExistingId',
      name: 'review-pr',
      version: 2,
      pendingVersion: 2,
      licenseClass: 'open',
      filesCount: 2,
    })
    await click('skill-import-replace')

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/skills/import/commit',
      {
        method: 'POST',
        body: {
          stageId: 'a'.repeat(32),
          acknowledged: true,
          asUpdateOf: 'ExistingId',
        },
      },
    )
    expect(wrapper.emitted('installed')?.[0]?.[0]).toMatchObject({
      kind: 'pending',
      id: 'ExistingId',
    })
  })

  it('imports under a new name after a name collision', async () => {
    await mountDialog()
    await reachReview()
    await check('skill-import-reviewed')
    mocks.fetch.mockRejectedValueOnce({
      data: {
        code: 'name-taken',
        data: { stageId: 'a'.repeat(32), asUpdateOf: 'ExistingId', name: 'review-pr' },
      },
    })
    await click('skill-import-install')
    await setValue('skill-import-rename', 'review-pr-two')
    mocks.fetch.mockResolvedValueOnce({
      kind: 'created',
      id: 'Another',
      name: 'review-pr-two',
      version: 1,
      licenseClass: 'open',
      filesCount: 2,
    })
    await click('skill-import-rename-submit')

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/skills/import/commit',
      {
        method: 'POST',
        body: {
          stageId: 'a'.repeat(32),
          acknowledged: true,
          name: 'review-pr-two',
        },
      },
    )
  })

  it('goes back to the first step when the staged import has expired', async () => {
    await mountDialog()
    await reachReview()
    await check('skill-import-reviewed')
    mocks.fetch.mockRejectedValueOnce({
      data: { code: 'stage-not-found', message: 'This import has expired' },
    })
    await click('skill-import-install')

    expect(find('skill-review')).toBeNull()
    expect(get('skill-import-error').textContent)
      .toContain('This import has expired.')
  })

  it('shows a server refusal on the first step', async () => {
    await mountDialog()
    mocks.fetch.mockRejectedValueOnce({
      data: { message: 'Its license limits use', fix: 'Pick another skill' },
    })
    await setValue('skill-import-text', 'text')
    await click('skill-import-submit')

    expect(get('skill-import-error').textContent)
      .toContain('Its license limits use')
    expect(get('skill-import-error').textContent)
      .toContain('Pick another skill')
  })

  it('shows the reason first and the fix second for a rejected skill', async () => {
    await mountDialog()
    mocks.fetch.mockRejectedValueOnce({
      data: {
        code: 'name-invalid',
        message: 'The skill name is not valid',
        why: 'The name "Bad Name" has capital letters and a space',
        fix: 'Use lowercase letters, digits and single hyphens',
      },
    })
    await setValue('skill-import-text', 'text')
    await click('skill-import-submit')

    const hints = Array.from(document.body.querySelectorAll(
      '[data-testid="skill-import-error-hint"]',
    )).map(hint => hint.textContent)

    expect(hints).toEqual([
      'The name "Bad Name" has capital letters and a space',
      'Use lowercase letters, digits and single hyphens',
    ])
  })

  it('shows a checklist for a repository with several skills and reviews them one by one', async () => {
    await mountDialog({ canImportFromUrl: true, initialTab: 'github' })
    mocks.fetch.mockResolvedValueOnce({
      pick: {
        owner: 'o',
        repo: 'r',
        ref: 'main',
        sha: 'c'.repeat(40),
        total: 17,
        truncated: true,
        max: 10,
        candidates: [
          { path: 'skills/a', name: 'a' },
          { path: 'skills/b', name: 'b' },
        ],
      },
    })
    await setValue('skill-import-url', 'https://github.com/o/r')
    await click('skill-import-submit')

    expect(get('skill-import-pick').textContent).toContain(
      'This repository has 17 skills. Choose which to import.',
    )

    const items = document.body.querySelectorAll(
      '[data-testid="skill-import-pick-item"]',
    )

    for (const item of items) {
      ;(item as HTMLInputElement).checked = true
      item.dispatchEvent(new Event('change'))
      await flushPromises()
    }

    mocks.fetch.mockResolvedValueOnce(createImportPreview({
      source: 'github',
      sourceUrl: 'https://github.com/o/r',
      sourcePath: 'skills/a',
    }))
    await click('skill-import-pick-review')

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/skills/import/preview',
      {
        method: 'POST',
        body: { url: 'https://github.com/o/r', path: 'skills/a' },
      },
    )
    expect(get('skill-import-queue').textContent).toContain('Skill 1 of 2')
  })

  it('refuses a bad archive from the worker without calling the server', async () => {
    await mountDialog({ initialTab: 'upload' })
    mocks.inspect.mockResolvedValueOnce({
      ok: false,
      code: 'archive-symlink',
      message: 'The archive contains a symbolic link',
    })

    const input = get('skill-import-file') as HTMLInputElement
    const file = new File(['zip'], 'bad.zip', { type: 'application/zip' })

    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    input.dispatchEvent(new Event('change'))
    await flushPromises()
    await click('skill-import-submit')

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(get('skill-import-error').textContent)
      .toContain('The archive contains a symbolic link')
  })

  it('shows the release and switches to the latest commit with the channel in the request', async () => {
    await mountDialog({ canImportFromUrl: true, initialTab: 'github' })
    mocks.fetch.mockResolvedValueOnce(createImportPreview({
      source: 'github',
      sourceUrl: 'https://github.com/o/r',
      sourcePath: 'skills/a',
      sourceRef: '2.1.2',
      sourceVersion: 'c'.repeat(40),
      release: {
        tag: '2.1.2',
        isLatestRelease: true,
        latestTag: '2.1.2',
        defaultBranch: 'main',
        channel: 'release',
        switchable: true,
      },
    }))
    await setValue('skill-import-url', 'https://github.com/o/r/tree/main/skills/a')
    await click('skill-import-submit')

    expect(get('skill-review-source-label').textContent)
      .toBe('github.com/o/r/skills/a @ 2.1.2')
    expect(get('skill-review-release').textContent).toContain('Latest release')
    expect(get('skill-review-switch-source').textContent)
      .toContain('Use the latest commit on main instead')

    mocks.fetch.mockResolvedValueOnce(createImportPreview({
      source: 'github',
      sourceUrl: 'https://github.com/o/r',
      sourcePath: 'skills/a',
      sourceRef: 'main',
      sourceVersion: '300432a'.padEnd(40, '0'),
      release: {
        tag: null,
        isLatestRelease: false,
        latestTag: '2.1.2',
        defaultBranch: 'main',
        channel: 'branch',
        switchable: true,
      },
    }))
    await click('skill-review-switch-source')

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/skills/import/preview',
      {
        method: 'POST',
        body: {
          url: 'https://github.com/o/r/tree/main/skills/a',
          channel: 'branch',
        },
      },
    )
    expect(get('skill-review-source-label').textContent)
      .toBe('github.com/o/r/skills/a @ 300432a')
    expect(get('skill-review-switch-source').textContent)
      .toContain('Use the latest release 2.1.2 instead')
  })

  describe('an already installed skill', () => {
    function installedPreview(installed: Record<string, unknown>) {
      return createImportPreview({
        installed: {
          kind: 'same-source',
          skillId: 'skill-id-1',
          name: 'review-pr',
          sourceLabel: '2.1.2',
          isUpToDate: false,
          ...installed,
        },
      } as never)
    }

    async function reviewAndConfirm(
      preview: ReturnType<typeof createImportPreview>,
    ) {
      await mountDialog()
      await reachReview(preview)
      await check('skill-import-reviewed')
    }

    it('warns before review and offers an update or a copy', async () => {
      await reviewAndConfirm(installedPreview({}))

      expect(get('skill-import-installed').className).toContain('alert-info')
      expect(get('skill-import-installed-title').textContent)
        .toContain('You already have review-pr (from the same source')
      expect(get('skill-import-installed-title').textContent)
        .toContain('@ 2.1.2')
      expect(find('skill-import-collision')).toBeNull()
      expect(find('skill-import-rename')).toBeNull()

      mocks.fetch.mockResolvedValueOnce({
        kind: 'pending',
        id: 'skill-id-1',
        name: 'review-pr',
        version: 2,
        pendingVersion: 2,
        licenseClass: 'open',
        filesCount: 2,
      })
      await click('skill-import-installed-update')

      expect(mocks.fetch).toHaveBeenLastCalledWith(
        '/api/v1/skills/import/commit',
        expect.objectContaining({
          body: expect.objectContaining({ asUpdateOf: 'skill-id-1' }),
        }),
      )
    })

    it('installs a copy under another name', async () => {
      await reviewAndConfirm(installedPreview({}))
      await click('skill-import-installed-copy')

      expect((get('skill-import-rename') as HTMLInputElement).value)
        .toBe('review-pr-copy')

      mocks.fetch.mockResolvedValueOnce({
        kind: 'created',
        id: 'new-id',
        name: 'review-pr-copy',
        version: 1,
        licenseClass: 'open',
        filesCount: 2,
      })
      await click('skill-import-rename-submit')

      expect(mocks.fetch).toHaveBeenLastCalledWith(
        '/api/v1/skills/import/commit',
        expect.objectContaining({
          body: expect.objectContaining({ name: 'review-pr-copy' }),
        }),
      )
    })

    it('says up to date and keeps Install disabled', async () => {
      await reviewAndConfirm(installedPreview({ isUpToDate: true }))

      expect(get('skill-import-installed-title').textContent?.trim())
        .toBe('Already installed and up to date')
      expect(find('skill-import-installed-update')).toBeNull()
      expect((get('skill-import-install') as HTMLButtonElement).disabled)
        .toBe(true)
    })

    it('shows a same-name skill from another source as a collision before review', async () => {
      await reviewAndConfirm(installedPreview({ kind: 'same-name' }))

      expect(get('skill-import-collision').textContent)
        .toContain('A skill named review-pr exists.')
      expect(find('skill-import-installed')).toBeNull()
      expect(find('skill-import-replace')).not.toBeNull()
    })
  })

  describe('reading the files before installing', () => {
    function treeItem(name: string): HTMLElement {
      const item = [...document.body.querySelectorAll(
        '[data-testid="skill-file-tree-item"]',
      )].find(candidate => candidate.textContent?.includes(name))

      if (!item) {
        throw new Error(`Missing file ${name}`)
      }

      return item as HTMLElement
    }

    it('fetches another file of a pasted or GitHub import from the staged copy and shows it', async () => {
      await mountDialog()
      await reachReview()
      mocks.fetch.mockResolvedValueOnce({
        path: 'scripts/run.sh',
        bytes: 8,
        kind: 'script',
        text: 'echo one\necho two',
      })
      treeItem('run.sh').click()
      await flushPromises()

      expect(mocks.fetch).toHaveBeenLastCalledWith(
        `/api/v1/skills/import/stages/${'a'.repeat(32)}/files`,
        { query: { path: 'scripts/run.sh' } },
      )
      expect(document.body.textContent).not.toContain(
        'not shown before you install',
      )
      expect(get('skill-file-viewer-lines').textContent).toContain('echo two')
    })

    it('opens the file of a highlight and marks its line', async () => {
      Element.prototype.scrollIntoView = vi.fn()
      await mountDialog()
      await reachReview()
      mocks.fetch.mockResolvedValueOnce({
        path: 'scripts/run.sh',
        bytes: 8,
        kind: 'script',
        text: 'echo one\nhttps://x.test',
      })

      const findings = document.body.querySelectorAll(
        '[data-testid="skill-review-finding"]',
      )

      ;(findings[1] as HTMLElement).click()
      await flushPromises()

      expect(get('skill-file-line-focused').getAttribute('data-line'))
        .toBe('1')
      expect(mocks.fetch).toHaveBeenLastCalledWith(
        `/api/v1/skills/import/stages/${'a'.repeat(32)}/files`,
        { query: { path: 'scripts/run.sh' } },
      )
    })

    it('says in plain text that an import has expired when its file is asked for later', async () => {
      await mountDialog()
      await reachReview()
      mocks.fetch.mockRejectedValueOnce({
        data: {
          message: 'This import has expired',
          why: 'Staged files are kept for one hour',
        },
      })
      treeItem('run.sh').click()
      await flushPromises()

      expect(get('skill-review-file-error').textContent).toContain(
        'This import has expired',
      )
    })
  })
})

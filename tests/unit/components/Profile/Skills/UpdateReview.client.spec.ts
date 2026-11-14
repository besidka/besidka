import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import UpdateReview from '../../../../../app/components/Profile/Skills/UpdateReview.client.vue'
import {
  createSkillDetail,
  createVersionSummary,
} from '../../../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refreshNuxtData: vi.fn(),
  success: vi.fn(),
}))

const detail = ref<unknown>(null)
const versions = ref<unknown>(null)
const diff = ref<unknown>(null)

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('refreshNuxtData', () => mocks.refreshNuxtData)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useLazyFetch', () => {
  return (url: () => string) => {
    const isVersions = url().endsWith('/versions')

    return {
      data: isVersions ? versions : detail,
      status: ref('success'),
      error: ref(null),
      refresh: vi.fn(),
    }
  }
})
mockNuxtImport('useLazyAsyncData', () => {
  return () => ({
    data: diff,
    status: ref('success'),
    error: ref(null),
    refresh: vi.fn(),
  })
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

async function check(id: string) {
  const input = get(id) as HTMLInputElement

  input.checked = true
  input.dispatchEvent(new Event('change'))
  await flushPromises()
}

function setUp(options: {
  pendingLicence?: 'open' | 'none' | 'custom'
  currentLicence?: 'open' | 'none' | 'authored'
  history?: Array<{ version: number, origin: string, isPending?: boolean }>
} = {}) {
  const pending = createVersionSummary({
    version: 4,
    isPending: true,
    sha256: 'c'.repeat(64),
    origin: 'update',
    licenseClass: options.pendingLicence ?? 'open',
    findings: { url: 2 },
  })

  detail.value = createSkillDetail({
    id: 'SkillPublicId01',
    name: 'review-pr',
    sourceKind: 'github',
    sourceUrl: 'https://github.com/o/r',
    sourceVersion: 'a'.repeat(40),
    currentVersion: 3,
    pendingVersion: 4,
    currentVersionInfo: createVersionSummary({
      version: 3,
      isCurrent: true,
      licenseClass: options.currentLicence ?? 'open',
      findings: { url: 1, shell: 1 },
    }),
    pendingVersionInfo: pending,
  })
  versions.value = {
    current: 3,
    pending: 4,
    versions: (options.history ?? [
      { version: 4, origin: 'update', isPending: true },
      { version: 3, origin: 'import' },
    ]).map((entry) => {
      return createVersionSummary({
        version: entry.version,
        origin: entry.origin as 'import',
        isPending: entry.isPending ?? false,
      })
    }),
  }
  diff.value = {
    from: createVersionSummary({ version: 3 }),
    to: pending,
    diff: {
      files: [{
        path: 'SKILL.md',
        status: 'modified',
        added: 1,
        removed: 1,
        truncated: false,
        lines: [
          { kind: 'remove', text: 'old' },
          { kind: 'add', text: 'new' },
        ],
      }],
      added: 1,
      removed: 1,
      unchanged: 0,
      truncated: false,
    },
    skipped: [],
    licence: {
      changed: options.pendingLicence !== undefined
        && options.pendingLicence !== (options.currentLicence ?? 'open'),
      before: { class: options.currentLicence ?? 'open', fileSha256: null },
      after: { class: options.pendingLicence ?? 'open', fileSha256: null },
    },
  }
}

function mountReview() {
  return mountSuspended(UpdateReview, {
    props: { skillId: 'SkillPublicId01' },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })
}

describe('Profile/Skills/UpdateReview', () => {
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
    mocks.fetch.mockResolvedValue({ id: 'SkillPublicId01', version: 5 })
    mocks.refreshNuxtData.mockReset()
    mocks.success.mockReset()
    detail.value = null
    versions.value = null
    diff.value = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the diff against the current version with + and - markers', async () => {
    setUp()
    await mountReview()

    expect(get('skill-update-current').textContent).toContain('v3')
    expect(get('skill-diff-line-add').textContent).toContain('+')
    expect(get('skill-diff-line-remove').textContent).toContain('-')
    expect(get('skill-update-warning').textContent).toContain(
      'Installing a skill is like installing software.',
    )
    expect(get('skill-update-finding-counts').textContent)
      .toContain('2 links')
  })

  it('links to the GitHub compare view', async () => {
    setUp()
    await mountReview()

    const link = get('skill-update-pending').querySelector('a')!

    expect(link.getAttribute('href')).toBe(
      `https://github.com/o/r/compare/${'a'.repeat(40)}...abcdef1234567890`,
    )
  })

  it('warns that accepting replaces local edits since the import', async () => {
    setUp({
      history: [
        { version: 5, origin: 'update', isPending: true },
        { version: 4, origin: 'editor' },
        { version: 3, origin: 'import' },
      ],
    })
    await mountReview()

    expect(get('skill-update-local-edits').textContent).toContain(
      'Accepting replaces your local edits since the import.',
    )
    expect(get('skill-update-local-edits').textContent).toContain('v4')
  })

  it('shows no local-edits warning when nothing was edited', async () => {
    setUp()
    await mountReview()

    expect(find('skill-update-local-edits')).toBeNull()
  })

  it('keeps Accept disabled until the update is reviewed', async () => {
    setUp()
    await mountReview()

    const accept = get('skill-update-accept') as HTMLButtonElement

    expect(accept.disabled).toBe(true)

    await check('skill-update-reviewed')

    expect(accept.disabled).toBe(false)
  })

  it('needs the licence tick when the class changes to no licence', async () => {
    setUp({ pendingLicence: 'none', currentLicence: 'open' })
    await mountReview()

    const accept = get('skill-update-accept') as HTMLButtonElement

    await check('skill-update-reviewed')

    expect(accept.disabled).toBe(true)
    expect(get('skill-update-licence-changed').textContent)
      .toContain('The licence changed')

    await check('skill-update-licence-tick')

    expect(accept.disabled).toBe(false)
  })

  it('does not ask for the licence tick when the class stays open', async () => {
    setUp()
    await mountReview()

    expect(find('skill-update-licence-tick')).toBeNull()
  })

  it('accepts the reviewed version by its hash and closes', async () => {
    setUp({ pendingLicence: 'none', currentLicence: 'open' })

    const wrapper = await mountReview()

    await check('skill-update-reviewed')
    await check('skill-update-licence-tick')
    get('skill-update-accept').click()
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/skills/SkillPublicId01/update/accept',
      {
        method: 'POST',
        body: {
          version: 4,
          sha256: 'c'.repeat(64),
          licenceAcknowledged: true,
        },
      },
    )
    expect(wrapper.emitted('close')).toBeTruthy()
    expect(mocks.success).toHaveBeenCalled()
  })

  it('rejects by version and hash', async () => {
    setUp()
    mocks.fetch.mockResolvedValue({ id: 'SkillPublicId01', rejected: true })

    await mountReview()
    get('skill-update-reject').click()
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/skills/SkillPublicId01/update/reject',
      { method: 'POST', body: { version: 4, sha256: 'c'.repeat(64) } },
    )
  })

  it('shows the server message when the update changed while reviewing', async () => {
    setUp()
    mocks.fetch.mockRejectedValue({
      data: {
        code: 'pending-changed',
        message: 'This update changed while you were reviewing it',
      },
    })

    await mountReview()
    await check('skill-update-reviewed')
    get('skill-update-accept').click()
    await flushPromises()

    expect(get('skill-update-action-error').textContent)
      .toContain('This update changed while you were reviewing it')
  })

  it('says so when there is no pending update', async () => {
    setUp()
    ;(detail.value as { pendingVersionInfo: unknown }).pendingVersionInfo = null
    await mountReview()

    expect(get('skill-update-none').textContent)
      .toContain('There is no update to review.')
  })
})

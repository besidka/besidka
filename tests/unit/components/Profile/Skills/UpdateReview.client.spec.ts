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
const pendingFindings = ref<unknown>(null)
const currentFindings = ref<unknown>(null)
let asyncDataCalls = 0

mockNuxtImport('useLazyAsyncData', () => {
  return () => {
    const sources = [diff, pendingFindings, currentFindings]
    const data = sources[asyncDataCalls % sources.length]!

    asyncDataCalls += 1

    return {
      data,
      status: ref('success'),
      error: ref(null),
      refresh: vi.fn(),
    }
  }
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
  pendingLicense?: 'open' | 'none' | 'custom'
  currentLicense?: 'open' | 'none' | 'authored'
  history?: Array<{ version: number, origin: string, isPending?: boolean }>
} = {}) {
  const pending = createVersionSummary({
    version: 4,
    isPending: true,
    sha256: 'c'.repeat(64),
    origin: 'update',
    licenseClass: options.pendingLicense ?? 'open',
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
      licenseClass: options.currentLicense ?? 'open',
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
    license: {
      changed: options.pendingLicense !== undefined
        && options.pendingLicense !== (options.currentLicense ?? 'open'),
      before: { class: options.currentLicense ?? 'open', fileSha256: null },
      after: { class: options.pendingLicense ?? 'open', fileSha256: null },
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
    pendingFindings.value = null
    currentFindings.value = null
    asyncDataCalls = 0
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

  it('shows the rescanned counts and says they come from newer checks', async () => {
    setUp()
    pendingFindings.value = {
      counts: { rulesVersion: 2, high: 1, low: 1, injection: 1, url: 1 },
      isRescanned: true,
    }
    currentFindings.value = {
      counts: { rulesVersion: 2, low: 1, url: 1 },
      isRescanned: true,
    }
    await mountReview()

    const text = get('skill-update-finding-counts').textContent

    expect(text).toContain(
      '1 to look closely at, 1 for your information (1 link, 1 instruction-like phrase)',
    )
    expect(text).toContain('Rescanned with newer checks.')
  })

  it('shows counts from the current rules without a rescan note', async () => {
    setUp()
    pendingFindings.value = {
      counts: { rulesVersion: 2, low: 2, url: 2 },
      isRescanned: false,
    }
    currentFindings.value = {
      counts: { rulesVersion: 2, low: 1, url: 1 },
      isRescanned: false,
    }
    await mountReview()

    const text = get('skill-update-finding-counts').textContent

    expect(text).not.toContain('Rescanned')
    expect(text).toContain('2 for your information (2 links)')
  })

  describe('what changed since the version in use', () => {
    const highFinding = {
      type: 'execution' as const,
      rule: 'dynamic-context-inline',
      severity: 'high' as const,
      source: 'rules' as const,
      path: 'SKILL.md',
      line: 8,
      snippet: '!`gh pr diff`',
      detail: null,
    }

    function setChanges(changes: Record<string, unknown> | null) {
      setUp()
      ;(diff.value as { changes: unknown }).changes = changes === null
        ? null
        : {
          newFindings: [],
          newHosts: [],
          changedSettings: [],
          newScripts: [],
          isPartial: false,
          ...changes,
        }
    }

    it('lists new highlights, new addresses, changed settings and new scripts', async () => {
      setChanges({
        newFindings: [highFinding],
        newHosts: ['hooks.slack.com', 'evil.example'],
        changedSettings: [{
          key: 'allowed-tools',
          before: 'Read',
          after: 'Bash(*)',
        }],
        newScripts: ['scripts/setup.sh'],
      })
      await mountReview()

      expect(get('skill-update-new-findings-high').textContent)
        .toContain('SKILL.md:8')
      expect(get('skill-update-new-hosts').textContent)
        .toContain('hooks.slack.com')
      expect(get('skill-update-new-hosts').textContent)
        .toContain('evil.example')
      expect(get('skill-update-changed-setting').textContent)
        .toContain('allowed-tools')
      expect(get('skill-update-changed-setting').textContent)
        .toContain('Bash(*)')
      expect(get('skill-update-new-scripts').textContent)
        .toContain('scripts/setup.sh')
    })

    it('says so when nothing new was highlighted', async () => {
      setChanges({})
      await mountReview()

      expect(get('skill-update-new-findings-none').textContent?.trim())
        .toBe('Nothing new was highlighted.')
      expect(find('skill-update-new-hosts')).toBeNull()
      expect(find('skill-update-changed-settings')).toBeNull()
      expect(find('skill-update-new-scripts')).toBeNull()
    })

    it('asks for the second tick on a new highlight and blocks accept without it', async () => {
      setChanges({ newFindings: [highFinding] })
      await mountReview()
      await check('skill-update-reviewed')

      const accept = get('skill-update-accept') as HTMLButtonElement

      expect(get('skill-update-highlights').parentElement!.textContent)
        .toContain(
          'I read the highlight marked Look closely (code that runs in Claude Code)',
        )
      expect(accept.disabled).toBe(true)

      await check('skill-update-highlights')

      expect(accept.disabled).toBe(false)
    })

    it('asks for no second tick when the update adds no highlight, even if the old version had some', async () => {
      setChanges({})
      ;(detail.value as {
        currentVersionInfo: { findings: Record<string, number> }
      }).currentVersionInfo.findings = {
        rulesVersion: 3,
        high: 2,
        execution: 2,
      }
      pendingFindings.value = {
        counts: { rulesVersion: 3, high: 2, execution: 2 },
        isRescanned: false,
      }
      await mountReview()
      await check('skill-update-reviewed')

      expect(find('skill-update-highlights')).toBeNull()
      expect((get('skill-update-accept') as HTMLButtonElement).disabled)
        .toBe(false)
    })

    it('falls back to the stored count when the changes are partial', async () => {
      setChanges({ isPartial: true })
      pendingFindings.value = {
        counts: { rulesVersion: 3, high: 1, execution: 1 },
        isRescanned: false,
      }
      await mountReview()

      expect(find('skill-update-highlights')).not.toBeNull()
      expect(get('skill-update-changes-partial').textContent)
        .toContain('may be incomplete')
    })

    it('shows no changes section when the server sent none', async () => {
      setChanges(null)
      await mountReview()

      expect(find('skill-update-changes')).toBeNull()
    })
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

  it('needs the license tick when the class changes to no license', async () => {
    setUp({ pendingLicense: 'none', currentLicense: 'open' })
    await mountReview()

    const accept = get('skill-update-accept') as HTMLButtonElement

    await check('skill-update-reviewed')

    expect(accept.disabled).toBe(true)
    expect(get('skill-update-license-changed').textContent)
      .toContain('The license changed')

    await check('skill-update-license-tick')

    expect(accept.disabled).toBe(false)
  })

  it('does not ask for the license tick when the class stays open', async () => {
    setUp()
    await mountReview()

    expect(find('skill-update-license-tick')).toBeNull()
  })

  it('accepts the reviewed version by its hash and closes', async () => {
    setUp({ pendingLicense: 'none', currentLicense: 'open' })

    const wrapper = await mountReview()

    await check('skill-update-reviewed')
    await check('skill-update-license-tick')
    get('skill-update-accept').click()
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/skills/SkillPublicId01/update/accept',
      {
        method: 'POST',
        body: {
          version: 4,
          sha256: 'c'.repeat(64),
          licenseAcknowledged: true,
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

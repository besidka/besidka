import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtifactShareSummary } from '#shared/utils/artifacts'
import ShareModal from '../../../../../app/components/Chat/Artifact/ShareModal.client.vue'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  writeText: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)

const BASE = '/api/v1/artifacts/ArtifactPublicId1/shares'
const LINK = 'https://besidka.test/a/token-new'

function createShare(
  overrides: Partial<ArtifactShareSummary> = {},
): ArtifactShareSummary {
  return {
    shareId: 'sh_1',
    url: 'https://besidka.test/a/token-1',
    createdVia: 'ui',
    clientName: null,
    pinnedVersion: null,
    expiresAt: '2026-11-16T10:00:00.000Z',
    revokedAt: null,
    takedownAt: null,
    storageAllowed: false,
    bridgeAllowed: false,
    createdAt: '2026-11-09T10:00:00.000Z',
    status: 'active',
    ...overrides,
  }
}

interface RouteOptions {
  shares?: ArtifactShareSummary[]
  warnings?: string[]
  create?: () => unknown
}

function routeFetch(options: RouteOptions = {}) {
  mocks.fetch.mockImplementation(async (url: string, init?: {
    method?: string
    body?: Record<string, unknown>
  }) => {
    if (url === BASE && !init?.method) {
      return { shares: options.shares ?? [] }
    }

    if (url === `${BASE}/check`) {
      return { warnings: options.warnings ?? [] }
    }

    if (url === BASE && init?.method === 'POST') {
      if (options.create) {
        return options.create()
      }

      const share = createShare({
        shareId: 'sh_new',
        url: LINK,
        pinnedVersion: (init.body?.pinnedVersion as number | null) ?? null,
        storageAllowed: init.body?.storageAllowed as boolean,
        bridgeAllowed: init.body?.bridgeAllowed as boolean,
      })

      return { share, url: LINK }
    }

    if (url.endsWith('/revoke')) {
      return { revoked: 1 }
    }

    throw new Error(`Unexpected request ${url}`)
  })
}

function byTestId(testId: string) {
  return `[data-testid="${testId}"]`
}

async function mountModal(): Promise<VueWrapper> {
  const wrapper = await mountSuspended(ShareModal, {
    props: {
      'open': false,
      'onUpdate:open': (value: boolean) => {
        wrapper.setProps({ open: value })
      },
      'artifactId': 'ArtifactPublicId1',
      'title': 'Capitals quiz',
      'currentVersion': 4,
    },
    global: { stubs: { teleport: true } },
  })

  await wrapper.setProps({ open: true })
  await flushPromises()

  return wrapper
}

function requestsTo(url: string, method?: string) {
  return mocks.fetch.mock.calls.filter(([calledUrl, init]) => {
    return calledUrl === url && init?.method === method
  })
}

describe('Chat/Artifact/ShareModal.client', () => {
  beforeEach(() => {
    routeFetch()
    mocks.confirm.mockReset().mockResolvedValue({ label: 'Turn off' })
    mocks.success.mockReset()
    mocks.error.mockReset()
    mocks.writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText },
    })
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(() => {})
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens as a bottom sheet with safe defaults and the privacy note',
    async () => {
      const wrapper = await mountModal()
      const dialog = wrapper.get(byTestId('artifact-share-modal'))

      expect(dialog.classes()).toEqual(expect.arrayContaining([
        'modal',
        'modal-bottom',
        'sm:modal-middle',
      ]))
      expect((wrapper.get(byTestId('artifact-share-storage'))
        .element as HTMLInputElement).checked).toBe(false)
      expect((wrapper.get(byTestId('artifact-share-bridge'))
        .element as HTMLInputElement).checked).toBe(false)
      expect((wrapper.get(byTestId('artifact-share-version-latest'))
        .element as HTMLInputElement).checked).toBe(true)
      expect(wrapper.get(byTestId('artifact-share-version-pinned')).element
        .parentElement?.textContent).toContain('Pin version v4')
      expect(wrapper.get(byTestId('artifact-share-privacy-note')).text())
        .toBe('Anyone with the link can see this artifact. Viewers can '
          + 'report it.')
      expect(wrapper.get(byTestId('artifact-share-search-note')).classes())
        .toEqual(expect.arrayContaining(['alert', 'alert-info']))
      expect(wrapper.get(byTestId('artifact-share-search-note')).text())
        .toBe('Private by default: only people who have the link can open '
          + 'it, and search engines never show it.')
      expect(wrapper.find('input[data-testid*="index"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('Let signed-in viewers save progress')
      expect(wrapper.text()).toContain(
        'Let signed-in viewers use AI features on their own key',
      )
    })

  it('warns about personal data before creating', async () => {
    routeFetch({ warnings: ['email', 'phone'] })

    const wrapper = await mountModal()

    expect(requestsTo(`${BASE}/check`, 'POST')[0]![1].body)
      .toEqual({ pinnedVersion: null })
    expect(wrapper.get(byTestId('artifact-share-pii-warning')).text())
      .toContain('email, phone')
  })

  it('checks the pinned version when the owner pins it', async () => {
    const wrapper = await mountModal()

    await wrapper.get(byTestId('artifact-share-version-pinned'))
      .setValue(true)
    await flushPromises()

    expect(requestsTo(`${BASE}/check`, 'POST').at(-1)![1].body)
      .toEqual({ pinnedVersion: 4 })
  })

  it('creates a link with the chosen settings and copies it', async () => {
    const wrapper = await mountModal()

    await wrapper.get(byTestId('artifact-share-duration')).setValue('month')
    await wrapper.get(byTestId('artifact-share-version-pinned'))
      .setValue(true)
    await wrapper.get(byTestId('artifact-share-storage')).setValue(true)
    await wrapper.get(byTestId('artifact-share-form')).trigger('submit')
    await flushPromises()

    expect(requestsTo(BASE, 'POST')[0]![1].body).toEqual({
      duration: 'month',
      pinnedVersion: 4,
      storageAllowed: true,
      bridgeAllowed: false,
    })
    expect((wrapper.get(byTestId('artifact-share-link-input'))
      .element as HTMLInputElement).value).toBe(LINK)
    expect(mocks.writeText).toHaveBeenCalledWith(LINK)
    expect(wrapper.find(byTestId('artifact-share-row-sh_new')).exists())
      .toBe(true)
  })

  it('shows every link as hidden from search engines', async () => {
    routeFetch({
      shares: [createShare(), createShare({ shareId: 'sh_2' })],
    })

    const wrapper = await mountModal()
    const badges = wrapper.findAll(byTestId('artifact-share-visibility'))

    expect(badges.map(badge => badge.text())).toEqual([
      'Hidden from search engines',
      'Hidden from search engines',
    ])
  })

  it('lists links with status, version, expiry and MCP origin', async () => {
    routeFetch({
      shares: [
        createShare({ pinnedVersion: 2 }),
        createShare({
          shareId: 'sh_2',
          createdVia: 'mcp',
          clientName: 'Claude',
          status: 'revoked',
          url: null,
        }),
      ],
    })

    const wrapper = await mountModal()
    const active = wrapper.get(byTestId('artifact-share-row-sh_1'))
    const revoked = wrapper.get(byTestId('artifact-share-row-sh_2'))

    expect(active.get(byTestId('artifact-share-status')).classes())
      .toEqual(expect.arrayContaining(['badge', 'badge-soft']))
    expect(active.text()).toContain('Active')
    expect(active.text()).toContain('v2')
    expect(active.text()).toContain('Expires')
    expect(active.find(byTestId('artifact-share-revoke')).exists()).toBe(true)
    expect(revoked.text()).toContain('Turned off')
    expect(revoked.get(byTestId('artifact-share-mcp')).text())
      .toBe('Created by connected app Claude')
    expect(revoked.find(byTestId('artifact-share-revoke')).exists())
      .toBe(false)
  })

  it('revokes a link after confirmation', async () => {
    routeFetch({ shares: [createShare()] })

    const wrapper = await mountModal()

    await wrapper.get(byTestId('artifact-share-revoke')).trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Turn off this link?',
      alert: true,
    }))
    expect(requestsTo(`${BASE}/sh_1/revoke`, 'POST')).toHaveLength(1)
    expect(mocks.success).toHaveBeenCalledWith('Link turned off')
  })

  it('does not revoke when the owner cancels', async () => {
    routeFetch({ shares: [createShare()] })
    mocks.confirm.mockResolvedValue(null)

    const wrapper = await mountModal()

    await wrapper.get(byTestId('artifact-share-revoke')).trigger('click')
    await flushPromises()

    expect(requestsTo(`${BASE}/sh_1/revoke`, 'POST')).toHaveLength(0)
  })

  it('stops at the active link limit', async () => {
    routeFetch({
      shares: Array.from({ length: 10 }, (_value, index) => {
        return createShare({ shareId: `sh_${index}` })
      }),
    })

    const wrapper = await mountModal()

    expect(wrapper.get(byTestId('artifact-share-limit')).text())
      .toContain('10 active links')
    expect(wrapper.get(byTestId('artifact-share-create'))
      .attributes('disabled')).toBeDefined()
  })

  it('shows the server reason when creating fails', async () => {
    routeFetch({
      create: () => {
        throw Object.assign(new Error('limit'), {
          statusCode: 409,
          data: {
            message: 'This artifact already has 10 active links',
            why: 'At most 10 active links',
          },
        })
      },
    })

    const wrapper = await mountModal()

    await wrapper.get(byTestId('artifact-share-form')).trigger('submit')
    await flushPromises()

    expect(mocks.error).toHaveBeenCalledWith(
      'This artifact already has 10 active links',
      'At most 10 active links',
    )
    expect(requestsTo(BASE, undefined).length).toBeGreaterThan(1)
  })
})

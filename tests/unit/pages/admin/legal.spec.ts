import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import LegalPage from '../../../../app/pages/admin/legal.vue'

const mocks = vi.hoisted(() => ({
  lazyFetch: vi.fn(),
  refresh: vi.fn(),
  confirm: vi.fn(),
  fetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('useLazyFetch', () => mocks.lazyFetch)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)

const NOTICE_ID = '2026-12-test-notice'

function createOverview(overrides: {
  sweepEnabled?: boolean
  approvalState?: 'none' | 'approved' | 'changed'
  isCodeVersionApproved?: boolean
} = {}) {
  return {
    sweepEnabled: overrides.sweepEnabled ?? false,
    notices: [
      {
        id: NOTICE_ID,
        documents: ['privacy-policy'],
        publishedAt: '2026-11-15T06:00:00Z',
        sendFrom: '2026-11-15T09:00:00Z',
        effectiveAt: '2026-12-19',
        summary: ['Something changed.'],
        windowState: 'open',
        deliveries: { sent: 0, skipped: 30, failed: 0, sending: 0 },
        recipientsNow: 2,
        approval: overrides.approvalState && overrides.approvalState !== 'none'
          ? {
            state: overrides.approvalState,
            approvedAt: '2026-11-15T12:00:00.000Z',
            recipientEstimate: 2,
            deliveredSinceApproval: 1,
            approvedByEmail: null,
          }
          : {
            state: 'none',
            approvedAt: null,
            recipientEstimate: null,
            deliveredSinceApproval: null,
            approvedByEmail: null,
          },
      },
    ],
    consent: {
      codeVersion: '2026-12-a',
      approvedVersion: '2026-11-a',
      effectiveVersion: '2026-11-a',
      isCodeVersionApproved: overrides.isCodeVersionApproved ?? false,
      usersOnEffectiveVersion: 30,
      approvals: [],
    },
    optOuts: [
      {
        userId: 23,
        email: 'reader@example.test',
        source: 'admin',
        createdAt: '2026-11-15T10:00:00.000Z',
      },
    ],
  }
}

async function mountPage(overview = createOverview()) {
  mocks.lazyFetch.mockReturnValue({
    data: ref(overview),
    status: ref('success'),
    error: ref(null),
    refresh: mocks.refresh,
  })

  return mountSuspended(LegalPage)
}

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

describe('admin legal page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    mocks.lazyFetch.mockReset()
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.confirm.mockReset().mockResolvedValue({ label: 'Approve' })
    mocks.fetch.mockReset().mockResolvedValue({})
    mocks.success.mockReset()
    mocks.error.mockReset()
  })

  it('says that legal notice emails are off', async () => {
    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="admin-legal-sweep-state"]').text())
      .toContain('Legal notice emails are off')
    expect(wrapper.get(
      `[data-testid="admin-legal-notice-recipients-${NOTICE_ID}"]`,
    ).text()).toContain('2 users would be emailed now')
  })

  it('states the recipient count and sends it with the approval',
    async () => {
      const wrapper = await mountPage(createOverview({ sweepEnabled: true }))

      await wrapper.get(
        `[data-testid="admin-legal-notice-approve-${NOTICE_ID}"]`,
      ).trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
        text: `Approve emails for ${NOTICE_ID}?`,
        subtitle: expect.stringContaining('This emails 2 users now'),
        actions: ['Approve for 2 users'],
      }))
      expect(mocks.fetch).toHaveBeenCalledWith(
        `/api/v1/admin/legal/notices/${NOTICE_ID}/approve`,
        { method: 'POST', body: { recipientEstimate: 2 } },
      )
      expect(mocks.refresh).toHaveBeenCalled()
    })

  it('says nothing is sent while the sweep switch is off', async () => {
    const wrapper = await mountPage()

    await wrapper.get(
      `[data-testid="admin-legal-notice-approve-${NOTICE_ID}"]`,
    ).trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      subtitle: expect.stringContaining('Nothing is sent while'),
    }))
  })

  it('does not approve when the confirmation is canceled', async () => {
    mocks.confirm.mockResolvedValue(null)

    const wrapper = await mountPage()

    await wrapper.get(
      `[data-testid="admin-legal-notice-approve-${NOTICE_ID}"]`,
    ).trigger('click')
    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('withdraws an approved notice', async () => {
    const wrapper = await mountPage(createOverview({
      approvalState: 'approved',
    }))

    expect(wrapper.get(
      `[data-testid="admin-legal-notice-budget-${NOTICE_ID}"]`,
    ).text()).toBe('Approved for 2, sent 1')

    await wrapper.get(
      `[data-testid="admin-legal-notice-withdraw-${NOTICE_ID}"]`,
    ).trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      `/api/v1/admin/legal/notices/${NOTICE_ID}/withdraw`,
      { method: 'POST' },
    )
  })

  it('approves the consent version in code after a confirmation',
    async () => {
      const wrapper = await mountPage()

      await wrapper.get('[data-testid="admin-legal-consent-approve"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Approve consent version 2026-12-a?',
        subtitle: expect.stringContaining('30 users who agreed to 2026-11-a'),
      }))
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/admin/legal/consent-version/approve',
        { method: 'POST', body: { version: '2026-12-a' } },
      )
    })

  it('removes an opt-out after a confirmation', async () => {
    const wrapper = await mountPage()

    await wrapper.get('[data-testid="admin-legal-opt-out-remove-23"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/admin/legal/opt-outs/23/remove',
      { method: 'POST' },
    )
  })
})

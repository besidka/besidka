import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import type { AdminArtifactReportDetail } from '#shared/utils/artifacts'
import ReportDetail from '../../../../app/components/Admin/ArtifactReportDetail.client.vue'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  lazyFetch: vi.fn(),
  refresh: vi.fn(),
  fetch: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  frameProps: [] as Array<Record<string, unknown>>,
}))

mockNuxtImport('useLazyFetch', () => mocks.lazyFetch)
mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)

mockComponent('ChatArtifactFrame', () => {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs }) {
      mocks.frameProps.push(attrs)

      return () => h('div', { 'data-testid': 'frame-stub' })
    },
  })
})

const STATEMENT = 'The page imitates a bank sign-in form.'

function createDetail(
  overrides: Partial<AdminArtifactReportDetail> = {},
): AdminArtifactReportDetail {
  return {
    id: 7,
    reason: 'copyright',
    priority: 'normal',
    status: 'open',
    decision: null,
    detailsPreview: 'Copies my book',
    reporterUserId: null,
    reporterName: 'Ann',
    reporterEmail: 'ann@example.test',
    artifactId: 'ArtifactPublicId1',
    artifact: {
      id: 'ArtifactPublicId1',
      title: 'Capitals quiz',
      kind: 'html',
      currentVersion: 2,
      ownerUserId: 3,
      ownerEmail: 'owner@example.test',
      takedownAt: null,
      legalHoldUntil: null,
    },
    share: { id: 'sh_1', status: 'active', pinnedVersion: null },
    chatShareId: null,
    createdAt: '2026-11-09T10:00:00.000Z',
    decidedAt: null,
    resolvedAt: null,
    details: 'Copies my book.\n\nCopyright notice\nSignature: Ann',
    decisionStatement: null,
    receiptSentAt: '2026-11-09T10:00:01.000Z',
    locationUrl: 'https://besidka.test/a#token-1',
    reportedVersion: null,
    currentVersion: 2,
    previewVersion: 2,
    ...overrides,
  }
}

async function mountDetail(detail: AdminArtifactReportDetail) {
  mocks.lazyFetch.mockImplementation(() => {
    return {
      data: ref(detail),
      status: ref('success'),
      error: ref(null),
      refresh: mocks.refresh,
    }
  })

  const onChanged = vi.fn()
  const wrapper = await mountSuspended(ReportDetail, {
    props: { reportId: detail.id, onChanged },
  })

  await flushPromises()

  return { wrapper, onChanged }
}

describe('Admin/ArtifactReportDetail.client', () => {
  beforeEach(() => {
    mocks.lazyFetch.mockReset()
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.fetch.mockReset().mockImplementation(async (url: string) => {
      if (url.includes('/versions/')) {
        return {
          artifactId: 'ArtifactPublicId1',
          kind: 'html',
          title: 'Capitals quiz',
          version: 2,
          content: '<p>Quiz</p>',
          sizeBytes: 11,
          createdAt: '2026-11-09T10:00:00.000Z',
        }
      }

      return {}
    })
    mocks.confirm.mockReset().mockImplementation(async (options: {
      actions: string[]
    }) => {
      return { label: options.actions[0] }
    })
    mocks.success.mockReset()
    mocks.error.mockReset()
    mocks.frameProps.length = 0
  })

  it('shows the details, copyright lines and location', async () => {
    const { wrapper } = await mountDetail(createDetail())

    expect(wrapper.get('[data-testid="admin-report-detail-details"]').text())
      .toContain('Signature: Ann')
    expect(wrapper.get('[data-testid="admin-report-detail-location"]').text())
      .toContain('https://besidka.test/a#token-1')
    expect(wrapper.text()).toContain('owner@example.test')
    expect(wrapper.text()).toContain('Copyright infringement')
  })

  it('previews the reported version read only, without storage or bridge',
    async () => {
      await mountDetail(createDetail())

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/admin/artifacts/ArtifactPublicId1/versions/2',
      )

      const props = mocks.frameProps.at(-1)!

      expect(props.source).toBe('shared')
      expect(props['artifact-id']).toBeNull()
      expect(props.result).toEqual({
        kind: 'html',
        title: 'Capitals quiz',
        content: '<p>Quiz</p>',
      })
    })

  it('opens on the reported version and lets the admin pick another',
    async () => {
      const { wrapper } = await mountDetail(createDetail({
        reportedVersion: 1,
        previewVersion: 1,
      }))
      const select = wrapper.get(
        '[data-testid="admin-report-preview-version"]',
      )

      expect(select.findAll('option').map(option => option.text()))
        .toEqual(['v1 (reported)', 'v2'])
      expect((select.element as HTMLSelectElement).value).toBe('1')
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/admin/artifacts/ArtifactPublicId1/versions/1',
      )

      await select.setValue('2')
      await flushPromises()

      expect(mocks.fetch).toHaveBeenLastCalledWith(
        '/api/v1/admin/artifacts/ArtifactPublicId1/versions/2',
      )
      expect(mocks.frameProps.at(-1)?.version).toBe(2)
    })

  it('sends a takedown decision with the scope and statement', async () => {
    const { wrapper, onChanged } = await mountDetail(createDetail())
    const submit = wrapper.get('[data-testid="admin-report-action-submit"]')

    expect(submit.attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="admin-report-action-scope"]')
      .setValue('all-shares')
    await wrapper.get('[data-testid="admin-report-action-statement"]')
      .setValue(STATEMENT)
    await wrapper.get('[data-testid="admin-report-action-form"]')
      .trigger('submit')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/admin/artifact-reports/7/action',
      {
        method: 'POST',
        body: {
          action: 'takedown',
          statement: STATEMENT,
          scope: 'all-shares',
        },
      },
    )
    expect(mocks.refresh).toHaveBeenCalled()
    expect(onChanged).toHaveBeenCalled()
  })

  it('hides the decision form for a closed report', async () => {
    const { wrapper } = await mountDetail(createDetail({
      status: 'rejected',
      decision: 'no-action',
      decisionStatement: 'Not illegal.',
    }))

    expect(wrapper.find('[data-testid="admin-report-action-form"]').exists())
      .toBe(false)
    expect(wrapper.text()).toContain('Not illegal.')
  })

  it('restores a taken-down artifact', async () => {
    const detail = createDetail({ status: 'actioned', decision: 'removed' })

    detail.artifact!.takedownAt = '2026-11-09T11:00:00.000Z'

    const { wrapper } = await mountDetail(detail)
    const restore = wrapper.get('[data-testid="admin-report-restore"]')

    expect(restore.text()).toBe('Restore artifact')

    await restore.trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/admin/artifact-takedowns/restore',
      { method: 'POST', body: { artifactId: 'ArtifactPublicId1' } },
    )
  })

  it('restores only the link when just the link was taken down',
    async () => {
      const { wrapper } = await mountDetail(createDetail({
        status: 'actioned',
        decision: 'restricted',
        share: { id: 'sh_1', status: 'taken-down', pinnedVersion: null },
      }))

      await wrapper.get('[data-testid="admin-report-restore"]')
        .trigger('click')
      await flushPromises()

      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/admin/artifact-takedowns/restore',
        { method: 'POST', body: { shareId: 'sh_1' } },
      )
    })
})

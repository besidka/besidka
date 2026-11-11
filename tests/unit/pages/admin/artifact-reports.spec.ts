import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import type { AdminArtifactReportSummary } from '#shared/utils/artifacts'
import ReportsPage from '../../../../app/pages/admin/artifact-reports.vue'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  lazyFetch: vi.fn(),
  refresh: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
}))

const viewKey = ref<string | null>(null)

mockNuxtImport('useLazyFetch', () => mocks.lazyFetch)
mockNuxtImport('useSidePanel', () => {
  return () => ({ open: mocks.open, close: mocks.close, viewKey })
})

mockComponent('AdminArtifactTakedownForm', () => {
  return defineComponent({
    setup() {
      return () => h('div', { 'data-testid': 'takedown-form-stub' })
    },
  })
})

function createReport(
  overrides: Partial<AdminArtifactReportSummary> = {},
): AdminArtifactReportSummary {
  return {
    id: 7,
    reason: 'phishing',
    priority: 'normal',
    status: 'open',
    decision: null,
    detailsPreview: 'Asks for a bank password',
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
    ...overrides,
  }
}

async function mountPage(items: AdminArtifactReportSummary[], total?: number) {
  mocks.lazyFetch.mockImplementation(() => {
    return {
      data: ref({ items, total: total ?? items.length }),
      status: ref('success'),
      error: ref(null),
      refresh: mocks.refresh,
    }
  })

  const wrapper = await mountSuspended(ReportsPage)

  await flushPromises()

  return wrapper
}

describe('admin artifact reports page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    mocks.lazyFetch.mockReset()
    mocks.refresh.mockReset()
    mocks.open.mockReset()
    mocks.close.mockReset()
    viewKey.value = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists reports with urgency, reason, status, title and owner',
    async () => {
      const wrapper = await mountPage([
        createReport({ id: 1, priority: 'urgent', reason: 'csam' }),
        createReport({ id: 2 }),
      ])
      const urgent = wrapper.get('[data-testid="admin-report-row-1"]')
      const normal = wrapper.get('[data-testid="admin-report-row-2"]')

      expect(urgent.find('[data-testid="admin-report-urgent"]').exists())
        .toBe(true)
      expect(urgent.text()).toContain('Child sexual abuse material')
      expect(normal.find('[data-testid="admin-report-urgent"]').exists())
        .toBe(false)
      expect(normal.text()).toContain('Phishing or fraud')
      expect(normal.text()).toContain('Open')
      expect(normal.text()).toContain('Capitals quiz')
      expect(normal.text()).toContain('owner@example.test')
      expect(wrapper.find('[data-testid="takedown-form-stub"]').exists())
        .toBe(true)
    })

  it('filters by status and goes back to the first page', async () => {
    const wrapper = await mountPage([createReport()], 45)
    const [, options] = mocks.lazyFetch.mock.calls[0]!

    expect(options.query.value).toEqual({ offset: 0, limit: 20 })

    await wrapper.findAll('button').find((button) => {
      return button.text() === 'Next'
    })!.trigger('click')

    expect(options.query.value).toEqual({ offset: 20, limit: 20 })

    await wrapper.get('[data-testid="admin-reports-status-filter"]')
      .setValue('rejected')
    await nextTick()

    expect(options.query.value).toEqual({
      status: 'rejected',
      offset: 0,
      limit: 20,
    })
  })

  it('opens the report in the side panel', async () => {
    const wrapper = await mountPage([createReport()])

    await wrapper.get('[data-testid="admin-report-row-7"]').trigger('click')

    expect(mocks.open).toHaveBeenCalledWith(expect.objectContaining({
      viewKey: 'admin-artifact-report:7',
      title: 'Report #7',
      props: { reportId: 7, onChanged: mocks.refresh },
    }))
  })

  it('shows an empty state', async () => {
    const wrapper = await mountPage([])

    expect(wrapper.get('[data-testid="admin-reports-empty"]').text())
      .toBe('No reports.')
  })
})

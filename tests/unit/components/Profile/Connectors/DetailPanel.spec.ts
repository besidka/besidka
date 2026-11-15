import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import DetailPanel from '../../../../../app/components/Profile/Connectors/DetailPanel.vue'
import type {
  ConnectorPageItem,
  ConnectorToolsListing,
} from '#shared/types/connectors.d'
import {
  createConnectorItem,
  createReviewTool,
  createToolsReview,
} from '../../../../setup/helpers/connectors-ui'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  refreshConnectors: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  connectOpen: vi.fn(),
  sidePanelClose: vi.fn(),
}))

const connector = ref<ConnectorPageItem | null>(createConnectorItem())
let listing: ConnectorToolsListing = createToolsReview()

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('refreshConnectors', () => mocks.refreshConnectors)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)
mockNuxtImport('useConnectorById', () => {
  return () => computed(() => connector.value)
})
mockNuxtImport('useConnectorConnect', () => {
  return () => ({
    targetId: ref(null),
    open: mocks.connectOpen,
    close: vi.fn(),
  })
})
mockNuxtImport('useSidePanel', () => {
  return () => ({ close: mocks.sidePanelClose })
})

async function mountPanel() {
  const wrapper = await mountSuspended(DetailPanel, {
    props: { connectorId: 'conn1' },
  })

  await flushPromises()

  return wrapper
}

function callsTo(suffix: string) {
  return mocks.fetch.mock.calls.filter(([url]) => {
    return String(url).endsWith(suffix)
  })
}

describe('Profile/Connectors/DetailPanel', () => {
  beforeEach(() => {
    connector.value = createConnectorItem({ enabled: true })
    listing = createToolsReview({
      tools: [
        createReviewTool({ name: 'search_issues' }),
        createReviewTool({
          name: 'update_issue',
          title: 'Update issue',
          readOnly: false,
          alwaysAllowed: true,
        }),
        createReviewTool({
          name: 'delete_issue',
          readOnly: false,
          alwaysAsk: true,
          enabled: false,
        }),
      ],
    })
    mocks.fetch.mockReset().mockImplementation(async (url: string) => {
      return String(url).endsWith('/tools/list') ? listing : {}
    })
    mocks.refreshConnectors.mockReset().mockResolvedValue(undefined)
    mocks.confirm.mockReset().mockResolvedValue({ label: 'OK', index: 0 })
    mocks.success.mockReset()
    mocks.error.mockReset()
    mocks.connectOpen.mockReset()
    mocks.sidePanelClose.mockReset()
  })

  it('lists the reviewed tools with the server labels, switches and the '
    + 'Always allow state as plain text', async () => {
    listing = createToolsReview({
      tools: [
        createReviewTool({
          name: 'search_issues',
          description: '<img src=x onerror=alert(1)> Search',
        }),
        createReviewTool({
          name: 'update_issue',
          title: 'Update issue',
          readOnly: false,
          alwaysAllowed: true,
        }),
      ],
    })

    const wrapper = await mountPanel()
    const tools = wrapper.findAll('[data-testid="connector-tool"]')

    expect(callsTo('/tools/list')[0]?.[1]).toEqual({ method: 'POST' })
    expect(tools).toHaveLength(2)
    expect(tools[0]!.text()).toContain('Read-only')
    expect(tools[0]!.text()).toContain('<img src=x onerror=alert(1)>')
    expect(tools[0]!.find('img').exists()).toBe(false)
    expect(tools[1]!.text()).toContain('Changes data')
    expect(tools[1]!.find('[data-testid="connector-tool-always"]').exists())
      .toBe(true)
    expect(wrapper.get('[data-testid="connector-tools-counter"]').text())
      .toContain('2 of 2 on')
  })

  it('removes an Always allow and turns a tool off', async () => {
    const wrapper = await mountPanel()

    await wrapper.get('[data-testid="connector-tool-always-remove"]')
      .trigger('click')
    await flushPromises()

    expect(callsTo('/tools/settings')[0]?.[1]).toEqual({
      method: 'POST',
      body: { tools: [{ name: 'update_issue', approval: 'ask' }] },
    })
    expect(mocks.success)
      .toHaveBeenCalledWith('Besidka asks again before this tool runs')

    const toggle = wrapper.findAll('[data-testid="connector-tool-toggle"]')[0]!

    ;(toggle.element as HTMLInputElement).checked = false
    await toggle.trigger('change')
    await flushPromises()

    expect(callsTo('/tools/settings')[1]?.[1]).toEqual({
      method: 'POST',
      body: { tools: [{ name: 'search_issues', enabled: false }] },
    })
  })

  it('shows changed tools for review and accepts them with the review '
    + 'token', async () => {
    connector.value = createConnectorItem({ status: 'drifted' })
    listing = createToolsReview({
      reviewToken: 'b'.repeat(64),
      tools: [
        createReviewTool({ name: 'search_issues' }),
        createReviewTool({
          name: 'update_issue',
          change: 'changed',
          readOnly: false,
          description: 'Now also closes issues',
        }),
        createReviewTool({ name: 'export', change: 'added' }),
      ],
      removed: ['old_tool'],
    })

    const wrapper = await mountPanel()
    const review = wrapper.get('[data-testid="connector-tool-review"]')

    expect(review.text()).toContain('Tools changed')
    expect(review.findAll('[data-testid="connector-tool-review-item"]'))
      .toHaveLength(2)
    expect(review.text()).toContain('Now also closes issues')
    expect(review.text()).toContain('New tool')
    expect(review.get('[data-testid="connector-tool-review-removed"]').text())
      .toContain('old_tool')
    expect(wrapper.findAll('[data-testid="connector-tool"]')).toHaveLength(1)
    expect(wrapper.get('[data-testid="connector-detail-toggle"]')
      .attributes('disabled')).toBeDefined()

    await review.get('[data-testid="connector-tool-review-accept"]')
      .trigger('click')
    await flushPromises()

    expect(callsTo('/tools/review')[0]?.[1]).toEqual({
      method: 'POST',
      body: { decision: 'accept', reviewToken: 'b'.repeat(64) },
    })
    expect(callsTo('/tools/list').length).toBeGreaterThan(1)
  })

  it('offers the first review with Keep disabled', async () => {
    listing = createToolsReview({
      isBaselined: false,
      tools: [createReviewTool({ change: 'new', enabled: false })],
    })

    const wrapper = await mountPanel()

    expect(wrapper.get('[data-testid="connector-tool-review"]').text())
      .toContain('Review the tools')
    expect(wrapper.find('[data-testid="connector-tools"]').exists())
      .toBe(false)

    await wrapper.get('[data-testid="connector-tool-review-keep"]')
      .trigger('click')
    await flushPromises()

    expect(callsTo('/tools/review')[0]?.[1]).toMatchObject({
      body: { decision: 'keep-disabled' },
    })
  })

  it('asks to connect when the tools cannot be listed', async () => {
    connector.value = createConnectorItem({
      consent: { state: 'withdrawn', issuerHost: null, givenAt: null },
    })
    listing = {
      state: 'unavailable',
      code: 'CONNECTOR_CONSENT_REQUIRED',
      message: 'Consent is required for this connector',
    }

    const wrapper = await mountPanel()
    const unavailable = wrapper.get(
      '[data-testid="connector-detail-tools-unavailable"]',
    )

    expect(unavailable.text()).toContain('Consent is required')
    expect(wrapper.get('[data-testid="connector-detail-consent"]').text())
      .toContain('withdrew')

    await unavailable.get('button').trigger('click')

    expect(mocks.connectOpen).toHaveBeenCalledWith('conn1')
  })

  it('withdraws the consent and deletes after a confirmation', async () => {
    const wrapper = await mountPanel()

    await wrapper.get('[data-testid="connector-detail-withdraw"]')
      .trigger('click')
    await flushPromises()

    expect(callsTo('/consent/withdraw')).toHaveLength(1)

    await wrapper.get('[data-testid="connector-detail-delete"]')
      .trigger('click')
    await flushPromises()

    expect(callsTo('/delete/bulk')[0]?.[1]).toEqual({
      method: 'POST',
      body: { ids: ['conn1'] },
    })
    expect(mocks.sidePanelClose).toHaveBeenCalled()

    mocks.confirm.mockResolvedValue(null)
    await wrapper.get('[data-testid="connector-detail-disconnect"]')
      .trigger('click')
    await flushPromises()

    expect(callsTo('/disconnect')).toHaveLength(0)
  })

  it('names the app that added the connector over MCP', async () => {
    connector.value = createConnectorItem({
      createdVia: 'mcp',
      addedByApp: 'Claude',
    })

    const wrapper = await mountPanel()

    expect(wrapper.get('[data-testid="connector-detail-added-by"]').text())
      .toContain('Added by Claude')
  })
})

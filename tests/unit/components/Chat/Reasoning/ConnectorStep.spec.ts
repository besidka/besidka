import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { ConnectorToolCallModel } from '#shared/utils/connectors-parts'
import ConnectorStep from '../../../../../app/components/Chat/Reasoning/ConnectorStep.vue'

mockNuxtImport('useConnectorLibrary', () => {
  return () => ({})
})

function createData(
  overrides: Partial<ConnectorToolCallModel> = {},
): ConnectorToolCallModel {
  return {
    slug: 'notion',
    tool: 'search',
    isRunning: false,
    outcome: 'ok',
    isFramed: true,
    input: { query: 'roadmap' },
    ...overrides,
  }
}

async function mountStep(
  data: ConnectorToolCallModel,
  options: { title?: string, pending?: boolean } = {},
) {
  return await mountSuspended(ConnectorStep, {
    props: {
      data,
      title: options.title ?? 'Used Notion · search',
      pending: options.pending ?? false,
    },
  })
}

describe('Chat/Reasoning/ConnectorStep', () => {
  it('shows the title and an Untrusted output badge for a framed result', async () => {
    const wrapper = await mountStep(createData())

    expect(wrapper.get('[data-testid="reasoning-connector-step-title"]').text())
      .toBe('Used Notion · search')

    const badge = wrapper.get('[data-testid="reasoning-connector-step-untrusted"]')

    expect(badge.text()).toBe('Untrusted output')
    expect(badge.classes()).toContain('badge-soft')
  })

  it('shows no badge when the output is not framed', async () => {
    const wrapper = await mountStep(createData({ isFramed: false }))

    expect(wrapper.find('[data-testid="reasoning-connector-step-untrusted"]')
      .exists()).toBe(false)
  })

  it('keeps the arguments in a collapsed disclosure as escaped text', async () => {
    const wrapper = await mountStep(createData({
      input: { query: '<img src=x onerror=alert(1)>' },
    }))
    const disclosure = wrapper.get(
      '[data-testid="reasoning-connector-step-arguments"]',
    )

    expect(disclosure.element.hasAttribute('open')).toBe(false)

    const text = wrapper.get(
      '[data-testid="reasoning-connector-step-arguments-text"]',
    )

    expect(text.text()).toContain('<img src=x onerror=alert(1)>')
    expect(text.element.querySelector('img')).toBeNull()
  })

  it('has no arguments disclosure for a call without arguments', async () => {
    const wrapper = await mountStep(createData({ input: {} }))

    expect(wrapper.find('[data-testid="reasoning-connector-step-arguments"]')
      .exists()).toBe(false)
  })

  it('marks a running call with a skeleton title and an ellipsis', async () => {
    const wrapper = await mountStep(
      createData({ isRunning: true, outcome: null, isFramed: false }),
      { title: 'Using Notion · search', pending: true },
    )
    const title = wrapper.get('[data-testid="reasoning-connector-step-title"]')

    expect(title.text()).toBe('Using Notion · search…')
    expect(title.classes()).toContain('skeleton')
    expect(wrapper.attributes('data-state')).toBe('running')
  })

  it('styles an error and a denial as errors', async () => {
    const failed = await mountStep(
      createData({ outcome: 'error', isFramed: false }),
      { title: 'Could not use Notion · search' },
    )
    const denied = await mountStep(
      createData({ outcome: 'denied', isFramed: false }),
      { title: 'Needs approval: Notion · search' },
    )

    expect(failed.get('[data-testid="reasoning-connector-step-title"]')
      .classes()).toContain('text-error/80')
    expect(denied.get('[data-testid="reasoning-connector-step-title"]')
      .classes()).toContain('text-error/80')
    expect(denied.attributes('data-state')).toBe('denied')
  })
})

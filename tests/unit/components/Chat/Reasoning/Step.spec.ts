import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { ReasoningStep } from '~/types/reasoning-step.d'
import Step from '../../../../../app/components/Chat/Reasoning/Step.vue'

function step(overrides: Partial<ReasoningStep> = {}): ReasoningStep {
  return {
    id: '0-0',
    title: 'Checking sources',
    body: 'Found the figure 【5†L1-L8】 in the report.',
    kind: 'reasoning',
    pending: false,
    failed: false,
    search: null,
    memory: null,
    skill: null,
    connector: null,
    ...overrides,
  }
}

async function mountStep(
  props: Partial<InstanceType<typeof Step>['$props']> = {},
) {
  return await mountSuspended(Step, {
    props: {
      step: step(),
      messageId: 'msg-1',
      isFirst: false,
      isLast: false,
      isExpanded: false,
      bodyCacheKey: 'reasoning-msg-1-0-0-ready',
      canManageGrants: false,
      ...props,
    },
    global: { stubs: { MDCCached: true } },
  })
}

describe('Chat/Reasoning/Step', () => {
  it('draws the timeline connectors only between steps', async () => {
    const first = await mountStep({ isFirst: true })
    const last = await mountStep({ isLast: true })

    expect(first.find('[data-testid="reasoning-step-connector-top"]')
      .exists()).toBe(false)
    expect(first.find('[data-testid="reasoning-step-connector-bottom"]')
      .exists()).toBe(true)
    expect(last.find('[data-testid="reasoning-step-connector-bottom"]')
      .exists()).toBe(false)
  })

  it('renders the body only while the step is expanded', async () => {
    const collapsed = await mountStep()
    const expanded = await mountStep({ isExpanded: true })
    const body = expanded.findComponent({ name: 'MDCCached' })

    expect(collapsed.findComponent({ name: 'MDCCached' }).exists())
      .toBe(false)
    expect(expanded.get('details').attributes('open')).toBeDefined()
    expect(String(body.props('value'))).toBe('Found the figure in the report.')
    expect(body.props('cacheKey')).toBe('reasoning-msg-1-0-0-ready')
  })

  it('asks the parent to toggle a step with a body', async () => {
    const wrapper = await mountStep()

    await wrapper.get('summary').trigger('click')

    expect(wrapper.emitted('toggle')?.[0]).toEqual([step()])
  })

  it('shows the spinner of a pending step in the accent color', async () => {
    const wrapper = await mountStep({ step: step({ pending: true }) })

    expect(wrapper.get('svg').classes()).toContain('text-accent')
  })

  it('offers Manage on a grant marker only with a chat controller',
    async () => {
      const grantStep = step({
        body: '',
        kind: 'tool',
        grantMarker: 'Ran without asking (Always allowed)',
      })
      const withController = await mountStep({
        step: grantStep,
        canManageGrants: true,
      })
      const withoutController = await mountStep({ step: grantStep })

      await withController.get('[data-testid="reasoning-grant-manage"]')
        .trigger('click')

      expect(withController.emitted('manage-grants')).toHaveLength(1)
      expect(withoutController.find('[data-testid="reasoning-grant-manage"]')
        .exists()).toBe(false)
    })

  it('sends the Manage link of a memory save to the Memory page', async () => {
    const memoryStep = step({
      body: '',
      kind: 'tool',
      grantMarker: 'Ran without asking (Always allowed)',
      memory: {
        toolName: 'memory_write',
        state: 'output-available',
        entries: [],
        errorReason: '',
      } as never,
    })
    const wrapper = await mountStep({ step: memoryStep, canManageGrants: true })
    const link = wrapper.get('[data-testid="reasoning-grant-manage-memory"]')

    expect(link.attributes('to')).toBe('/profile/memory')
    expect(wrapper.find('[data-testid="reasoning-grant-manage"]').exists())
      .toBe(false)
  })
})

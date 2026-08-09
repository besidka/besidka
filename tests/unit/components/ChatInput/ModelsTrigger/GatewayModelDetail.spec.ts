import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { GatewayModel } from '#shared/types/gateways.d'
import GatewayModelDetail
  from '../../../../../app/components/ChatInput/ModelsTrigger/GatewayModelDetail.vue'

function createModel(overrides: Partial<GatewayModel> = {}): GatewayModel {
  return {
    id: 'anthropic/claude-opus-5',
    name: 'Claude Opus 5',
    description: 'Flagship reasoning model',
    contextLength: 200_000,
    pricing: { input: '0.0000025', output: '0.00001' },
    ...overrides,
  }
}

function mountDetail(model: GatewayModel = createModel()) {
  return mountSuspended(GatewayModelDetail, {
    props: { model, gatewayLabel: 'OpenRouter' },
  })
}

function getCapabilityLabels(wrapper: Awaited<ReturnType<typeof mountDetail>>) {
  return wrapper
    .findAll('[data-testid="gateway-model-detail-capabilities"] .badge')
    .map((badge) => {
      return badge.text()
    })
}

describe('ChatInput/ModelsTrigger/GatewayModelDetail', () => {
  it('lists confirmed reasoning and web search ahead of tool calling',
    async () => {
      const wrapper = await mountDetail(createModel({
        supportsReasoning: true,
        supportsWebSearch: true,
        supportsTools: true,
      }))

      expect(getCapabilityLabels(wrapper))
        .toEqual(['Reasoning', 'Web search', 'Tool calling'])
    })

  it('keeps tool calling here even though the row drops it', async () => {
    const wrapper = await mountDetail(createModel({ supportsTools: true }))

    expect(getCapabilityLabels(wrapper)).toEqual(['Tool calling'])
  })

  it('never asserts an unreported capability', async () => {
    const wrapper = await mountDetail(createModel({
      supportsReasoning: undefined,
      supportsWebSearch: undefined,
    }))

    expect(getCapabilityLabels(wrapper)).not.toContain('Reasoning')
    expect(getCapabilityLabels(wrapper)).not.toContain('Web search')
  })

  it('never asserts a capability reported as absent', async () => {
    const wrapper = await mountDetail(createModel({
      supportsReasoning: false,
      supportsWebSearch: false,
    }))

    expect(wrapper.find('[data-testid="gateway-model-detail-capabilities"]')
      .exists()).toBe(false)
  })

  it('keeps the spelled-out price in the spec rows', async () => {
    const wrapper = await mountDetail()

    expect(wrapper.get('[data-testid="gateway-model-detail-specs"]').text())
      .toContain('$2.50 in / $10.00 out per 1M tokens')
  })
})

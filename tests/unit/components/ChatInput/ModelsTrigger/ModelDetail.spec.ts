import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { VueWrapper } from '@vue/test-utils'
import type { Model } from '#shared/types/providers.d'
import ModelDetail
  from '../../../../../app/components/ChatInput/ModelsTrigger/ModelDetail.vue'

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    description: 'Flagship chat model',
    contextLength: 400_000,
    maxOutputTokens: 128_000,
    releaseDate: '2026-05-01',
    price: {
      tokens: 1_000_000,
      input: 'from $2.50',
      output: 'from $15.00',
    },
    priceTier: '$$',
    modalities: {
      input: ['text', 'image'],
      output: ['text'],
    },
    tools: [],
    ...overrides,
  }
}

function mountDetail(
  model: Model = createModel(),
  props: Partial<{ providerName: string, isInteractive: boolean }> = {},
) {
  return mountSuspended(ModelDetail, {
    props: {
      model,
      providerName: 'OpenAI',
      isInteractive: false,
      ...props,
    },
  })
}

function readSpecs(wrapper: VueWrapper): Record<string, string> {
  const specs = wrapper.get('[data-testid="model-detail-specs"]')
  const values = specs.findAll('dd')

  return Object.fromEntries(specs.findAll('dt').map((label, index) => {
    return [label.text(), values[index]?.text() ?? '']
  }))
}

function readSpecLabels(wrapper: VueWrapper): string[] {
  return wrapper.get('[data-testid="model-detail-specs"]')
    .findAll('dt')
    .map((label) => {
      return label.text()
    })
}

describe('ChatInput/ModelsTrigger/ModelDetail', () => {
  it('exposes the panel as a region keyed by the model id', async () => {
    const wrapper = await mountDetail()
    const panel = wrapper.get('[data-testid="model-detail-panel"]')

    expect(panel.attributes('id')).toBe('model-detail-gpt-5.4')
    expect(panel.attributes('role')).toBe('region')
    expect(panel.attributes('aria-label')).toBe('GPT-5.4 details')
  })

  it('renders the name, description and price tier badge', async () => {
    const wrapper = await mountDetail()

    expect(wrapper.get('h3').text()).toBe('GPT-5.4')
    expect(wrapper.text()).toContain('Flagship chat model')
    expect(wrapper.get('.badge-info').text()).toBe('$$')
  })

  it('badges a deprecated model in the header', async () => {
    const wrapper = await mountDetail(createModel({ status: 'deprecated' }))
    const badge = wrapper.get('[data-testid="model-detail-deprecated-badge"]')

    expect(badge.text()).toBe('Deprecated')
  })

  it('omits the deprecated badge for a supported model', async () => {
    const wrapper = await mountDetail()

    expect(
      wrapper.find('[data-testid="model-detail-deprecated-badge"]').exists(),
    ).toBe(false)
  })

  it('flows inline instead of overlaying the model list', async () => {
    const wrapper = await mountDetail()
    const panel = wrapper.get('[data-testid="model-detail-panel"]')

    expect(panel.classes()).not.toContain('absolute')
    expect(panel.classes()).not.toContain('bottom-0')
  })

  it('omits the description paragraph when the model has none', async () => {
    const wrapper = await mountDetail(createModel({ description: '' }))

    expect(wrapper.find('p').exists()).toBe(false)
  })

  it('renders a capability badge for each declared capability', async () => {
    const model = createModel({
      tools: ['web_search', 'image_generation'],
      reasoning: { mode: 'toggle' },
      research: {
        tier: 'quick',
        assistModel: 'gpt-5.4-nano',
        costEstimate: '~$1 / task',
        timeEstimate: '5–15 min',
      },
    })
    const wrapper = await mountDetail(model)
    const badges = wrapper
      .get('[data-testid="model-detail-capabilities"]')
      .findAll('.badge-soft')
      .map((badge) => {
        return badge.text()
      })

    expect(badges).toEqual([
      'Reasoning',
      'Web search',
      'Image generation',
      'Deep research',
    ])
  })

  it('renders no capability badges for a plain model', async () => {
    const wrapper = await mountDetail()

    expect(wrapper.find('[data-testid="model-detail-capabilities"]').exists())
      .toBe(false)
  })

  it('lists the full spec table for a regular model', async () => {
    const wrapper = await mountDetail()

    expect(readSpecs(wrapper)).toEqual({
      'Provider': 'OpenAI',
      'Context': '400,000 tokens',
      'Max output': '128,000 tokens',
      'Input': 'text, image',
      'Output': 'text',
      'Price': 'from $2.50 in / from $15.00 out per 1M tokens',
      'Added on': 'May 2026',
    })
  })

  it('drops the token rows for a model that reports zero limits', async () => {
    const model = createModel({
      id: 'gpt-image-2',
      name: 'GPT Image 2',
      contextLength: 0,
      maxOutputTokens: 0,
      imageGeneration: { controllerModel: 'gpt-5-nano' },
      price: {
        tokens: 1_000_000,
        input: '$10.00',
        output: '$40.00',
        display: '$0.04 / medium image',
      },
      modalities: { input: ['text', 'image'], output: ['image'] },
    })
    const wrapper = await mountDetail(model)
    const labels = readSpecLabels(wrapper)

    expect(labels).not.toContain('Context')
    expect(labels).not.toContain('Max output')
    expect(readSpecs(wrapper).Price).toBe('$0.04 / medium image')
  })

  it('drops the release row for a model without a release date', async () => {
    const wrapper = await mountDetail(createModel({ releaseDate: undefined }))

    expect(readSpecLabels(wrapper)).not.toContain('Added on')
  })

  it('drops the modality rows when the model declares none', async () => {
    const wrapper = await mountDetail(createModel({
      modalities: { input: [], output: [] },
    }))
    const labels = readSpecLabels(wrapper)

    expect(labels).not.toContain('Input')
    expect(labels).not.toContain('Output')
  })

  it('falls back to the input price alone when there is no output price', async () => {
    const wrapper = await mountDetail(createModel({
      price: { tokens: 1_000_000, input: '$0.10', output: '' },
    }))

    expect(readSpecs(wrapper).Price).toBe('$0.10')
  })

  it('renders a dash when the model has no price at all', async () => {
    const wrapper = await mountDetail(createModel({
      price: { tokens: 1_000_000, input: '', output: '' },
    }))

    expect(readSpecs(wrapper).Price).toBe('—')
  })

  it('lists the reasoning levels for a model that exposes them', async () => {
    const wrapper = await mountDetail(createModel({
      reasoning: { mode: 'levels', levels: ['low', 'medium', 'high'] },
    }))

    expect(readSpecs(wrapper)['Reasoning levels']).toBe('low, medium, high')
  })

  it('omits the reasoning levels row for a toggle-only model', async () => {
    const wrapper = await mountDetail(createModel({
      reasoning: { mode: 'toggle' },
    }))

    expect(readSpecLabels(wrapper)).not.toContain('Reasoning levels')
  })

  it('lists the research cost and time estimates', async () => {
    const wrapper = await mountDetail(createModel({
      research: {
        tier: 'thorough',
        assistModel: 'gpt-5.4-nano',
        costEstimate: '~$5 / task',
        timeEstimate: '20–40 min',
      },
    }))
    const specs = readSpecs(wrapper)

    expect(specs['Research cost']).toBe('~$5 / task')
    expect(specs['Research time']).toBe('20–40 min')
  })

  it('opens the detail on hover while the panel is not interactive', async () => {
    const wrapper = await mountDetail()
    const panel = wrapper.get('[data-testid="model-detail-panel"]')

    expect(wrapper.find('button[aria-label="Close model details"]').exists())
      .toBe(false)

    await panel.trigger('mouseenter')

    expect(wrapper.emitted('showDetail')).toHaveLength(1)
    expect(wrapper.emitted('hideDetail')).toBeUndefined()

    await panel.trigger('mouseleave')

    expect(wrapper.emitted('hideDetail')).toHaveLength(1)
    expect(wrapper.emitted('showDetail')).toHaveLength(1)
  })

  it('offers a close button and ignores hover when interactive', async () => {
    const wrapper = await mountDetail(createModel(), { isInteractive: true })
    const panel = wrapper.get('[data-testid="model-detail-panel"]')

    await panel.trigger('mouseenter')
    await panel.trigger('mouseleave')

    expect(wrapper.emitted('showDetail')).toBeUndefined()
    expect(wrapper.emitted('hideDetail')).toBeUndefined()

    await wrapper.get('button[aria-label="Close model details"]')
      .trigger('click')

    expect(wrapper.emitted('close')).toEqual([[]])
  })
})

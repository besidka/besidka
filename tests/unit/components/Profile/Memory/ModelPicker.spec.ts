import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayModel } from '#shared/types/gateways.d'
import type { Model } from '#shared/types/providers.d'
import ModelPicker from '../../../../../app/components/Profile/Memory/ModelPicker.client.vue'

const mocks = vi.hoisted(() => ({
  prepareOpen: vi.fn(),
  panelProps: [] as Array<Record<string, unknown>>,
  emitSelect: null as null | ((payload: unknown) => void),
  emitClose: null as null | ((payload: unknown) => void),
}))

const PanelStub = defineComponent({
  props: [
    'isOpen',
    'selectedModelId',
    'selectedGatewayId',
    'filterModel',
    'filterGatewayModel',
    'recommendedModelIds',
  ],
  emits: ['select', 'close'],
  setup(props, { emit, expose }) {
    mocks.panelProps.push(props as Record<string, unknown>)
    mocks.emitSelect = payload => emit('select', payload)
    mocks.emitClose = payload => emit('close', payload)
    expose({ prepareOpen: mocks.prepareOpen })

    return () => h('div', { 'data-testid': 'panel-stub' })
  },
})

enableAutoUnmount(afterEach)

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'text-model',
    name: 'Text model',
    description: 'A text model',
    contextLength: 1000,
    maxOutputTokens: 100,
    price: { tokens: 1000000, input: '1', output: '2' },
    priceTier: '$',
    modalities: { input: ['text'], output: ['text'] },
    tools: [],
    toolCall: true,
    ...overrides,
  }
}

async function mountPicker(
  modelValue: { model: string, gateway: 'openrouter' | null } | null = null,
) {
  const onUpdate = vi.fn()
  const wrapper = await mountSuspended(ModelPicker, {
    props: {
      'label': 'Profile memory model',
      modelValue,
      'recommendedModelIds': ['recommended-model'],
      'onUpdate:modelValue': onUpdate,
    },
    global: {
      stubs: {
        ChatInputModelsTriggerPanel: PanelStub,
        Teleport: true,
      },
    },
  })

  return { wrapper, onUpdate }
}

describe('Profile/Memory/ModelPicker', () => {
  beforeEach(() => {
    mocks.prepareOpen.mockReset()
    mocks.panelProps.length = 0
    mocks.emitSelect = null
    mocks.emitClose = null
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows Same as chat checked and no model trigger by default', async () => {
    const { wrapper } = await mountPicker()
    const sameAsChat = wrapper.get<HTMLInputElement>(
      '[data-testid="memory-model-same-as-chat"]',
    )
    const specific = wrapper.get<HTMLInputElement>(
      '[data-testid="memory-model-specific"]',
    )

    expect(sameAsChat.element.checked).toBe(true)
    expect(specific.element.checked).toBe(false)
    expect(wrapper.find('[data-testid="memory-model-trigger"]').exists())
      .toBe(false)
    expect(wrapper.text()).toContain('Same as chat')
  })

  it('opens the sheet when A specific model is selected', async () => {
    const { wrapper, onUpdate } = await mountPicker()

    await wrapper.get('[data-testid="memory-model-specific"]')
      .trigger('change')
    await flushAsync()

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    expect(mocks.prepareOpen).toHaveBeenCalledOnce()
    expect(mocks.panelProps.at(-1)?.isOpen).toBe(true)
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('stores the model chosen in the panel', async () => {
    const { wrapper, onUpdate } = await mountPicker()

    await wrapper.get('[data-testid="memory-model-specific"]')
      .trigger('change')
    await flushAsync()

    mocks.emitSelect?.({ modelId: 'vendor/model', gatewayId: 'openrouter' })
    await flushAsync()

    expect(onUpdate).toHaveBeenCalledWith({
      model: 'vendor/model',
      gateway: 'openrouter',
    })
    expect(HTMLDialogElement.prototype.close).toHaveBeenCalled()
    expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
  })

  it('keeps the value null when the sheet closes without a pick', async () => {
    const { wrapper, onUpdate } = await mountPicker()

    await wrapper.get('[data-testid="memory-model-specific"]')
      .trigger('change')
    await flushAsync()

    mocks.emitClose?.({ restoreFocus: true })
    await flushAsync()

    const sameAsChat = wrapper.get<HTMLInputElement>(
      '[data-testid="memory-model-same-as-chat"]',
    )

    expect(onUpdate).not.toHaveBeenCalled()
    expect(sameAsChat.element.checked).toBe(true)
    expect(wrapper.get<HTMLInputElement>(
      '[data-testid="memory-model-specific"]',
    ).element.checked).toBe(false)
  })

  it('shows the chosen model and reopens the sheet from the trigger',
    async () => {
      const { wrapper } = await mountPicker({
        model: 'vendor/model',
        gateway: 'openrouter',
      })
      const trigger = wrapper.get('[data-testid="memory-model-trigger"]')

      expect(trigger.text()).toContain('vendor/model')
      expect(wrapper.get<HTMLInputElement>(
        '[data-testid="memory-model-specific"]',
      ).element.checked).toBe(true)

      await trigger.trigger('click')
      await flushAsync()

      expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
      expect(mocks.panelProps.at(-1)?.selectedModelId).toBe('vendor/model')
      expect(mocks.panelProps.at(-1)?.selectedGatewayId).toBe('openrouter')
    })

  it('emits null when Same as chat is chosen', async () => {
    const { wrapper, onUpdate } = await mountPicker({
      model: 'vendor/model',
      gateway: 'openrouter',
    })

    await wrapper.get('[data-testid="memory-model-same-as-chat"]')
      .trigger('change')

    expect(onUpdate).toHaveBeenCalledWith(null)
  })

  it('passes filters that hide image-output models to the panel', async () => {
    const { wrapper } = await mountPicker()

    await wrapper.get('[data-testid="memory-model-specific"]')
      .trigger('change')
    await flushAsync()

    const props = mocks.panelProps.at(-1) as {
      filterModel: (model: Model) => boolean
      filterGatewayModel: (model: GatewayModel) => boolean
      recommendedModelIds: string[]
    }
    const imageModel = createModel({
      modalities: { input: ['text'], output: ['image'] },
    })
    const gatewayImageModel: GatewayModel = {
      id: 'vendor/image',
      name: 'Image',
      toolCall: false,
      supportsImageGeneration: true,
    }

    expect(props.filterModel(createModel())).toBe(true)
    expect(props.filterModel(imageModel)).toBe(false)
    expect(props.filterGatewayModel(gatewayImageModel)).toBe(false)
    expect(props.recommendedModelIds).toEqual(['recommended-model'])
  })
})

async function flushAsync() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

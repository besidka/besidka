import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { parseError } from 'evlog'
import { defineComponent, h } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemorySettingsFields } from '../../../../../shared/types/memory.d'
import * as messagesComposable from '../../../../../app/composables/messages'
import Models from '../../../../../app/components/Profile/Memory/Models.vue'

const mocks = vi.hoisted(() => ({
  panels: [] as Array<{
    props: Record<string, unknown>
    emitSelect: (payload: unknown) => void
  }>,
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
    mocks.panels.push({
      props: props as Record<string, unknown>,
      emitSelect: payload => emit('select', payload),
    })
    expose({ prepareOpen: vi.fn() })

    return () => h('div', { 'data-testid': 'panel-stub' })
  },
})

enableAutoUnmount(afterEach)

const defaultSettings: MemorySettingsFields = {
  memoryEnabled: true,
  memoryExtractionEnabled: false,
  chatSearchEnabled: true,
  memoryIncludeSensitive: false,
  aboutMe: null,
  profileMemoryModel: null,
  profileMemoryGateway: null,
  projectMemoryModel: null,
  projectMemoryGateway: null,
}

const save = vi.fn()

async function mountModels(settings: Partial<MemorySettingsFields> = {}) {
  const wrapper = await mountSuspended(Models, {
    props: {
      settings: { ...defaultSettings, ...settings },
      save,
    },
    global: {
      stubs: {
        ChatInputModelsTriggerPanel: PanelStub,
        Teleport: true,
      },
    },
  })

  await flushPromises()

  return wrapper
}

function sameAsChatRadios(wrapper: Awaited<ReturnType<typeof mountModels>>) {
  return wrapper.findAll<HTMLInputElement>(
    '[data-testid="memory-model-same-as-chat"]',
  )
}

function specificRadios(wrapper: Awaited<ReturnType<typeof mountModels>>) {
  return wrapper.findAll<HTMLInputElement>(
    '[data-testid="memory-model-specific"]',
  )
}

describe('Profile/Memory/Models', () => {
  beforeEach(() => {
    mocks.panels.length = 0
    save.mockReset()
    save.mockResolvedValue({ ok: true, result: {} })
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

  it('renders a profile and a project picker', async () => {
    const wrapper = await mountModels()

    expect(sameAsChatRadios(wrapper)).toHaveLength(2)
    expect(sameAsChatRadios(wrapper).every(radio => radio.element.checked))
      .toBe(true)
    expect(wrapper.text()).toContain('Profile memory model')
    expect(wrapper.text()).toContain('Project memory model')
  })

  it('shows the saved choices on the picker triggers', async () => {
    const wrapper = await mountModels({
      profileMemoryModel: 'vendor/profile-model',
      profileMemoryGateway: 'openrouter',
      projectMemoryModel: 'vendor/project-model',
      projectMemoryGateway: 'openrouter',
    })
    const triggers = wrapper.findAll('[data-testid="memory-model-trigger"]')

    expect(triggers).toHaveLength(2)
    expect(triggers[0]!.text()).toContain('vendor/profile-model')
    expect(triggers[1]!.text()).toContain('vendor/project-model')
  })

  it('recommends the models flagged for project memory', async () => {
    const wrapper = await mountModels()
    const expectedIds = getProviders().providers.flatMap((provider) => {
      return provider.models
        .filter(model => model.forProjectMemory)
        .map(model => model.id)
    })

    await specificRadios(wrapper)[0]!.trigger('change')
    await flushPromises()

    expect(expectedIds.length).toBeGreaterThan(0)
    expect(mocks.panels.at(-1)?.props.recommendedModelIds)
      .toEqual(expectedIds)
  })

  it('saves the profile choice picked in the panel', async () => {
    const wrapper = await mountModels()

    await specificRadios(wrapper)[0]!.trigger('change')
    await flushPromises()

    mocks.panels.at(-1)?.emitSelect({
      modelId: 'vendor/model',
      gatewayId: 'openrouter',
    })
    await flushPromises()

    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith({
      profileMemoryModel: 'vendor/model',
      profileMemoryGateway: 'openrouter',
    })
  })

  it('saves the project choice picked in the panel', async () => {
    const wrapper = await mountModels()

    await specificRadios(wrapper)[1]!.trigger('change')
    await flushPromises()

    mocks.panels.at(-1)?.emitSelect({
      modelId: 'vendor/model',
      gatewayId: null,
    })
    await flushPromises()

    expect(save).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledWith({
      projectMemoryModel: 'vendor/model',
      projectMemoryGateway: null,
    })
  })

  it('saves null model and gateway for Same as chat on profile', async () => {
    const wrapper = await mountModels({
      profileMemoryModel: 'vendor/model',
      profileMemoryGateway: 'openrouter',
    })

    await sameAsChatRadios(wrapper)[0]!.trigger('change')
    await flushPromises()

    expect(save).toHaveBeenCalledWith({
      profileMemoryModel: null,
      profileMemoryGateway: null,
    })
  })

  it('saves null model and gateway for Same as chat on project', async () => {
    const wrapper = await mountModels({
      projectMemoryModel: 'vendor/model',
      projectMemoryGateway: 'openrouter',
    })

    await sameAsChatRadios(wrapper)[1]!.trigger('change')
    await flushPromises()

    expect(save).toHaveBeenCalledWith({
      projectMemoryModel: null,
      projectMemoryGateway: null,
    })
  })

  it('shows a toast when saving a choice fails', async () => {
    const useErrorMessage = vi.spyOn(messagesComposable, 'useErrorMessage')
    const wrapper = await mountModels({
      profileMemoryModel: 'vendor/model',
      profileMemoryGateway: null,
    })

    save.mockResolvedValue({
      ok: false,
      parsed: parseError(Object.assign(new Error('Request failed'), {
        data: {
          statusCode: 400,
          message: 'Model not allowed',
          data: { why: 'No key for this provider.' },
        },
      })),
    })

    await sameAsChatRadios(wrapper)[0]!.trigger('change')
    await flushPromises()

    expect(useErrorMessage).toHaveBeenCalledWith(
      'Model not allowed',
      'No key for this provider.',
    )
  })
})

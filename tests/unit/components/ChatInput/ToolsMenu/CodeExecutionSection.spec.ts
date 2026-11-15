import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CodeExecutionSection from '../../../../../app/components/ChatInput/ToolsMenu/CodeExecutionSection.vue'

const mocks = vi.hoisted(() => ({
  publicConfig: {} as Record<string, string>,
}))

mockNuxtImport('useRuntimeConfig', () => {
  return () => ({
    app: { baseURL: '/' },
    public: { ...mocks.publicConfig },
  })
})

enableAutoUnmount(afterEach)

const storedValues = new Map<string, string>()

function mountSection(props: {
  isEnabled?: boolean
  providerId?: string | null
} = {}) {
  return mountSuspended(CodeExecutionSection, {
    props: {
      isEnabled: false,
      providerId: 'anthropic',
      ...props,
    },
  })
}

beforeEach(() => {
  storedValues.clear()
  mocks.publicConfig = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storedValues.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storedValues.set(key, value)
    },
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ChatInput/ToolsMenu/CodeExecutionSection', () => {
  it('renders a Run code switch with the label and hint', async () => {
    const wrapper = await mountSection()
    const toggle = wrapper.get('[data-testid="tools-code-execution-toggle"]')

    expect(toggle.attributes('role')).toBe('switch')
    expect(toggle.attributes('aria-label')).toBe('Run code')
    expect((toggle.element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.text()).toContain('Run code')
    expect(wrapper.text()).toContain('For the next message only')
    expect(wrapper.get('[data-section="code"]').exists()).toBe(true)
  })

  it('reflects the enabled state', async () => {
    const wrapper = await mountSection({ isEnabled: true })

    expect((wrapper.get('[data-testid="tools-code-execution-toggle"]')
      .element as HTMLInputElement).checked).toBe(true)
  })

  it('asks for confirmation the first time and does not turn on yet',
    async () => {
      const wrapper = await mountSection({ providerId: 'openai' })

      await wrapper.get('[data-testid="tools-code-execution-toggle"]')
        .setValue(true)

      expect(wrapper.emitted('toggle')).toBeUndefined()
      expect(wrapper.get('[data-testid="code-execution-confirm"]').exists())
        .toBe(true)
      expect(wrapper.get('[data-testid="code-execution-note"]').text())
        .toContain('Runs in OpenAI\'s sandbox on your API key.')
    })

  it('turns on and remembers the provider after Turn on', async () => {
    const wrapper = await mountSection({ providerId: 'openai' })

    await wrapper.get('[data-testid="tools-code-execution-toggle"]')
      .setValue(true)
    await wrapper.get('[data-testid="code-execution-confirm-accept"]')
      .trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([[true]])
    expect(storedValues.get('besidka:code-execution-confirmed:openai'))
      .toBe('true')
  })

  it('keeps the tool off after Not now and asks again next time',
    async () => {
      const wrapper = await mountSection({ providerId: 'openai' })
      const toggle = wrapper.get('[data-testid="tools-code-execution-toggle"]')

      await toggle.setValue(true)
      await wrapper.get('[data-testid="code-execution-confirm-cancel"]')
        .trigger('click')

      expect(wrapper.emitted('toggle')).toBeUndefined()
      expect(storedValues.size).toBe(0)
      expect((toggle.element as HTMLInputElement).checked).toBe(false)

      await toggle.setValue(true)

      expect(wrapper.emitted('toggle')).toBeUndefined()
    })

  it('turns on straight away once the provider was confirmed', async () => {
    storedValues.set('besidka:code-execution-confirmed:google', 'true')

    const wrapper = await mountSection({ providerId: 'google' })

    await wrapper.get('[data-testid="tools-code-execution-toggle"]')
      .setValue(true)

    expect(wrapper.emitted('toggle')).toEqual([[true]])
  })

  it('confirms per provider', async () => {
    storedValues.set('besidka:code-execution-confirmed:google', 'true')

    const wrapper = await mountSection({ providerId: 'anthropic' })

    await wrapper.get('[data-testid="tools-code-execution-toggle"]')
      .setValue(true)

    expect(wrapper.emitted('toggle')).toBeUndefined()
  })

  it('turns off without confirmation', async () => {
    const wrapper = await mountSection({ isEnabled: true })

    await wrapper.get('[data-testid="tools-code-execution-toggle"]')
      .setValue(false)

    expect(wrapper.emitted('toggle')).toEqual([[false]])
  })

  it('still works when storage is blocked', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })

    const wrapper = await mountSection({ providerId: 'google' })

    await wrapper.get('[data-testid="tools-code-execution-toggle"]')
      .setValue(true)
    await wrapper.get('[data-testid="code-execution-confirm-accept"]')
      .trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([[true]])
  })

  it('toggles the price note from the info button', async () => {
    mocks.publicConfig = {
      anthropicCodeExecutionCostPerHourUsd: '0.05',
      anthropicCodeExecutionFreeHoursPerMonth: '1550',
    }

    const wrapper = await mountSection({ providerId: 'anthropic' })
    const info = wrapper.get('[data-testid="code-execution-info"]')

    expect(info.attributes('aria-expanded')).toBe('false')

    await info.trigger('click')

    expect(info.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('[data-testid="code-execution-note"]').text())
      .toContain('$0.05 per hour after 1,550 free hours a month')
    expect(wrapper.get('[data-testid="code-execution-note"]').text())
      .toContain('Besidka never executes it.')
  })

  it('omits prices that are not configured', async () => {
    const wrapper = await mountSection({ providerId: 'openai' })

    await wrapper.get('[data-testid="code-execution-info"]').trigger('click')

    expect(wrapper.get('[data-testid="code-execution-note"]').text())
      .toContain('(see your provider\'s pricing)')
  })
})

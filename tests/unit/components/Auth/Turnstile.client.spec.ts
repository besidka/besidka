import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AuthTurnstile from '../../../../app/components/Auth/Turnstile.client.vue'

const mocks = vi.hoisted(() => ({
  isEnabled: true,
  renderWidget: vi.fn(async () => 'widget-1'),
  execute: vi.fn(async () => 'token-123'),
  reset: vi.fn(),
  remove: vi.fn(),
}))

mockNuxtImport('useTurnstile', () => {
  return () => ({
    isEnabled: computed(() => mocks.isEnabled),
    renderWidget: mocks.renderWidget,
    execute: mocks.execute,
    reset: mocks.reset,
    remove: mocks.remove,
  })
})

describe('Auth/Turnstile.client', () => {
  beforeEach(() => {
    mocks.isEnabled = true
    mocks.renderWidget.mockClear()
    mocks.execute.mockClear()
    mocks.reset.mockClear()
    mocks.remove.mockClear()
  })

  it('renders no DOM when disabled', async () => {
    mocks.isEnabled = false

    const wrapper = await mountSuspended(AuthTurnstile, {
      props: { action: 'auth' },
    })

    await flushPromises()

    expect(wrapper.find('div').exists()).toBe(false)
    expect(mocks.renderWidget).not.toHaveBeenCalled()
  })

  it('renders the widget container and exposes execute/reset when enabled', async () => {
    const wrapper = await mountSuspended(AuthTurnstile, {
      props: { action: 'auth' },
    })

    await flushPromises()

    expect(wrapper.find('div').exists()).toBe(true)
    expect(mocks.renderWidget).toHaveBeenCalledTimes(1)

    const token = await (wrapper.vm as any).execute()

    expect(mocks.execute).toHaveBeenCalledWith('widget-1')
    expect(token).toBe('token-123')
    ;(wrapper.vm as any).reset()

    expect(mocks.reset).toHaveBeenCalledWith('widget-1')
  })

  it('renders without a widget when the script fails to load, without throwing', async () => {
    mocks.renderWidget.mockResolvedValueOnce(null)

    const wrapper = await mountSuspended(AuthTurnstile, {
      props: { action: 'auth' },
    })

    await flushPromises()

    expect(wrapper.find('div').exists()).toBe(true)

    const token = await (wrapper.vm as any).execute()

    expect(token).toBe('')
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})

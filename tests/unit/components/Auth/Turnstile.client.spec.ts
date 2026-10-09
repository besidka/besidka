import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AuthTurnstile from '../../../../app/components/Auth/Turnstile.client.vue'

const mocks = vi.hoisted(() => ({
  isEnabled: true,
  renderWidget: vi.fn(async (_el: HTMLElement, _options: any) => 'widget-1'),
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

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function stubContainerWidth(width: number) {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get')
      .mockReturnValue(width)
  }

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

  it('keeps the container mounted but visually collapsed until interaction is required', async () => {
    const wrapper = await mountSuspended(AuthTurnstile, {
      props: { action: 'auth' },
    })

    await flushPromises()

    const widgetWrapper = wrapper.get('[data-testid="turnstile-wrapper"]')

    expect(wrapper.find('[data-testid="turnstile-container"]').exists())
      .toBe(true)
    expect(widgetWrapper.attributes('data-interactive')).toBe('false')
    expect(widgetWrapper.classes()).toContain('grid-rows-[0fr]')
    expect(widgetWrapper.classes()).toContain('opacity-0')
    expect(widgetWrapper.attributes('aria-hidden')).toBe('true')
  })

  it('reveals and hides the wrapper through the interactive callbacks', async () => {
    const wrapper = await mountSuspended(AuthTurnstile, {
      props: { action: 'auth' },
    })

    await flushPromises()

    const { onInteractiveChange } = mocks.renderWidget.mock.calls[0]![1]
    const widgetWrapper = wrapper.get('[data-testid="turnstile-wrapper"]')

    onInteractiveChange(true)
    await nextTick()

    expect(widgetWrapper.attributes('data-interactive')).toBe('true')
    expect(widgetWrapper.classes()).toContain('grid-rows-[1fr]')
    expect(widgetWrapper.classes()).not.toContain('opacity-0')
    expect(widgetWrapper.attributes('aria-hidden')).toBe('false')

    onInteractiveChange(false)
    await nextTick()

    expect(widgetWrapper.attributes('data-interactive')).toBe('false')
    expect(widgetWrapper.classes()).toContain('grid-rows-[0fr]')
  })

  it('collapses the wrapper again when the widget is reset', async () => {
    const wrapper = await mountSuspended(AuthTurnstile, {
      props: { action: 'auth' },
    })

    await flushPromises()
    mocks.renderWidget.mock.calls[0]![1].onInteractiveChange(true)
    await nextTick()
    ;(wrapper.vm as any).reset()
    await nextTick()

    expect(wrapper.get('[data-testid="turnstile-wrapper"]')
      .attributes('data-interactive')).toBe('false')
  })

  it('makes the collapsed wrapper inert so the hidden iframe is not tabbable', async () => {
    const wrapper = await mountSuspended(AuthTurnstile, {
      props: { action: 'auth' },
    })

    await flushPromises()

    const widgetWrapper = wrapper.get('[data-testid="turnstile-wrapper"]')

    expect(widgetWrapper.attributes('inert')).toBeDefined()

    mocks.renderWidget.mock.calls[0]![1].onInteractiveChange(true)
    await nextTick()

    expect(widgetWrapper.attributes('inert')).toBeUndefined()
  })

  it('passes the flexible size and keeps the frame full width when the container is wide', async () => {
    stubContainerWidth(400)

    const wrapper = await mountSuspended(AuthTurnstile, {
      props: { action: 'auth' },
    })

    await flushPromises()

    const frame = wrapper.get('[data-testid="turnstile-container"]')
      .element.parentElement!

    expect(mocks.renderWidget.mock.calls[0]![1].size).toBe('flexible')
    expect(frame.classList.contains('w-full')).toBe(true)
    expect(frame.classList.contains('w-fit')).toBe(false)
  })

  it('passes the compact size and shrinks the frame when the container is narrow', async () => {
    stubContainerWidth(238)

    const wrapper = await mountSuspended(AuthTurnstile, {
      props: { action: 'auth' },
    })

    await flushPromises()

    const frame = wrapper.get('[data-testid="turnstile-container"]')
      .element.parentElement!

    expect(mocks.renderWidget.mock.calls[0]![1].size).toBe('compact')
    expect(frame.classList.contains('w-fit')).toBe(true)
    expect(frame.classList.contains('mx-auto')).toBe(true)
    expect(frame.classList.contains('w-full')).toBe(false)
  })
})

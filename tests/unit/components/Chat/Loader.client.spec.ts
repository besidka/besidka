import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Loader from '../../../../app/components/Chat/Loader.client.vue'

describe('Chat/Loader', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-20T20:39:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows only the loader when nothing waits', async () => {
    const wrapper = await mountSuspended(Loader, { props: { show: true } })

    expect(wrapper.find('[data-testid="chat-loader-waiting"]').exists())
      .toBe(false)
    expect(wrapper.text()).toContain('Loading')
  })

  it('counts the wait for the previous reply and offers Cancel', async () => {
    const wrapper = await mountSuspended(Loader, {
      props: { show: true, waitingSince: Date.now() - 5_000 },
    })

    expect(wrapper.get('[data-testid="chat-loader-waiting"]').text())
      .toContain('Waiting for the previous reply to stop… 5s')

    await vi.advanceTimersByTimeAsync(2_000)

    expect(wrapper.get('[data-testid="chat-loader-waiting"]').text())
      .toContain('7s')

    await wrapper.get('[data-testid="chat-loader-waiting-cancel"]')
      .trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })
})

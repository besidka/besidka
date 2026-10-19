import { mountSuspended } from '@nuxt/test-utils/runtime'
import { createSSRApp, nextTick } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import UiLocalDate from '../../../../app/components/ui/LocalDate.vue'

const isoValue = '2026-08-01T09:30:15.000Z'

describe('ui/LocalDate', () => {
  it('renders the local date only by default', async () => {
    const wrapper = await mountSuspended(UiLocalDate, {
      props: { value: isoValue },
    })

    await nextTick()

    expect(wrapper.find('time').text()).toBe(
      new Date(isoValue).toLocaleDateString(),
    )
  })

  it('renders date and time when withTime is set', async () => {
    const wrapper = await mountSuspended(UiLocalDate, {
      props: { value: isoValue, withTime: true },
    })

    await nextTick()

    expect(wrapper.find('time').text()).toBe(
      new Date(isoValue).toLocaleString(),
    )
  })

  it('exposes a deterministic ISO datetime attribute', async () => {
    const wrapper = await mountSuspended(UiLocalDate, {
      props: { value: new Date(isoValue) },
    })

    expect(wrapper.find('time').attributes('datetime')).toBe(isoValue)
  })

  it('renders empty text without throwing for an invalid value',
    async () => {
      const wrapper = await mountSuspended(UiLocalDate, {
        props: { value: 'not-a-date' },
      })

      await nextTick()

      const time = wrapper.find('time')

      expect(time.text()).toBe('')
      expect(time.attributes('datetime')).toBeUndefined()
    })

  it('updates the text when the value changes', async () => {
    const wrapper = await mountSuspended(UiLocalDate, {
      props: { value: isoValue },
    })

    await nextTick()

    const nextValue = '2027-02-03T04:05:06.000Z'

    await wrapper.setProps({ value: nextValue })

    expect(wrapper.find('time').text()).toBe(
      new Date(nextValue).toLocaleDateString(),
    )
    expect(wrapper.find('time').attributes('datetime')).toBe(nextValue)
  })

  it('server-renders deterministic markup with empty text so hydration '
    + 'cannot mismatch', async () => {
    const app = createSSRApp(UiLocalDate, { value: isoValue, withTime: true })
    const html = await renderToString(app)

    expect(html).toBe(`<time datetime="${isoValue}"></time>`)
  })
})

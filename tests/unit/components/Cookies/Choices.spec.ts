import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import Choices from '../../../../app/components/Cookies/Choices.vue'

const props = {
  rejectLabel: 'Reject all',
  acceptLabel: 'Accept all',
  rejectTestId: 'choices-reject',
  acceptTestId: 'choices-accept',
}

describe('Cookies/Choices', () => {
  it('renders reject before accept in a two-column grid', async () => {
    const wrapper = await mountSuspended(Choices, { props })
    const buttons = wrapper.findAll('button')

    expect(wrapper.classes()).toEqual(
      expect.arrayContaining(['grid', 'grid-cols-2']),
    )
    expect(buttons).toHaveLength(2)
    expect(buttons[0]?.text()).toBe('Reject all')
    expect(buttons[1]?.text()).toBe('Accept all')
  })

  it('stacks the buttons in one column with identical classes when asked', async () => {
    const wrapper = await mountSuspended(Choices, {
      props: { ...props, stacked: true },
    })

    expect(wrapper.classes()).toContain('grid-cols-1')
    expect(wrapper.classes()).not.toContain('grid-cols-2')
    expect(
      wrapper.get('[data-testid="choices-reject"]').attributes('class'),
    ).toBe(
      wrapper.get('[data-testid="choices-accept"]').attributes('class'),
    )
  })

  it('applies the provided test ids', async () => {
    const wrapper = await mountSuspended(Choices, { props })

    expect(wrapper.find('[data-testid="choices-reject"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="choices-accept"]').exists())
      .toBe(true)
  })

  it('gives both buttons the identical class attribute', async () => {
    const wrapper = await mountSuspended(Choices, { props })
    const rejectClass = wrapper
      .get('[data-testid="choices-reject"]')
      .attributes('class')
    const acceptClass = wrapper
      .get('[data-testid="choices-accept"]')
      .attributes('class')

    expect(rejectClass).toBe(acceptClass)
    expect(rejectClass).toContain('btn-accent')
    expect(rejectClass).not.toContain('btn-outline')
    expect(rejectClass).not.toContain('btn-ghost')
    expect(rejectClass).not.toContain('btn-link')
    expect(rejectClass).not.toContain('order')
  })

  it('emits reject and accept on click', async () => {
    const wrapper = await mountSuspended(Choices, { props })

    await wrapper.get('[data-testid="choices-reject"]').trigger('click')

    expect(wrapper.emitted('reject')).toHaveLength(1)
    expect(wrapper.emitted('accept')).toBeUndefined()

    await wrapper.get('[data-testid="choices-accept"]').trigger('click')

    expect(wrapper.emitted('accept')).toHaveLength(1)
  })
})

import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { SegmentedOption } from '../../../../../app/types/chat-input-tools'
import Segmented from '../../../../../app/components/ChatInput/ToolsMenu/Segmented.vue'

const options: SegmentedOption<string>[] = [
  { value: 'off', label: 'Off', testId: 'option-off' },
  {
    value: 'globe',
    label: 'Built-in',
    icon: 'lucide:globe',
    sub: '$14/1k',
    testId: 'option-globe',
  },
  {
    value: 'brave',
    label: 'Brave',
    providerId: 'brave',
    testId: 'option-brave',
  },
  {
    value: 'low',
    label: 'Low',
    iconComponent: 'SvgoThinkLow',
    testId: 'option-low',
  },
]

async function mountSegmented(props: { disabled?: boolean } = {}) {
  return mountSuspended(Segmented, {
    props: {
      name: 'test',
      legend: 'Test',
      options,
      modelValue: 'off',
      ...props,
    },
  })
}

describe('ChatInput/ToolsMenu/Segmented', () => {
  it('keeps the icon and the sub line inside the segment label, out of '
    + 'pointer hit testing', async () => {
    const wrapper = await mountSegmented()
    const label = wrapper.get('[data-testid="option-globe"]')
      .element
      .closest('label')

    const globe = label?.querySelector('[data-testid="icon-option-globe"]')
    const sub = label?.querySelector('small')

    expect(globe).not.toBeNull()
    expect(sub).not.toBeNull()
    expect(globe?.classList.contains('pointer-events-none')).toBe(true)
    expect(sub?.classList.contains('pointer-events-none')).toBe(true)
  })

  it('makes the whole visual body pointer-transparent for every icon kind',
    async () => {
      const wrapper = await mountSegmented()

      for (const testId of [
        'icon-option-globe',
        'icon-option-brave',
        'icon-option-low',
      ]) {
        const icon = wrapper.get(`[data-testid="${testId}"]`).element

        expect(icon.classList.contains('pointer-events-none')).toBe(true)
        expect(
          icon.closest('label')?.querySelector('.pointer-events-none'),
        ).not.toBeNull()
      }
    })

  it('puts the pointer cursor on the label and the not-allowed one on a '
    + 'disabled group', async () => {
    const enabled = await mountSegmented()
    const disabled = await mountSegmented({ disabled: true })

    expect(enabled.get('label').classes()).toContain('cursor-pointer')
    expect(disabled.get('label').classes()).toContain('cursor-not-allowed')
  })

  it('renders a component icon next to the label and hides it from '
    + 'assistive technology', async () => {
    const wrapper = await mountSegmented()
    const icon = wrapper.get('[data-testid="icon-option-low"]')

    expect(icon.element.tagName.toLowerCase()).toBe('svg')
    expect(icon.attributes('aria-hidden')).toBe('true')
    expect(icon.element.closest('label')?.textContent).toContain('Low')
  })

  it('renders no icon for an option without one', async () => {
    const wrapper = await mountSegmented()

    expect(wrapper.find('[data-testid="icon-option-off"]').exists())
      .toBe(false)
  })
})

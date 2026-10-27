import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import type { SegmentedOption } from '../../../../../app/types/chat-input-tools'
import {
  provideRevealGuardRoot,
  REVEAL_GUARD_DURATION_MS,
} from '../../../../../app/composables/reveal-guard'
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

const guardOptions = [
  { value: 'lite', label: 'Lite', testId: 'late-lite' },
  { value: 'auto', label: 'Auto', testId: 'late-auto' },
]

function mountGuardMenu() {
  const picked: string[] = []

  const Menu = defineComponent({
    props: { isLateControlVisible: Boolean },
    setup(props) {
      provideRevealGuardRoot()

      return () => h('div', [
        h(Segmented, {
          'name': 'early',
          'legend': 'Early',
          'options': guardOptions.map(option => ({
            ...option,
            testId: option.testId.replace('late', 'early'),
          })),
          'modelValue': 'lite',
          'onUpdate:modelValue': (value: string) => picked.push(`early:${value}`),
        }),
        props.isLateControlVisible
          ? h(Segmented, {
            'name': 'late',
            'legend': 'Late',
            'options': guardOptions,
            'modelValue': 'lite',
            'onUpdate:modelValue': (value: string) => picked.push(`late:${value}`),
          })
          : null,
      ])
    },
  })

  return { picked, mounted: mountSuspended(Menu, { attachTo: document.body }) }
}

function pointerClick(input: HTMLInputElement) {
  input.dispatchEvent(new Event('pointerdown', { bubbles: true }))
  input.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    detail: 1,
  }))
}

function keyboardActivate(input: HTMLInputElement) {
  input.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'ArrowRight',
    bubbles: true,
  }))
  input.click()
}

function guardInput(
  wrapper: Awaited<ReturnType<typeof mountGuardMenu>['mounted']>,
  testId: string,
) {
  return wrapper.get(`[data-testid="${testId}"]`).element as HTMLInputElement
}

describe('ChatInput/ToolsMenu/Segmented reveal guard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts an immediate pick on a control present when the menu opened',
    async () => {
      const { picked, mounted } = mountGuardMenu()
      const wrapper = await mounted

      pointerClick(guardInput(wrapper, 'early-auto'))

      expect(picked).toEqual(['early:auto'])
    })

  it('ignores a pointer pick on a control revealed a moment ago and keeps '
    + 'the checked segment', async () => {
    const { picked, mounted } = mountGuardMenu()
    const wrapper = await mounted

    await wrapper.setProps({ isLateControlVisible: true })

    pointerClick(guardInput(wrapper, 'late-auto'))
    await wrapper.get('[data-testid="late-auto"]').setValue(true)

    expect(picked).toEqual([])
    expect(guardInput(wrapper, 'late-auto').checked).toBe(false)
    expect(guardInput(wrapper, 'late-lite').checked).toBe(true)
  })

  it('accepts keyboard activation on a control revealed a moment ago',
    async () => {
      const { picked, mounted } = mountGuardMenu()
      const wrapper = await mounted

      await wrapper.setProps({ isLateControlVisible: true })

      keyboardActivate(guardInput(wrapper, 'late-auto'))

      expect(picked).toEqual(['late:auto'])
    })

  it('accepts an arrow-key change on a control revealed a moment ago',
    async () => {
      const { picked, mounted } = mountGuardMenu()
      const wrapper = await mounted

      await wrapper.setProps({ isLateControlVisible: true })

      guardInput(wrapper, 'late-lite').dispatchEvent(new KeyboardEvent(
        'keydown',
        { key: 'ArrowRight', bubbles: true },
      ))
      await wrapper.get('[data-testid="late-auto"]').setValue(true)

      expect(picked).toEqual(['late:auto'])
    })

  it('ignores a click carrying pointer detail even without a pointerdown',
    async () => {
      const { picked, mounted } = mountGuardMenu()
      const wrapper = await mounted

      await wrapper.setProps({ isLateControlVisible: true })

      guardInput(wrapper, 'late-auto').dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        detail: 1,
      }))

      expect(picked).toEqual([])
      expect(guardInput(wrapper, 'late-auto').checked).toBe(false)
    })

  it('accepts a pick once the window has passed', async () => {
    const { picked, mounted } = mountGuardMenu()
    const wrapper = await mounted

    await wrapper.setProps({ isLateControlVisible: true })

    vi.advanceTimersByTime(REVEAL_GUARD_DURATION_MS)
    await wrapper.vm.$nextTick()
    pointerClick(guardInput(wrapper, 'late-auto'))

    expect(picked).toEqual(['late:auto'])
  })
})

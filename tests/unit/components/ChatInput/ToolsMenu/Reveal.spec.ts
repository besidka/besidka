import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import {
  provideRevealGuardRoot,
  REVEAL_GUARD_DURATION_MS,
} from '../../../../../app/composables/reveal-guard'
import Reveal from '../../../../../app/components/ChatInput/ToolsMenu/Reveal.vue'
import ToggleRow from '../../../../../app/components/ChatInput/ToolsMenu/ToggleRow.vue'

function mountReveal(isOpen: boolean) {
  const updates: boolean[] = []

  const Host = defineComponent({
    props: { isOpen: Boolean },
    setup(props) {
      provideRevealGuardRoot()

      return () => h('div', { class: 'js-tools-content' }, [
        h('fieldset', { class: 'js-reasoning-level-group' }, [
          h('input', {
            'type': 'radio',
            'name': 'level',
            'checked': true,
            'data-testid': 'level',
          }),
        ]),
        h(Reveal, { isOpen: props.isOpen }, () => h(ToggleRow, {
          'label': 'Steps',
          'modelValue': false,
          'testId': 'steps',
          'onUpdate:modelValue': (value: boolean) => updates.push(value),
        })),
      ])
    },
  })

  const mounted = mountSuspended(Host, {
    props: { isOpen },
    attachTo: document.body,
  })

  return { updates, mounted }
}

function steps(wrapper: Awaited<ReturnType<typeof mountReveal>['mounted']>) {
  return wrapper.get('[data-testid="steps"]').element as HTMLInputElement
}

describe('ChatInput/ToolsMenu/Reveal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('collapses to zero rows and is inert and invisible while closed',
    async () => {
      const { mounted } = mountReveal(false)
      const wrapper = await mounted
      const reveal = wrapper.get('[data-open]')

      expect(reveal.attributes('data-open')).toBe('false')
      expect(reveal.attributes('inert')).toBeDefined()
      expect(reveal.classes()).toEqual(expect.arrayContaining([
        'grid-rows-[0fr]',
        'invisible',
      ]))
      expect(wrapper.find('[data-testid="steps"]').exists()).toBe(true)
    })

  it('expands to one row and drops inert while open', async () => {
    const { mounted } = mountReveal(true)
    const wrapper = await mounted
    const reveal = wrapper.get('[data-open]')

    expect(reveal.attributes('data-open')).toBe('true')
    expect(reveal.attributes('inert')).toBeUndefined()
    expect(reveal.classes()).toContain('grid-rows-[1fr]')
    expect(reveal.classes()).not.toContain('invisible')
  })

  it('animates grid rows over 160ms and skips the animation for reduced '
    + 'motion', async () => {
    const { mounted } = mountReveal(false)
    const wrapper = await mounted
    const classes = wrapper.get('[data-open]').classes()

    expect(classes).toContain('transition-[grid-template-rows,visibility]')
    expect(classes).toContain('duration-160')
    expect(classes).toContain('ease-out')
    expect(classes).toContain('motion-reduce:transition-none')
  })

  it('does not guard a region that is open on the first render', async () => {
    const { updates, mounted } = mountReveal(true)
    const wrapper = await mounted

    steps(wrapper).click()

    expect(updates).toEqual([true])
  })

  it('guards its controls for the window after it opens, then accepts '
    + 'them', async () => {
    const { updates, mounted } = mountReveal(false)
    const wrapper = await mounted

    await wrapper.setProps({ isOpen: true })

    steps(wrapper).click()
    await wrapper.get('[data-testid="steps"]').setValue(true)

    expect(updates).toEqual([])
    expect(steps(wrapper).checked).toBe(false)

    vi.advanceTimersByTime(REVEAL_GUARD_DURATION_MS - 1)
    steps(wrapper).click()

    expect(updates).toEqual([])

    vi.advanceTimersByTime(1)
    await nextTick()
    steps(wrapper).click()

    expect(updates).toEqual([true])
  })

  it('guards again each time it reopens', async () => {
    const { updates, mounted } = mountReveal(true)
    const wrapper = await mounted

    await wrapper.setProps({ isOpen: false })
    await wrapper.setProps({ isOpen: true })

    steps(wrapper).click()

    expect(updates).toEqual([])
  })

  it('moves focus to the checked level radio when it closes around the '
    + 'focused control', async () => {
    const { mounted } = mountReveal(true)
    const wrapper = await mounted

    steps(wrapper).focus()

    expect(document.activeElement).toBe(steps(wrapper))

    await wrapper.setProps({ isOpen: false })
    await nextTick()

    expect(document.activeElement)
      .toBe(wrapper.get('[data-testid="level"]').element)
  })

  it('leaves focus alone when it closes without holding it', async () => {
    const { mounted } = mountReveal(true)
    const wrapper = await mounted
    const level = wrapper.get('[data-testid="level"]').element as HTMLElement

    level.focus()
    await wrapper.setProps({ isOpen: false })
    await nextTick()

    expect(document.activeElement).toBe(level)
  })

  it('clears its guard timer on unmount', async () => {
    const { mounted } = mountReveal(false)
    const wrapper = await mounted

    await wrapper.setProps({ isOpen: true })
    wrapper.unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})

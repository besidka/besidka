import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ModeControl from '../../../../../app/components/ui/ToolPermissions/ModeControl.vue'

enableAutoUnmount(afterEach)

async function mountControl(props: Record<string, unknown> = {}) {
  return await mountSuspended(ModeControl, {
    props: {
      label: 'Search issues',
      mode: 'ask',
      modes: ['blocked', 'ask', 'allow'],
      ...props,
    },
    attachTo: document.body,
  })
}

describe('Ui/ToolPermissions/ModeControl', () => {
  it('is a labeled radio group with three icon options and tooltips',
    async () => {
      const wrapper = await mountControl()
      const group = wrapper.get('[role="radiogroup"]')
      const radios = wrapper.findAll('[role="radio"]')

      expect(group.attributes('aria-label'))
        .toBe('Permission for Search issues')
      expect(radios.map(radio => radio.attributes('aria-label')))
        .toEqual(['Always allow', 'Needs approval', 'Blocked'])
      expect(radios.map(radio => radio.attributes('aria-checked')))
        .toEqual(['false', 'true', 'false'])
      expect(radios.map((radio) => {
        return radio.element.parentElement?.getAttribute('data-tip')
      })).toEqual([
        'Always allow — runs without asking',
        'Needs approval — asks before each use',
        'Blocked — never offered to the model',
      ])
      expect(radios.map(radio => radio.attributes('tabindex')))
        .toEqual(['-1', '0', '-1'])
    })

  it('emits the chosen mode and nothing for the current one', async () => {
    const wrapper = await mountControl()

    await wrapper.get('[data-testid="tool-permission-option-ask"]')
      .trigger('click')
    await wrapper.get('[data-testid="tool-permission-option-allow"]')
      .trigger('click')

    expect(wrapper.emitted('select')).toEqual([['allow']])
  })

  it('keeps an unavailable mode focusable, explains it and ignores it',
    async () => {
      const wrapper = await mountControl({
        modes: ['blocked', 'ask'],
        unavailableHint: 'this tool deletes or shares data, so it always asks',
      })
      const allow = wrapper.get('[data-testid="tool-permission-option-allow"]')

      expect(allow.attributes('aria-disabled')).toBe('true')
      expect(allow.attributes('disabled')).toBeUndefined()
      expect(allow.element.parentElement?.getAttribute('data-tip'))
        .toBe('Always allow — this tool deletes or shares data, so it always '
          + 'asks')

      await allow.trigger('click')

      expect(wrapper.emitted('select')).toBeUndefined()
    })

  it('hides the icon tooltips on devices without hover, so a tap leaves '
    + 'nothing over the row', async () => {
    const wrapper = await mountControl()
    const tooltip = wrapper.get('[role="radio"]').element.parentElement!

    expect(tooltip.className).toContain('tooltip')
    expect(tooltip.className).toContain('[@media(hover:none)]:before:hidden')
    expect(tooltip.className).toContain('[@media(hover:none)]:after:hidden')
  })

  it('can hide the modes a tool does not take', async () => {
    const wrapper = await mountControl({
      modes: ['blocked', 'ask'],
      isUnavailableHidden: true,
    })

    expect(wrapper.findAll('[role="radio"]')
      .map(radio => radio.attributes('data-mode')))
      .toEqual(['ask', 'blocked'])
  })

  it('ignores clicks while busy', async () => {
    const wrapper = await mountControl({ isBusy: true })

    await wrapper.get('[data-testid="tool-permission-option-blocked"]')
      .trigger('click')

    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('moves focus between options with the arrow keys and wraps', async () => {
    const wrapper = await mountControl()
    const radios = wrapper.findAll('[role="radio"]')

    ;(radios[1]!.element as HTMLButtonElement).focus()
    await radios[1]!.trigger('keydown', { key: 'ArrowRight' })

    expect(document.activeElement).toBe(radios[2]!.element)

    await radios[2]!.trigger('keydown', { key: 'ArrowDown' })

    expect(document.activeElement).toBe(radios[0]!.element)

    await radios[0]!.trigger('keydown', { key: 'ArrowLeft' })

    expect(document.activeElement).toBe(radios[2]!.element)
    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it.each([
    ['allow', 'btn-success'],
    ['ask', 'btn-warning'],
    ['blocked', 'btn-error'],
  ])('marks the checked %s mode with the soft %s variant', async (
    mode,
    colorClass,
  ) => {
    const wrapper = await mountControl({ mode })
    const checked = wrapper.get(`[data-testid="tool-permission-option-${mode}"]`)
    const classes = checked.classes()

    expect(classes).toContain('btn-soft')
    expect(classes).toContain('btn-soft-selected')
    expect(classes).toContain(colorClass)
    expect(classes).not.toContain('btn-ghost')

    for (const other of ['allow', 'ask', 'blocked'].filter(m => m !== mode)) {
      const otherClasses = wrapper
        .get(`[data-testid="tool-permission-option-${other}"]`)
        .classes()

      expect(otherClasses).toContain('btn-ghost')
      expect(otherClasses).not.toContain('btn-soft')
      expect(otherClasses).not.toContain('btn-soft-selected')
    }
  })
})

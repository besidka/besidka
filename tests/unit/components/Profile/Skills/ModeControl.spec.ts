import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ModeControl from '../../../../../app/components/Profile/Skills/ModeControl.vue'
import { createSkillSummary } from '../../../../setup/helpers/skills-ui'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Profile/Skills/ModeControl', () => {
  it('offers Off, Auto and Only when I ask and shows the current one', async () => {
    const wrapper = await mountSuspended(ModeControl, {
      props: { skill: createSkillSummary({ enabled: true }) },
    })
    const select = wrapper.get(testId('skill-mode-select'))
      .element as HTMLSelectElement

    expect([...select.options].map(option => option.value))
      .toEqual(['off', 'auto', 'ask'])
    expect(select.value).toBe('auto')
    expect(select.title).toContain('The model uses it')
  })

  it('emits the chosen mode and snaps back until the skill changes', async () => {
    const wrapper = await mountSuspended(ModeControl, {
      props: { skill: createSkillSummary({ enabled: false }) },
    })
    const select = wrapper.get(testId('skill-mode-select'))
      .element as HTMLSelectElement

    select.value = 'ask'
    select.dispatchEvent(new Event('change'))

    expect(wrapper.emitted('select')).toEqual([['ask']])
    expect(select.value).toBe('off')

    await wrapper.setProps({
      skill: createSkillSummary({
        enabled: true,
        modelInvocable: false,
        slashCommand: true,
      }),
    })

    expect(select.value).toBe('ask')
  })

  it('does not emit when the same mode is picked', async () => {
    const wrapper = await mountSuspended(ModeControl, {
      props: { skill: createSkillSummary({ enabled: true }) },
    })
    const select = wrapper.get(testId('skill-mode-select'))
      .element as HTMLSelectElement

    select.value = 'auto'
    select.dispatchEvent(new Event('change'))

    expect(wrapper.emitted('select')).toBeUndefined()
  })

  it('is disabled while busy and for a broken skill', async () => {
    const busy = await mountSuspended(ModeControl, {
      props: { skill: createSkillSummary(), isDisabled: true },
    })
    const broken = await mountSuspended(ModeControl, {
      props: { skill: createSkillSummary({ status: 'broken' }) },
    })

    expect(busy.get(testId('skill-mode-select')).attributes('disabled'))
      .toBeDefined()
    expect(broken.get(testId('skill-mode-select')).attributes('disabled'))
      .toBeDefined()
  })

  it('names the skill for assistive technology', async () => {
    const wrapper = await mountSuspended(ModeControl, {
      props: { skill: createSkillSummary({ name: 'writing-style' }) },
    })

    expect(wrapper.text()).toContain('Mode for writing-style')
  })
})

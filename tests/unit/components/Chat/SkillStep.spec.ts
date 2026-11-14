import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import SkillStep from '../../../../app/components/Chat/SkillStep.vue'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function mountStep(part: Record<string, unknown>) {
  return mountSuspended(SkillStep, {
    props: {
      part: { type: 'tool-activate_skill', toolCallId: 'c1', ...part },
    },
  })
}

describe('Chat/SkillStep', () => {
  it('shows Using skill... while the call runs', async () => {
    const wrapper = await mountStep({
      state: 'input-available',
      input: { name: 'writing-style' },
    })

    expect(wrapper.get(testId('skill-step-working')).text())
      .toContain('Using skill…')
    expect(wrapper.find(testId('skill-step-ready')).exists()).toBe(false)
  })

  it('shows Used skill with the name and the sparkles icon once it returned', async () => {
    const wrapper = await mountStep({
      state: 'output-available',
      output: { status: 'activated', skillId: 'skl1', name: 'writing-style' },
    })
    const card = wrapper.get(testId('skill-step-ready'))

    expect(card.text()).toBe('Used skill · writing-style')
    expect(card.html()).toContain('lucide:sparkles')
    expect(card.attributes('aria-label')).toBe('Open skill writing-style')
  })

  it('opens the read-only preview of the skill on a click', async () => {
    const preview = useSkillPreview()

    preview.close()

    const wrapper = await mountStep({
      state: 'output-available',
      output: { status: 'activated', skillId: 'skl1', name: 'writing-style' },
    })

    await wrapper.get(testId('skill-step-ready')).trigger('click')

    expect(preview.skillId.value).toBe('skl1')
    preview.close()
  })

  it('says it could not use the skill when the call failed', async () => {
    const wrapper = await mountStep({
      state: 'output-error',
      input: { name: 'writing-style' },
    })

    expect(wrapper.get(testId('skill-step-failed')).text())
      .toContain('Could not use skill · writing-style')
  })

  it('renders nothing for another part', async () => {
    const wrapper = await mountSuspended(SkillStep, {
      props: { part: { type: 'text', text: 'hi' } },
    })

    expect(wrapper.find(testId('skill-step')).exists()).toBe(false)
  })
})

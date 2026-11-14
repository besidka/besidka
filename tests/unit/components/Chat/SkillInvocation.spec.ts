import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import SkillInvocation from '../../../../app/components/Chat/SkillInvocation.vue'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Chat/SkillInvocation', () => {
  it('shows the attached skill above the text of a sent message', async () => {
    const wrapper = await mountSuspended(SkillInvocation, {
      props: {
        message: {
          parts: [
            { type: 'text', text: 'summarise this' },
            {
              type: 'data-skill-invocation',
              data: { skillId: 'skl1', name: 'writing-style', version: 2 },
            },
          ],
        },
      },
    })

    expect(wrapper.get(testId('skill-invocation-chip')).text())
      .toContain('writing-style')
    expect(wrapper.get(testId('skill-invocation-chip')).attributes('aria-label'))
      .toBe('Skill writing-style. Open to read it.')
    expect(wrapper.html()).toContain('lucide:sparkles')
  })

  it('opens the preview when the chip is clicked', async () => {
    const preview = useSkillPreview()

    preview.close()

    const wrapper = await mountSuspended(SkillInvocation, {
      props: {
        message: {
          parts: [{
            type: 'data-skill-invocation',
            data: { skillId: 'skl1', name: 'writing-style', version: 2 },
          }],
        },
      },
    })

    await wrapper.get(testId('skill-invocation-chip')).trigger('click')

    expect(preview.skillId.value).toBe('skl1')
    preview.close()
  })

  it('renders nothing for a message without an invocation', async () => {
    const wrapper = await mountSuspended(SkillInvocation, {
      props: { message: { parts: [{ type: 'text', text: 'hi' }] } },
    })

    expect(wrapper.find(testId('skill-invocation')).exists()).toBe(false)
  })
})

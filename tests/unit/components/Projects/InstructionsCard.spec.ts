import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import InstructionsCard from '../../../../app/components/Projects/InstructionsCard.vue'

describe('Projects/InstructionsCard', () => {
  it('renders instructions state and emits save', async () => {
    const wrapper = await mountSuspended(InstructionsCard, {
      props: {
        modelValue: 'Be concise and code-first.',
        isLoading: false,
        isSaving: false,
        hasInstructions: true,
        isDirty: true,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
        },
      },
    })

    expect(wrapper.text()).toContain('Project instructions')
    expect(wrapper.text()).toContain('Active')
    expect(
      (wrapper.get('textarea').element as HTMLTextAreaElement).value,
    ).toBe('Be concise and code-first.')

    await wrapper.get('[data-testid="save-project-instructions"]').trigger('click')

    expect(wrapper.emitted('save')).toEqual([[]])
  })
})

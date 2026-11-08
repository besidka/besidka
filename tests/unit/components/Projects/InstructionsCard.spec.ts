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

  it('normalises pasted Mail bullets and continues lists with Shift+Enter', async () => {
    const wrapper = await mountSuspended(InstructionsCard, {
      props: {
        modelValue: '',
        isLoading: false,
        isSaving: false,
        hasInstructions: false,
        isDirty: false,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
        },
      },
    })
    const textarea = wrapper.get('textarea')
    const element = textarea.element as HTMLTextAreaElement
    const pasteEvent = new Event('paste', {
      bubbles: true,
      cancelable: true,
    })

    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [],
        getData: (type: string) => {
          return type === 'text/plain' ? '\t•\tOne' : ''
        },
      },
    })
    element.dispatchEvent(pasteEvent)
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true })

    expect(element.value).toBe('- One\n- ')
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual(['- One\n- '])
  })

  it('continues and ends lists on plain Enter', async () => {
    const wrapper = await mountSuspended(InstructionsCard, {
      props: {
        modelValue: '',
        isLoading: false,
        isSaving: false,
        hasInstructions: false,
        isDirty: false,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
        },
      },
    })
    const textarea = wrapper.get('textarea')
    const element = textarea.element as HTMLTextAreaElement

    await textarea.setValue('- rule')
    element.setSelectionRange(element.value.length, element.value.length)
    await textarea.trigger('keydown.enter')

    expect(element.value).toBe('- rule\n- ')

    await textarea.trigger('keydown.enter')

    expect(element.value).toBe('- rule\n')
  })

  it('continues a list on a beforeinput line break', async () => {
    const wrapper = await mountSuspended(InstructionsCard, {
      props: {
        modelValue: '',
        isLoading: false,
        isSaving: false,
        hasInstructions: false,
        isDirty: false,
      },
      global: {
        stubs: {
          UiBubble: {
            template: '<div><slot /></div>',
          },
        },
      },
    })
    const textarea = wrapper.get('textarea')
    const element = textarea.element as HTMLTextAreaElement

    await textarea.setValue('- rule')
    element.setSelectionRange(element.value.length, element.value.length)
    element.dispatchEvent(new InputEvent('beforeinput', {
      inputType: 'insertLineBreak',
      bubbles: true,
      cancelable: true,
    }))

    expect(element.value).toBe('- rule\n- ')
  })
})

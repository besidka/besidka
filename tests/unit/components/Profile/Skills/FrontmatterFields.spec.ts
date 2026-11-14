import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import FrontmatterFields from '../../../../../app/components/Profile/Skills/FrontmatterFields.vue'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function mountFields(props: Record<string, unknown> = {}) {
  return mountSuspended(FrontmatterFields, {
    props: {
      'name': 'review-pr',
      'onUpdate:name': () => {},
      'description': 'Review a pull request',
      'onUpdate:description': () => {},
      'advanced': '',
      'onUpdate:advanced': () => {},
      'catalogTokens': 28,
      ...props,
    },
  })
}

describe('Profile/Skills/FrontmatterFields', () => {
  it('shows the name help until there is an error', async () => {
    const wrapper = await mountFields()

    expect(wrapper.get(testId('skill-edit-name-help')).text())
      .toContain('Lowercase letters')

    await wrapper.setProps({ nameError: 'Add a name' })

    const help = wrapper.get(testId('skill-edit-name-help'))

    expect(help.text()).toBe('Add a name')
    expect(help.attributes('role')).toBe('alert')
    expect(wrapper.get(testId('skill-edit-name')).attributes('aria-invalid'))
      .toBe('true')
  })

  it('emits the name on input and when the field loses focus', async () => {
    const wrapper = await mountFields()

    await wrapper.get(testId('skill-edit-name')).setValue('review-code')
    await wrapper.get(testId('skill-edit-name')).trigger('blur')

    expect(wrapper.emitted('update:name')).toEqual([['review-code']])
    expect(wrapper.emitted('name-blur')).toHaveLength(1)
  })

  it('counts the description out of 1,024', async () => {
    const wrapper = await mountFields()

    expect(wrapper.get(testId('skill-edit-description-counter')).text())
      .toBe('21 / 1,024')
  })

  it('shows the token cost of a model-invocable skill', async () => {
    const wrapper = await mountFields()

    expect(wrapper.get(testId('skill-edit-tokens')).text())
      .toBe('≈ 28 tokens in every message')
    expect(wrapper.find(testId('skill-edit-tokens-off')).exists()).toBe(false)
  })

  it('says a command-only skill costs nothing until it is run', async () => {
    const wrapper = await mountFields({ isModelInvocable: false })

    expect(wrapper.find(testId('skill-edit-tokens')).exists()).toBe(false)
    expect(wrapper.get(testId('skill-edit-tokens-off')).text())
      .toContain('/review-pr')
  })

  it('warns "Shortened in the catalog" above 300 characters only', async () => {
    const wrapper = await mountFields({ description: 'x'.repeat(300) })

    expect(wrapper.find(testId('skill-edit-shortened')).exists()).toBe(false)

    const longer = await mountFields({ description: 'x'.repeat(301) })

    expect(longer.get(testId('skill-edit-shortened')).text())
      .toContain('Shortened in the catalog')
  })

  it('shows the description error', async () => {
    const wrapper = await mountFields({ descriptionError: 'Add a description' })

    expect(wrapper.get(testId('skill-edit-description-error')).text())
      .toBe('Add a description')
  })

  it('keeps Advanced (YAML) collapsed and opens it for an error', async () => {
    const wrapper = await mountFields()

    expect(wrapper.get(testId('skill-edit-advanced')).attributes('open'))
      .toBeUndefined()

    await wrapper.setProps({
      problems: [{
        id: 'yaml',
        severity: 'error',
        scope: 'advanced',
        line: 2,
        message: 'Not valid YAML',
      }],
    })

    expect(wrapper.get(testId('skill-edit-advanced')).attributes('open'))
      .toBeDefined()
    expect(wrapper.get('#skill-edit-advanced-problems').text())
      .toContain('line 2')
  })

  it('shows the advanced YAML as text in a textarea, never as HTML', async () => {
    const wrapper = await mountFields({
      advanced: 'license: <b>MIT</b>',
    })

    const textarea = wrapper.get(testId('skill-edit-advanced-text'))

    expect((textarea.element as HTMLTextAreaElement).value)
      .toBe('license: <b>MIT</b>')
    expect(wrapper.find('b').exists()).toBe(false)
  })

  it('passes the hidden character fix up', async () => {
    const problem = {
      id: 'hidden-name-1',
      severity: 'warning' as const,
      scope: 'name' as const,
      line: 1,
      message: '1 hidden character',
      fix: 'remove-hidden-characters' as const,
    }
    const wrapper = await mountFields({ problems: [problem] })

    await wrapper.get(testId('skill-editor-problem-fix')).trigger('click')

    expect(wrapper.emitted('fix')).toEqual([[problem]])
  })
})

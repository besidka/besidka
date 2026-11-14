import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import EditorPane from '../../../../../app/components/Profile/Skills/EditorPane.vue'

enableAutoUnmount(afterEach)

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function createFile(overrides = {}) {
  return {
    key: 'file:SKILL.md',
    originalPath: 'SKILL.md',
    path: 'SKILL.md',
    bytes: 10,
    text: 'text',
    originalText: 'text',
    loadState: 'ready',
    loadError: '',
    isDeleted: false,
    isLocked: false,
    isTooLarge: false,
    ...overrides,
  }
}

function mountPane(props: Record<string, unknown> = {}) {
  return mountSuspended(EditorPane, {
    props: {
      'modelValue': '# Review\n',
      'onUpdate:modelValue': () => {},
      'file': createFile(),
      'isSkillMd': true,
      'catalogLine': '- a: b',
      ...props,
    },
  })
}

describe('Profile/Skills/EditorPane', () => {
  it('writes in a monospace textarea that follows the global radius', async () => {
    const wrapper = await mountPane()
    const textarea = wrapper.get(testId('skill-editor-textarea'))

    expect(textarea.classes()).toEqual(expect.arrayContaining([
      'textarea',
      'textarea-bordered',
      'font-mono',
    ]))
    expect(textarea.classes().some(name => name.startsWith('rounded')))
      .toBe(false)
  })

  it('emits the typed text', async () => {
    const wrapper = await mountPane()

    await wrapper.get(testId('skill-editor-textarea')).setValue('new')

    expect(wrapper.emitted('update:modelValue')).toEqual([['new']])
  })

  it('counts characters and lines', async () => {
    const wrapper = await mountPane({ modelValue: 'one\ntwo' })

    expect(wrapper.get(testId('skill-editor-counter')).text())
      .toBe('7 characters, 2 lines')
  })

  it('switches between Write and Model view', async () => {
    const wrapper = await mountPane()

    expect(wrapper.find(testId('skill-model-view')).exists()).toBe(false)

    await wrapper.get(testId('skill-editor-tab-model')).trigger('click')

    expect(wrapper.find(testId('skill-model-view')).exists()).toBe(true)
    expect(wrapper.get(testId('skill-editor-tab-model')).attributes('aria-selected'))
      .toBe('true')

    await wrapper.get(testId('skill-editor-tab-write')).trigger('click')

    expect(wrapper.find(testId('skill-model-view')).exists()).toBe(false)
  })

  it('moves between the tabs with the arrow keys', async () => {
    const wrapper = await mountPane()

    await wrapper.get('[role="tablist"]').trigger('keydown', {
      key: 'ArrowRight',
    })

    expect(wrapper.find(testId('skill-model-view')).exists()).toBe(true)
  })

  it('shows a locked file read-only with the reason and no tabs', async () => {
    const wrapper = await mountPane({
      file: createFile({ path: 'LICENSE.txt', isLocked: true }),
      isSkillMd: false,
      readOnlyReason: 'This licence file stays as it was published.',
    })

    expect(wrapper.get(testId('skill-editor-read-only')).text())
      .toContain('stays as it was published')
    expect(wrapper.find(testId('skill-editor-textarea')).exists()).toBe(false)
    expect(wrapper.find('[role="tablist"]').exists()).toBe(false)
    expect(wrapper.find(testId('skill-file-viewer')).exists()).toBe(true)
  })

  it('shows a skeleton while a file loads and an error with Retry', async () => {
    const wrapper = await mountPane({
      file: createFile({ loadState: 'loading' }),
    })

    expect(wrapper.find(testId('skill-editor-loading')).exists()).toBe(true)

    await wrapper.setProps({
      file: createFile({ loadState: 'error', loadError: 'Too big to show' }),
    })

    expect(wrapper.get(testId('skill-editor-file-error')).text())
      .toContain('Too big to show')

    await wrapper.get(`${testId('skill-editor-file-error')} button`)
      .trigger('click')

    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('lists the problems with their line numbers and passes the fix up', async () => {
    const problem = {
      id: 'hidden-body-3',
      severity: 'warning' as const,
      scope: 'body' as const,
      line: 3,
      message: '1 hidden character',
      fix: 'remove-hidden-characters' as const,
    }
    const wrapper = await mountPane({ problems: [problem] })

    expect(wrapper.get(testId('skill-editor-problem')).text())
      .toContain('line 3')

    await wrapper.get(testId('skill-editor-problem-fix')).trigger('click')

    expect(wrapper.emitted('fix')).toEqual([[problem]])
  })

  it('notes the findings in Write and shows them in Model view', async () => {
    const wrapper = await mountPane({
      findings: [{
        type: 'url',
        path: 'SKILL.md',
        line: 1,
        snippet: 'https://example.com',
        detail: null,
      }],
      findingCounts: { url: 1 },
    })

    expect(wrapper.get(testId('skill-editor-findings-note')).text())
      .toContain('1 link')
  })
})

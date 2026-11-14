import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import FileTree from '../../../../../app/components/Profile/Skills/FileTree.vue'

enableAutoUnmount(afterEach)

const files = [
  { path: 'SKILL.md', bytes: 100 },
  { path: 'references/guide.md', bytes: 2048 },
]

function testId(id: string) {
  return `[data-testid="${id}"]`
}

function mountTree(props: Record<string, unknown> = {}) {
  return mountSuspended(FileTree, {
    props: {
      'modelValue': 'SKILL.md',
      'onUpdate:modelValue': () => {},
      files,
      ...props,
    },
    attachTo: document.body,
  })
}

describe('Profile/Skills/FileTree', () => {
  it('stays read-only by default', async () => {
    const wrapper = await mountTree()

    expect(wrapper.find(testId('skill-file-tools')).exists()).toBe(false)
    expect(wrapper.findAll(testId('skill-file-tree-item'))).toHaveLength(2)
  })

  it('selects a file when it is clicked', async () => {
    const onSelect = vi.fn()
    const wrapper = await mountTree({ 'onUpdate:modelValue': onSelect })

    await wrapper.findAll(testId('skill-file-tree-item'))[1]!.trigger('click')

    expect(onSelect).toHaveBeenCalledWith('references/guide.md')
  })

  it('shows the state badges of the files', async () => {
    const wrapper = await mountTree({
      badges: { 'references/guide.md': 'Edited' },
    })

    expect(wrapper.get(testId('skill-file-tree-badge')).text()).toBe('Edited')
    expect(wrapper.get(testId('skill-file-select')).text())
      .toContain('references/guide.md (Edited)')
  })

  describe('in edit mode', () => {
    it('shows the three tools and disables Rename and Delete', async () => {
      const wrapper = await mountTree({ isEditable: true })

      expect(wrapper.find(testId('skill-file-add')).attributes('disabled'))
        .toBeUndefined()
      expect(wrapper.find(testId('skill-file-rename')).attributes('disabled'))
        .toBeDefined()
      expect(wrapper.find(testId('skill-file-delete')).attributes('disabled'))
        .toBeDefined()
    })

    it('emits delete for the selected file', async () => {
      const wrapper = await mountTree({
        isEditable: true,
        canDelete: true,
        canRename: true,
      })

      await wrapper.get(testId('skill-file-delete')).trigger('click')

      expect(wrapper.emitted('delete')).toHaveLength(1)
    })

    it('adds a file from the inline form', async () => {
      const wrapper = await mountTree({ isEditable: true })

      await wrapper.get(testId('skill-file-add')).trigger('click')
      await wrapper.get(testId('skill-file-path')).setValue('notes/new.md')
      await wrapper.get(testId('skill-file-form')).trigger('submit')

      expect(wrapper.emitted('add')).toEqual([['notes/new.md']])
      expect(wrapper.find(testId('skill-file-form')).exists()).toBe(false)
    })

    it('shows the path error live and keeps Add disabled', async () => {
      const wrapper = await mountTree({
        isEditable: true,
        validatePath: (path: string) => {
          return path.endsWith('.exe') ? 'Binary files are not allowed' : null
        },
      })

      await wrapper.get(testId('skill-file-add')).trigger('click')
      await wrapper.get(testId('skill-file-path')).setValue('run.exe')

      expect(wrapper.get(testId('skill-file-path-help')).text())
        .toBe('Binary files are not allowed')
      expect(wrapper.get(testId('skill-file-path-help')).attributes('role'))
        .toBe('alert')
      expect(wrapper.get(testId('skill-file-form-submit')).attributes('disabled'))
        .toBeDefined()

      await wrapper.get(testId('skill-file-form')).trigger('submit')

      expect(wrapper.emitted('add')).toBeUndefined()
    })

    it('starts a rename from the current path and emits the new one', async () => {
      const wrapper = await mountTree({
        modelValue: 'references/guide.md',
        isEditable: true,
        canRename: true,
      })

      await wrapper.get(testId('skill-file-rename')).trigger('click')

      const input = wrapper.get(testId('skill-file-path'))

      expect((input.element as HTMLInputElement).value)
        .toBe('references/guide.md')
      expect(wrapper.get(testId('skill-file-form-submit')).attributes('disabled'))
        .toBeDefined()

      await input.setValue('references/manual.md')
      await wrapper.get(testId('skill-file-form')).trigger('submit')

      expect(wrapper.emitted('rename')).toEqual([['references/manual.md']])
    })

    it('does not rename to the same path and shows no error for it', async () => {
      const wrapper = await mountTree({
        modelValue: 'references/guide.md',
        isEditable: true,
        canRename: true,
      })

      await wrapper.get(testId('skill-file-rename')).trigger('click')
      await flushPromises()

      await wrapper.get(testId('skill-file-form')).trigger('submit')

      expect(wrapper.emitted('rename')).toBeUndefined()
      expect(wrapper.get(testId('skill-file-path-help')).attributes('role'))
        .toBeUndefined()
    })

    it('closes the form on Escape without closing anything else', async () => {
      const wrapper = await mountTree({ isEditable: true })

      await wrapper.get(testId('skill-file-add')).trigger('click')
      await wrapper.get(testId('skill-file-form')).trigger('keydown', {
        key: 'Escape',
      })

      expect(wrapper.find(testId('skill-file-form')).exists()).toBe(false)
    })
  })
})

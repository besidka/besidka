import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ToolPermissions from '../../../../app/components/Ui/ToolPermissions.vue'
import type { ToolPermissionGroup } from '../../../../app/utils/tool-permissions'

enableAutoUnmount(afterEach)

const ALL_MODES = ['blocked', 'ask', 'allow'] as const

function tool(
  name: string,
  mode: 'blocked' | 'ask' | 'allow' = 'ask',
  modes: readonly ('blocked' | 'ask' | 'allow')[] = ALL_MODES,
) {
  return { name, title: name.replace(/_/g, ' '), mode, modes }
}

function groups(): ToolPermissionGroup[] {
  return [
    {
      id: 'read',
      label: 'Read-only',
      description: 'Look things up',
      tools: Array.from({ length: 8 }, (_, index) => tool(`read_${index}`)),
    },
    {
      id: 'write',
      label: 'Write',
      tools: [tool('create_page', 'allow'), tool('update_page')],
    },
    {
      id: 'always-asks',
      label: 'Always asks',
      isLocked: true,
      tools: [tool('delete_page', 'ask', ['blocked', 'ask'])],
    },
    { id: 'empty', label: 'Empty', tools: [] },
  ]
}

async function mountGroups() {
  return await mountSuspended(ToolPermissions, {
    props: { groups: groups() },
  })
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('Ui/ToolPermissions', () => {
  it('renders a group per non-empty list with a count badge', async () => {
    const wrapper = await mountGroups()

    expect(wrapper.findAll('section')).toHaveLength(3)
    expect(wrapper.get(testId('tool-permissions-group-toggle-read')).text())
      .toContain('8')
    expect(wrapper.find(testId('tool-permissions-group-empty')).exists())
      .toBe(false)
  })

  it('collapses a long group by default and toggles it with aria-expanded',
    async () => {
      const wrapper = await mountGroups()
      const toggle = wrapper.get(testId('tool-permissions-group-toggle-read'))
      const list = wrapper.get(testId('tool-permissions-group-tools-read'))

      expect(toggle.attributes('aria-expanded')).toBe('false')
      expect(toggle.attributes('aria-controls')).toBe(list.attributes('id'))
      expect((list.element as HTMLElement).style.display).toBe('none')
      expect(wrapper.get(testId('tool-permissions-group-toggle-write'))
        .attributes('aria-expanded')).toBe('true')

      await toggle.trigger('click')

      expect(toggle.attributes('aria-expanded')).toBe('true')
      expect((list.element as HTMLElement).style.display).toBe('')
    })

  it('shows Custom for a mixed group and the shared mode otherwise',
    async () => {
      const wrapper = await mountGroups()
      const writeSelect = wrapper
        .get(testId('tool-permissions-group-select-write'))

      expect((writeSelect.element as HTMLSelectElement).value).toBe('custom')
      expect(writeSelect.get('option[value="custom"]')
        .attributes('disabled')).toBeDefined()
      expect((wrapper.get(testId('tool-permissions-group-select-read'))
        .element as HTMLSelectElement).value).toBe('ask')
    })

  it('offers only the modes a locked group allows', async () => {
    const wrapper = await mountGroups()

    expect(wrapper.get(testId('tool-permissions-group-select-always-asks'))
      .findAll('option')
      .map(option => option.text()))
      .toEqual(['Blocked', 'Needs approval'])
  })

  it('applies a group mode only to tools that take it and differ', async () => {
    const wrapper = await mountGroups()

    await wrapper.get(testId('tool-permissions-group-select-write'))
      .setValue('allow')

    expect(wrapper.emitted('setGroup')).toEqual([[
      'write',
      'allow',
      [{ name: 'update_page', mode: 'allow' }],
    ]])
  })

  it('emits one tool change from a row control', async () => {
    const wrapper = await mountGroups()

    await wrapper.get(
      '[data-testid="tool-permissions-row"][data-tool-name="create_page"] '
      + '[data-testid="tool-permission-option-blocked"]',
    ).trigger('click')

    expect(wrapper.emitted('setTools'))
      .toEqual([[[{ name: 'create_page', mode: 'blocked' }]]])
  })
})

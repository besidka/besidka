import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ScopePicker from '../../../../app/components/OAuth/ScopePicker.vue'

const ALL_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'chats:read',
  'projects:read',
  'memory:read',
  'files:read',
  'settings:read',
  'projects:write',
  'memory:write',
  'chats:write',
  'files:write',
  'settings:write',
  'data:delete',
]

function lastSelection(wrapper: any): string[] {
  const events = wrapper.emitted('update:modelValue') as string[][][]

  return events.at(-1)![0]!
}

describe('OAuth scope picker', () => {
  it('selects read scopes and leaves write scopes off by default', async () => {
    const wrapper = await mountSuspended(ScopePicker, {
      props: { scopes: ALL_SCOPES, modelValue: [] },
    })

    expect(lastSelection(wrapper)).toEqual([
      'chats:read',
      'projects:read',
      'memory:read',
      'files:read',
      'settings:read',
    ])
  })

  it('renders write scope checkboxes unchecked', async () => {
    const wrapper = await mountSuspended(ScopePicker, {
      props: { scopes: ALL_SCOPES, modelValue: [] },
    })

    await wrapper.setProps({ modelValue: lastSelection(wrapper) })

    const read = wrapper.find('[data-testid="oauth-scope-chats:read"]')
    const projectsWrite = wrapper.find(
      '[data-testid="oauth-scope-projects:write"]',
    )
    const memoryWrite = wrapper.find('[data-testid="oauth-scope-memory:write"]')

    expect((read.element as HTMLInputElement).checked).toBe(true)
    expect((projectsWrite.element as HTMLInputElement).checked).toBe(false)
    expect((memoryWrite.element as HTMLInputElement).checked).toBe(false)
  })

  it('shows the write warning only when write scopes are requested',
    async () => {
      const withWrite = await mountSuspended(ScopePicker, {
        props: { scopes: ALL_SCOPES, modelValue: [] },
      })
      const readOnly = await mountSuspended(ScopePicker, {
        props: { scopes: ['openid', 'chats:read'], modelValue: [] },
      })

      expect(withWrite.find('[data-testid="oauth-write-warning"]').exists())
        .toBe(true)
      expect(readOnly.find('[data-testid="oauth-write-warning"]').exists())
        .toBe(false)
    })

  it('renders the delete scope unchecked with the warning style', async () => {
    const wrapper = await mountSuspended(ScopePicker, {
      props: { scopes: ALL_SCOPES, modelValue: [] },
    })

    await wrapper.setProps({ modelValue: lastSelection(wrapper) })

    const dataDelete = wrapper.find('[data-testid="oauth-scope-data:delete"]')

    expect((dataDelete.element as HTMLInputElement).checked).toBe(false)
    expect(dataDelete.classes()).toContain('checkbox-warning')
    expect(lastSelection(wrapper)).not.toContain('data:delete')
    expect(wrapper.find('[data-testid="oauth-write-warning"]').text())
      .toContain('permanently delete')
  })

  it('adds the delete scope only when the user ticks it', async () => {
    const wrapper = await mountSuspended(ScopePicker, {
      props: { scopes: ALL_SCOPES, modelValue: [] },
    })

    await wrapper.setProps({ modelValue: lastSelection(wrapper) })
    await wrapper.find('[data-testid="oauth-scope-data:delete"]')
      .trigger('change')

    expect(lastSelection(wrapper)).toContain('data:delete')
  })

  it('lists identity scopes as implicit, without checkboxes', async () => {
    const wrapper = await mountSuspended(ScopePicker, {
      props: { scopes: ALL_SCOPES, modelValue: [] },
    })

    expect(wrapper.find('[data-testid="oauth-scope-openid"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="oauth-identity-scopes"]').text())
      .toContain('Stay connected')
  })

  it('adds a write scope when the user ticks it', async () => {
    const wrapper = await mountSuspended(ScopePicker, {
      props: { scopes: ALL_SCOPES, modelValue: [] },
    })

    await wrapper.setProps({ modelValue: lastSelection(wrapper) })
    await wrapper.find('[data-testid="oauth-scope-memory:write"]')
      .trigger('change')

    expect(lastSelection(wrapper)).toContain('memory:write')
  })
})

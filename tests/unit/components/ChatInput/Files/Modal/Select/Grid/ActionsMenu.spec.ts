import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ActionsMenu from '../../../../../../../../app/components/ChatInput/Files/Modal/Select/Grid/ActionsMenu.vue'

function mountMenu() {
  return mountSuspended(ActionsMenu, {
    props: { fileName: 'Plan.docx' },
  })
}

describe('ChatInput/Files/Modal/Select/Grid/ActionsMenu', () => {
  it('is shown only below sm and links its trigger to a popover menu', async () => {
    const wrapper = await mountMenu()
    const trigger = wrapper.get('[data-testid="files-action-more"]')
    const menu = wrapper.get('[data-testid="files-actions-menu"]')

    expect(wrapper.classes()).toContain('sm:hidden')
    expect(trigger.classes()).toEqual(expect.arrayContaining([
      'btn',
      'btn-circle',
      'btn-xs',
    ]))
    expect(trigger.attributes('popovertarget')).toBe(menu.attributes('id'))
    expect(menu.attributes('popover')).toBe('auto')
  })

  it('emits rename and delete from its items', async () => {
    const wrapper = await mountMenu()

    await wrapper.get('[data-testid="files-menu-rename"]').trigger('click')
    await wrapper.get('[data-testid="files-menu-delete"]').trigger('click')

    expect(wrapper.emitted('rename')).toHaveLength(1)
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })
})

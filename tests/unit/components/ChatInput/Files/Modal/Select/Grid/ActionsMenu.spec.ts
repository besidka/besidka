import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

  describe('placement', () => {
    const MENU_WIDTH = 144
    const MENU_HEIGHT = 76

    beforeEach(() => {
      vi.stubGlobal('innerWidth', 375)
      vi.stubGlobal('innerHeight', 600)
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    async function openMenuAt(triggerRect: Partial<DOMRect>) {
      const wrapper = await mountMenu()
      const trigger = wrapper.get('[data-testid="files-action-more"]').element
      const menu = wrapper.get('[data-testid="files-actions-menu"]').element as HTMLElement

      vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
        width: 28,
        height: 28,
        ...triggerRect,
      } as DOMRect)
      Object.defineProperty(menu, 'offsetWidth', { value: MENU_WIDTH })
      Object.defineProperty(menu, 'offsetHeight', { value: MENU_HEIGHT })

      menu.dispatchEvent(Object.assign(new Event('beforetoggle'), {
        newState: 'open',
      }))

      expect(menu.style.visibility).toBe('hidden')

      menu.dispatchEvent(Object.assign(new Event('toggle'), {
        newState: 'open',
      }))

      expect(menu.style.visibility).toBe('')

      return menu
    }

    it('opens under the trigger when there is room', async () => {
      const menu = await openMenuAt({ top: 100, bottom: 128, right: 300 })

      expect(menu.style.top).toBe('132px')
      expect(menu.style.left).toBe('156px')
    })

    it('opens above the trigger when the tile is cut off at the bottom', async () => {
      const menu = await openMenuAt({ top: 560, bottom: 588, right: 300 })

      expect(menu.style.top).toBe(`${560 - 4 - MENU_HEIGHT}px`)
    })

    it('never places the menu above the viewport margin', async () => {
      const menu = await openMenuAt({ top: 20, bottom: 48, right: 300 })

      vi.stubGlobal('innerHeight', 90)
      menu.dispatchEvent(Object.assign(new Event('toggle'), {
        newState: 'open',
      }))

      expect(Number.parseFloat(menu.style.top)).toBeGreaterThanOrEqual(8)
    })

    it('keeps the menu inside the viewport horizontally', async () => {
      const menu = await openMenuAt({ top: 100, bottom: 128, right: 40 })

      expect(menu.style.left).toBe('8px')
    })
  })
})

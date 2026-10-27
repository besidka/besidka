import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ProjectsActionsDropdown
  from '../../../../app/components/Projects/ActionsDropdown.vue'
import { createProject } from '../../../setup/helpers/history-fixtures'

describe('ProjectsActionsDropdown', () => {
  it('opens on trigger click and closes after selecting an action', async () => {
    const wrapper = await mountSuspended(ProjectsActionsDropdown, {
      props: {
        project: createProject(),
      },
      global: {
        stubs: {
          Icon: true,
        },
      },
    })

    const dropdown = wrapper.get('details')

    expect((dropdown.element as HTMLDetailsElement).open).toBe(false)

    ;(dropdown.element as HTMLDetailsElement).open = true
    await wrapper.vm.$nextTick()

    const renameButton = wrapper.findAll('button').find((button) => {
      return button.text().includes('Rename')
    })

    expect(renameButton).toBeDefined()

    await renameButton!.trigger('click')

    expect(wrapper.emitted('rename')).toHaveLength(1)
    expect((dropdown.element as HTMLDetailsElement).open).toBe(false)
  })

  describe('menu placement', () => {
    const MENU_HEIGHT = 320
    const TRIGGER_HEIGHT = 32

    afterEach(() => {
      vi.restoreAllMocks()
      Object.defineProperty(window, 'visualViewport', {
        value: null,
        configurable: true,
      })
    })

    async function openAtTriggerTop(
      triggerTop: number,
      viewportHeight: number,
    ) {
      Object.defineProperty(window, 'visualViewport', {
        value: { offsetTop: 0, height: viewportHeight },
        configurable: true,
      })

      const wrapper = await mountSuspended(ProjectsActionsDropdown, {
        props: {
          project: createProject(),
        },
        global: {
          stubs: {
            Icon: true,
          },
        },
      })

      vi.spyOn(
        wrapper.get('[data-testid="history-project-actions-trigger"]').element,
        'getBoundingClientRect',
      ).mockReturnValue({
        top: triggerTop,
        bottom: triggerTop + TRIGGER_HEIGHT,
        height: TRIGGER_HEIGHT,
      } as DOMRect)
      Object.defineProperty(
        wrapper.get('[data-testid="history-project-actions-menu"]').element,
        'offsetHeight',
        { value: MENU_HEIGHT, configurable: true },
      )

      const dropdown = wrapper.get('details')

      ;(dropdown.element as HTMLDetailsElement).open = true
      await dropdown.trigger('toggle')

      return wrapper
    }

    it('opens downward while there is room below the trigger', async () => {
      const wrapper = await openAtTriggerTop(100, 800)

      expect(wrapper.get('details').classes()).toContain('dropdown-bottom')
      expect(wrapper.get('details').classes()).not.toContain('dropdown-top')
    })

    it('flips upward when the menu would run past the viewport bottom',
      async () => {
        const wrapper = await openAtTriggerTop(700, 800)

        expect(wrapper.get('details').classes()).toContain('dropdown-top')
        expect(wrapper.get('details').classes())
          .not.toContain('dropdown-bottom')
        expect(wrapper.get('[data-testid="history-project-actions-menu"]')
          .classes()).toContain('pb-2')
      })

    it('stays downward when neither side has room and below has more',
      async () => {
        const wrapper = await openAtTriggerTop(100, 300)

        expect(wrapper.get('details').classes()).toContain('dropdown-bottom')
      })

    it('flips upward in a short visual viewport', async () => {
      const wrapper = await openAtTriggerTop(400, 500)

      expect(wrapper.get('details').classes()).toContain('dropdown-top')
    })
  })
})

import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import HistoryFolderActionsDropdown
  from '../../../../app/components/History/FolderActionsDropdown.vue'
import { createFolder } from '../../../setup/helpers/history-fixtures'

describe('HistoryFolderActionsDropdown', () => {
  it('opens on trigger click and closes after selecting an action', async () => {
    const wrapper = await mountSuspended(HistoryFolderActionsDropdown, {
      props: {
        folder: createFolder(),
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
})

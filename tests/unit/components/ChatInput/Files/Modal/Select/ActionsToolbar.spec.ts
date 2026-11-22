import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import ActionsToolbar from '../../../../../../../app/components/ChatInput/Files/Modal/Select/ActionsToolbar.vue'

function mountToolbar(props: Record<string, unknown> = {}) {
  return mountSuspended(ActionsToolbar, {
    props: {
      selectedCount: 2,
      maxFiles: 10,
      visible: true,
      isDeleting: false,
      ...props,
    },
  })
}

describe('ChatInput/Files/Modal/Select/ActionsToolbar', () => {
  it('keeps the two actions of the built-in sources by default', async () => {
    const wrapper = await mountToolbar()

    expect(wrapper.find('[data-testid="files-refresh-selected"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="files-delete-selected"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="files-attach-selected"]').exists())
      .toBe(true)
  })

  it('adds a Refresh action that emits refresh when refreshable', async () => {
    const wrapper = await mountToolbar({ refreshable: true })
    const refresh = wrapper.get('[data-testid="files-refresh-selected"]')

    expect(refresh.text()).toBe('Refresh')

    await refresh.trigger('click')

    expect(wrapper.emitted('refresh')).toHaveLength(1)
  })

  it('disables Refresh and says so while refreshing', async () => {
    const wrapper = await mountToolbar({
      refreshable: true,
      isRefreshing: true,
    })
    const refresh = wrapper.get('[data-testid="files-refresh-selected"]')

    expect(refresh.text()).toBe('Refreshing')
    expect(refresh.attributes('disabled')).toBeDefined()
  })

  it('hides itself when nothing is selected', async () => {
    const wrapper = await mountToolbar({ visible: false })

    expect(wrapper.find('[data-testid="files-attach-selected"]').exists())
      .toBe(false)
  })
})

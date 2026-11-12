import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowRef } from 'vue'
import Messages from '../../../../app/components/ui/Messages.vue'
import { useMessages } from '../../../../app/composables/messages'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  useTopModalDialog: vi.fn(),
}))

mockNuxtImport('useTopModalDialog', () => mocks.useTopModalDialog)

describe('ui/Messages', () => {
  let topDialog: ReturnType<typeof shallowRef<HTMLDialogElement | null>>

  beforeEach(() => {
    topDialog = shallowRef<HTMLDialogElement | null>(null)
    mocks.useTopModalDialog.mockReturnValue(topDialog)
    useMessages().value = [{
      id: 1,
      title: 'Plan.docx is ready',
      type: 'info',
    }]
  })

  afterEach(() => {
    document.querySelectorAll('dialog.test-dialog').forEach((dialog) => {
      dialog.remove()
    })
  })

  function mountMessages() {
    return mountSuspended(Messages, {
      global: { stubs: { Teleport: true } },
    })
  }

  it('renders in place while no modal dialog is open', async () => {
    const wrapper = await mountMessages()
    const teleport = wrapper.get('teleport-stub')

    expect(teleport.attributes('disabled')).toBe('true')
    expect(teleport.attributes('to')).toBe('body')
    expect(wrapper.findAll('[role="alert"]')).toHaveLength(1)
  })

  it('teleports into the open modal dialog so it stays clickable above it', async () => {
    const dialog = document.createElement('dialog')

    dialog.className = 'test-dialog'
    document.body.appendChild(dialog)

    const wrapper = await mountMessages()

    topDialog.value = dialog
    await wrapper.vm.$nextTick()

    const teleport = wrapper.get('teleport-stub')

    expect(teleport.attributes('disabled')).toBe('false')
    expect(teleport.attributes('to')).toContain('test-dialog')
  })

  it('moves back to the page when the dialog closes', async () => {
    const dialog = document.createElement('dialog')

    dialog.className = 'test-dialog'
    document.body.appendChild(dialog)
    topDialog.value = dialog

    const wrapper = await mountMessages()

    topDialog.value = null
    await wrapper.vm.$nextTick()

    expect(wrapper.get('teleport-stub').attributes('disabled')).toBe('true')
  })
})

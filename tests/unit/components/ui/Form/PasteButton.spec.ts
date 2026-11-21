import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PasteButton from '../../../../../app/components/ui/Form/PasteButton.vue'

const mocks = vi.hoisted(() => ({
  paste: vi.fn(async () => ''),
}))

mockNuxtImport('useClipboardWithPaste', () => {
  return () => ({ paste: mocks.paste })
})

describe('UiFormPasteButton', () => {
  beforeEach(() => {
    mocks.paste.mockReset()
    mocks.paste.mockResolvedValue('')
  })

  it('renders an icon-only button labeled Paste', async () => {
    const wrapper = await mountSuspended(PasteButton)
    const button = wrapper.find('button')

    expect(button.attributes('aria-label')).toBe('Paste')
    expect(button.attributes('type')).toBe('button')
  })

  it('emits the clipboard text when clicked', async () => {
    mocks.paste.mockResolvedValue('from-clipboard')

    const wrapper = await mountSuspended(PasteButton)

    await wrapper.find('button').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.emitted('paste')).toEqual([['from-clipboard']])
    })
  })

  it('emits nothing when the clipboard read gives no text', async () => {
    mocks.paste.mockResolvedValue('')

    const wrapper = await mountSuspended(PasteButton)

    await wrapper.find('button').trigger('click')
    await vi.waitFor(() => {
      expect(mocks.paste).toHaveBeenCalled()
    })

    expect(wrapper.emitted('paste')).toBeUndefined()
  })

  it('does not emit while disabled', async () => {
    const wrapper = await mountSuspended(PasteButton, {
      props: { disabled: true },
    })

    expect(wrapper.find('button').exists()).toBe(false)

    await wrapper.find('span[aria-label="Paste"]').trigger('click')

    expect(mocks.paste).not.toHaveBeenCalled()
    expect(wrapper.emitted('paste')).toBeUndefined()
  })
})

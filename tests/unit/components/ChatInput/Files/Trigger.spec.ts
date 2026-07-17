import { shallowRef } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Trigger from '../../../../../app/components/ChatInput/Files/Trigger.vue'

const mocks = vi.hoisted(() => ({
  onClickOutside: vi.fn(),
  useDevice: vi.fn(),
  useElementHover: vi.fn(),
}))

mockNuxtImport('onClickOutside', () => mocks.onClickOutside)
mockNuxtImport('useDevice', () => mocks.useDevice)
mockNuxtImport('useElementHover', () => mocks.useElementHover)

describe('ChatInput/Files/Trigger', () => {
  beforeEach(() => {
    mocks.useDevice.mockReturnValue({
      isIos: false,
      isAndroid: false,
    })
    mocks.useElementHover.mockReturnValue(shallowRef<boolean>(false))
  })

  it('opens the modal on the select tab filtered to assistant files', async () => {
    const wrapper = await mountSuspended(Trigger, {
      props: {
        files: [],
      },
    })

    await wrapper.get('[data-testid="files-open-generated"]').trigger('click')

    expect(wrapper.emitted('open')).toEqual([['select', 'assistant']])
  })

  it('opens the modal on the select tab without a source override', async () => {
    const wrapper = await mountSuspended(Trigger, {
      props: {
        files: [],
      },
    })

    await wrapper.get('[data-testid="files-open-select"]').trigger('click')

    expect(wrapper.emitted('open')).toEqual([['select', undefined]])
  })
})

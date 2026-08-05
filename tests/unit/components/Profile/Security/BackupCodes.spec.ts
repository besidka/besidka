import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import BackupCodes from '../../../../../app/components/Profile/Security/BackupCodes.vue'

const codes = [
  'abcde-fghij',
  'klmno-pqrst',
  'uvwxy-zabcd',
]

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

describe('Profile/Security/BackupCodes', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders every backup code', async () => {
    const wrapper = await mountSuspended(BackupCodes, {
      props: { open: true, codes },
    })

    await flushPromises()

    for (const code of codes) {
      expect(wrapper.text()).toContain(code)
    }
  })

  it('has no backdrop element to dismiss through', async () => {
    const wrapper = await mountSuspended(BackupCodes, {
      props: { open: true, codes },
    })

    expect(wrapper.find('.modal-backdrop').exists()).toBe(false)
  })

  it('prevents the dialog cancel event (Escape key) from dismissing it',
    async () => {
      const wrapper = await mountSuspended(BackupCodes, {
        props: { open: true, codes },
      })

      await flushPromises()

      const dialog = wrapper.get('dialog').element as HTMLDialogElement
      const cancelEvent = new Event('cancel', { cancelable: true })

      dialog.dispatchEvent(cancelEvent)
      await flushPromises()

      expect(cancelEvent.defaultPrevented).toBe(true)
      expect(wrapper.emitted('acknowledge')).toBeUndefined()
    })

  it('only emits acknowledge through the explicit save confirmation',
    async () => {
      const wrapper = await mountSuspended(BackupCodes, {
        props: { open: true, codes },
      })

      await wrapper.get('[data-testid="backup-codes-acknowledge"]')
        .trigger('click')

      expect(wrapper.emitted('acknowledge')).toHaveLength(1)
    })

  it('copies every code, newline separated, to the clipboard', async () => {
    const wrapper = await mountSuspended(BackupCodes, {
      props: { open: true, codes },
    })

    await wrapper.get('[data-testid="backup-codes-copy"]').trigger('click')
    await flushPromises()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      codes.join('\n'),
    )
  })

  it('downloads all codes as a text file', async () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {})
    const createObjectURLSpy = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-url')
    const revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {})

    const wrapper = await mountSuspended(BackupCodes, {
      props: { open: true, codes },
    })

    await wrapper.get('[data-testid="backup-codes-download"]')
      .trigger('click')

    expect(createObjectURLSpy).toHaveBeenCalledTimes(1)

    const blobArgument = createObjectURLSpy.mock.calls[0]?.[0] as Blob
    const text = await blobArgument.text()

    expect(text).toBe(codes.join('\n'))
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:mock-url')
  })
})

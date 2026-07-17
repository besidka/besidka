import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImagePreview from '../../../../app/components/Chat/ImagePreview.client.vue'

describe('Chat/ImagePreview', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads the image only when the controlled dialog opens', async () => {
    const wrapper = await mountSuspended(ImagePreview, {
      props: {
        open: false,
        src: '/files/generated.webp',
        downloadUrl: '/files/generated.webp?download=1',
        alt: 'Generated landscape',
        filename: 'generated.webp',
      },
      global: {
        stubs: {
          teleport: true,
        },
      },
    })

    expect(wrapper.find('[data-testid="image-preview-image"]').exists())
      .toBe(false)

    await wrapper.setProps({ open: true })
    await flushPromises()

    const dialog = wrapper.get('[data-testid="image-preview-modal"]')
    const image = wrapper.get('[data-testid="image-preview-image"]')
    const download = wrapper.get('[data-testid="image-preview-download"]')

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(image.attributes('src')).toBe('/files/generated.webp')
    expect(image.attributes('alt')).toBe('Generated landscape')
    expect(download.attributes('href'))
      .toBe('/files/generated.webp?download=1')
    expect(wrapper.get('[data-testid="image-preview-close"]')
      .attributes('aria-label')).toBe('Close image preview')
    expect(wrapper.findAll('form[method="dialog"]')).toHaveLength(2)
  })

  it('opens when a lazy parent first mounts it as active', async () => {
    const wrapper = await mountSuspended(ImagePreview, {
      props: {
        open: true,
        src: '/files/generated.webp',
        downloadUrl: '/files/generated.webp?download=1',
        alt: 'Generated landscape',
        filename: 'generated.webp',
      },
      global: {
        stubs: {
          teleport: true,
        },
      },
    })

    await flushPromises()

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    expect(wrapper.get('[data-testid="image-preview-image"]')
      .attributes('src')).toBe('/files/generated.webp')
  })

  it('restores focus when the dialog closes', async () => {
    const trigger = document.createElement('button')

    document.body.append(trigger)
    trigger.focus()

    const wrapper = await mountSuspended(ImagePreview, {
      props: {
        open: false,
        src: '/files/generated.webp',
        downloadUrl: '/files/generated.webp?download=1',
        alt: 'Generated landscape',
        filename: 'generated.webp',
      },
      global: {
        stubs: {
          teleport: true,
        },
      },
    })

    await wrapper.setProps({ open: true })
    await flushPromises()

    await wrapper.setProps({ open: false })
    await flushPromises()

    expect(document.activeElement).toBe(trigger)

    trigger.remove()
  })
})

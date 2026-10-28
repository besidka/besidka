import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ImagePreview from '../../../../app/components/Chat/ImagePreview.client.vue'

const mocks = vi.hoisted(() => {
  const instance = {
    destroy: vi.fn(),
    reset: vi.fn(),
    resetStyle: vi.fn(),
    zoomToPoint: vi.fn(),
    zoomWithWheel: vi.fn(),
    getScale: vi.fn(() => 1),
  }

  return {
    instance,
    panzoom: vi.fn(() => instance),
  }
})

vi.mock('@panzoom/panzoom', () => {
  return { default: mocks.panzoom }
})

const defaultProps = {
  src: '/files/generated.webp',
  downloadUrl: '/files/generated.webp?download=1',
  alt: 'Generated landscape',
  filename: 'generated.webp',
}

describe('Chat/ImagePreview', () => {
  beforeEach(() => {
    mocks.panzoom.mockClear()
    mocks.instance.destroy.mockClear()
    mocks.instance.reset.mockClear()
    mocks.instance.resetStyle.mockClear()
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

  it('makes the download button circular below the xs breakpoint', async () => {
    const wrapper = await mountSuspended(ImagePreview, {
      props: { open: true, ...defaultProps },
      global: { stubs: { teleport: true } },
    })

    await flushPromises()

    const download = wrapper.get('[data-testid="image-preview-download"]')

    expect(download.classes()).toContain('max-xs:btn-circle')
    expect(download.get('span:last-child').classes())
      .toContain('max-xs:sr-only')
    expect(download.text()).toContain('Download')
  })

  it('creates panzoom on the zoom surface with fit-bound options', async () => {
    const wrapper = await mountSuspended(ImagePreview, {
      props: { open: false, ...defaultProps },
      global: { stubs: { teleport: true } },
    })

    expect(mocks.panzoom).not.toHaveBeenCalled()

    await wrapper.setProps({ open: true })
    await flushPromises()

    expect(mocks.panzoom).toHaveBeenCalledTimes(1)

    const [surface, options] = mocks.panzoom.mock.calls[0] as unknown as [
      HTMLElement,
      Record<string, unknown>,
    ]

    expect(surface)
      .toBe(wrapper.get('[data-testid="image-preview-surface"]').element)
    expect(surface.contains(
      wrapper.get('[data-testid="image-preview-image"]').element,
    )).toBe(true)
    expect(options).toMatchObject({
      contain: 'outside',
      minScale: 1,
      maxScale: 5,
      startScale: 1,
      panOnlyWhenZoomed: true,
      touchAction: 'none',
    })
  })

  it('destroys panzoom when the dialog closes', async () => {
    const wrapper = await mountSuspended(ImagePreview, {
      props: { open: true, ...defaultProps },
      global: { stubs: { teleport: true } },
    })

    await flushPromises()

    expect(mocks.panzoom).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ open: false })
    await flushPromises()

    expect(mocks.instance.reset).toHaveBeenCalledWith({ animate: false })
    expect(mocks.instance.resetStyle).toHaveBeenCalledTimes(1)
    expect(mocks.instance.destroy).toHaveBeenCalled()
  })

  it('recreates panzoom at fit scale when the src changes', async () => {
    const wrapper = await mountSuspended(ImagePreview, {
      props: { open: true, ...defaultProps },
      global: { stubs: { teleport: true } },
    })

    await flushPromises()
    await wrapper.setProps({ src: '/files/other.webp' })
    await flushPromises()

    expect(mocks.panzoom).toHaveBeenCalledTimes(2)
    expect(mocks.instance.destroy).toHaveBeenCalledTimes(1)
  })

  it('destroys panzoom when unmounted while open', async () => {
    const wrapper = await mountSuspended(ImagePreview, {
      props: { open: true, ...defaultProps },
      global: { stubs: { teleport: true } },
    })

    await flushPromises()
    wrapper.unmount()

    expect(mocks.instance.resetStyle).toHaveBeenCalledTimes(1)
    expect(mocks.instance.destroy).toHaveBeenCalledTimes(1)
  })
})

import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineAsyncComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ConnectorThumbnail from '../../../../../app/components/Chat/Reasoning/ConnectorThumbnail.vue'
import ImagePreview from '../../../../../app/components/Chat/ImagePreview.client.vue'

vi.mock('@panzoom/panzoom', () => {
  return {
    default: vi.fn(() => {
      return {
        destroy: vi.fn(),
        getScale: vi.fn(() => 1),
        reset: vi.fn(),
        resetStyle: vi.fn(),
        zoomToPoint: vi.fn(),
      }
    }),
  }
})

const LazyImagePreview = defineAsyncComponent(() => {
  return Promise.resolve(ImagePreview)
})

function imageOf(overrides: Record<string, unknown> = {}) {
  return {
    toolCallId: 'call-1',
    fileId: 'file-1',
    url: '/files/connector-abc.png',
    mediaType: 'image/png',
    width: 640,
    height: 480,
    size: 75,
    name: 'doop-get_frame_screenshot.png',
    ...overrides,
  }
}

async function mountThumbnail(image = imageOf(), extraCount = 0) {
  return await mountSuspended(ConnectorThumbnail, {
    props: { image, alt: 'Screenshot from Doop', extraCount },
    global: {
      stubs: { LazyChatImagePreview: LazyImagePreview, teleport: true },
    },
  })
}

describe('Chat/Reasoning/ConnectorThumbnail', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
      })
  })

  it('shows a lazy thumbnail with the alt text and its size', async () => {
    const wrapper = await mountThumbnail()
    const image = wrapper.get('img')

    expect(image.attributes('alt')).toBe('Screenshot from Doop')
    expect(image.attributes('loading')).toBe('lazy')
    expect(image.attributes('src')).toContain('connector-abc.png')
    expect(image.attributes('width')).toBe('640')
  })

  it('opens the shared image viewer with the download link', async () => {
    const wrapper = await mountThumbnail()

    expect(wrapper.find('[data-testid="image-preview-modal"]').exists())
      .toBe(false)

    await wrapper.get('[data-testid="reasoning-connector-image"]')
      .trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="image-preview-modal"]').exists())
      .toBe(true)
    expect(wrapper.get('[data-testid="image-preview-image"]')
      .attributes('alt')).toBe('Screenshot from Doop')
    expect(wrapper.get('[data-testid="image-preview-download"]')
      .attributes('href')).toContain('download=1')
    expect(wrapper.find('[data-testid="image-preview-ai-badge"]').exists())
      .toBe(false)
  })

  it('opens the clicked image of a gallery and moves through the rest',
    async () => {
      const first = imageOf({ fileId: 'a', url: '/files/connector-a.png' })
      const gone = imageOf({ fileId: 'b', deleted: true })
      const third = imageOf({
        toolCallId: 'call-2',
        fileId: 'c',
        url: '/files/connector-c.png',
        name: 'figma-get_screenshot.png',
      })
      const wrapper = await mountSuspended(ConnectorThumbnail, {
        props: {
          image: third,
          alt: 'Screenshot from Figma',
          gallery: [
            { image: first, alt: 'Screenshot from Doop' },
            { image: gone, alt: 'Screenshot from Doop' },
            { image: third, alt: 'Screenshot from Figma' },
          ],
        },
        global: {
          stubs: { LazyChatImagePreview: LazyImagePreview, teleport: true },
        },
      })

      await wrapper.get('[data-testid="reasoning-connector-image"]')
        .trigger('click')
      await flushPromises()

      const position = () => {
        return wrapper.get('[data-testid="image-preview-position"]').text()
      }
      const shownSource = () => {
        return wrapper.get('[data-testid="image-preview-image"]')
          .attributes('src')
      }

      expect(position()).toBe('2 of 2')
      expect(shownSource()).toContain('connector-c.png')
      expect(wrapper.get('[data-testid="image-preview-next"]')
        .attributes('aria-disabled')).toBe('true')

      await wrapper.get('[data-testid="image-preview-previous"]')
        .trigger('click')

      expect(position()).toBe('1 of 2')
      expect(shownSource()).toContain('connector-a.png')
      expect(wrapper.get('[data-testid="image-preview-image"]')
        .attributes('alt')).toBe('Screenshot from Doop')
      expect(wrapper.get('[data-testid="image-preview-download"]')
        .attributes('href')).toContain('connector-a.png')

      await wrapper.get('[data-testid="image-preview-modal"]')
        .trigger('keydown', { key: 'ArrowRight' })

      expect(position()).toBe('2 of 2')
      expect(shownSource()).toContain('connector-c.png')

      await wrapper.get('[data-testid="image-preview-next"]').trigger('click')

      expect(position()).toBe('2 of 2')
    })

  it('shows no navigation for a single image', async () => {
    const wrapper = await mountThumbnail()

    await wrapper.get('[data-testid="reasoning-connector-image"]')
      .trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="image-preview-gallery"]').exists())
      .toBe(false)
  })

  it('shows a muted deleted tile and no image for a deleted file',
    async () => {
      const wrapper = await mountThumbnail(imageOf({ deleted: true }))

      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.get('[data-testid="reasoning-connector-image-deleted"]')
        .text()).toContain('Image deleted')
    })

  it('turns into the not found tile when the image fails to load',
    async () => {
      const wrapper = await mountThumbnail()

      await wrapper.get('img').trigger('error')

      expect(wrapper.get('[data-testid="reasoning-connector-image-deleted"]')
        .text()).toContain('Image not found')
    })

  it('shows how many more images the step has', async () => {
    const wrapper = await mountThumbnail(imageOf(), 2)

    expect(wrapper.get('[data-testid="reasoning-connector-image-more"]')
      .text()).toBe('+2')
  })
})

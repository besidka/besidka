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

  it('opens a stack on its top image and moves through the rest',
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

      await wrapper.get('[data-testid="reasoning-connector-image-stack"]')
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

  it('shows a muted round deleted avatar and no image for a deleted file',
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

  it('collapses several images into one focusable daisyUI avatar group',
    async () => {
      const gallery = ['a', 'b', 'c', 'd', 'e'].map((fileId) => {
        return {
          image: imageOf({ fileId, url: `/files/connector-${fileId}.png` }),
          alt: 'Screenshot from Doop',
        }
      })
      const wrapper = await mountSuspended(ConnectorThumbnail, {
        props: {
          image: gallery[0]!.image,
          alt: 'Screenshot from Doop',
          gallery,
          stackLabel: 'Open 5 screenshots from Doop',
          size: 'sm',
        },
        global: {
          stubs: { LazyChatImagePreview: LazyImagePreview, teleport: true },
        },
      })
      const button = wrapper.get(
        '[data-testid="reasoning-connector-image-stack"]',
      )
      const group = button.get('.avatar-group')

      expect(button.element.tagName).toBe('BUTTON')
      expect(button.attributes('aria-label'))
        .toBe('Open 5 screenshots from Doop')
      expect(button.classes()).toContain('rounded-full')
      expect(group.classes()).toContain('-space-x-3')
      expect(group.findAll('.avatar')).toHaveLength(4)
      expect(group.findAll('img').map(image => image.attributes('src')))
        .toEqual([
          expect.stringContaining('connector-a.png'),
          expect.stringContaining('connector-b.png'),
          expect.stringContaining('connector-c.png'),
        ])
      expect(group.findAll('img').map(image => image.attributes('alt')))
        .toEqual(['', '', ''])

      const counter = group.get(
        '[data-testid="reasoning-connector-image-more"]',
      )

      expect(counter.classes()).toEqual(expect.arrayContaining([
        'avatar',
        'avatar-placeholder',
      ]))
      expect(counter.get('div').classes()).toEqual(expect.arrayContaining([
        'bg-neutral',
        'text-neutral-content',
        'w-5',
      ]))
      expect(counter.text()).toBe('+2')

      await button.trigger('click')
      await flushPromises()

      expect(wrapper.get('[data-testid="image-preview-position"]').text())
        .toBe('1 of 5')
      expect(wrapper.get('[data-testid="image-preview-image"]')
        .attributes('src')).toContain('connector-a.png')
    })

  it('shows no counter avatar for three images and the row size for md',
    async () => {
      const gallery = ['a', 'b', 'c'].map((fileId) => {
        return {
          image: imageOf({ fileId, url: `/files/connector-${fileId}.png` }),
          alt: 'Screenshot from Doop',
        }
      })
      const wrapper = await mountSuspended(ConnectorThumbnail, {
        props: {
          image: gallery[0]!.image,
          alt: 'Screenshot from Doop',
          gallery,
          stackLabel: 'Open 3 screenshots from Doop',
        },
        global: {
          stubs: { LazyChatImagePreview: LazyImagePreview, teleport: true },
        },
      })
      const group = wrapper.get('.avatar-group')

      expect(group.classes()).toContain('-space-x-4')
      expect(group.findAll('.avatar')).toHaveLength(3)
      expect(group.findAll('.avatar > div')[0]!.classes()).toContain('w-7')
      expect(wrapper.find('[data-testid="reasoning-connector-image-more"]')
        .exists()).toBe(false)
    })

  it('keeps a single image as one round avatar without a group',
    async () => {
      const wrapper = await mountThumbnail()
      const button = wrapper.get('[data-testid="reasoning-connector-image"]')

      expect(wrapper.find('.avatar-group').exists()).toBe(false)
      expect(button.classes()).toEqual(expect.arrayContaining([
        'avatar',
        'rounded-full',
      ]))
      expect(button.get('div').classes()).toEqual(expect.arrayContaining([
        'rounded-full',
        'size-8',
      ]))
      expect(button.get('img').attributes('alt')).toBe('Screenshot from Doop')
    })
})

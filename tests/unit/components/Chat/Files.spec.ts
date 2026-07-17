import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { defineAsyncComponent } from 'vue'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { HIDDEN_FILE_MEDIA_TYPE } from '#shared/utils/files'
import Files from '../../../../app/components/Chat/Files.vue'
import ImagePreview from '../../../../app/components/Chat/ImagePreview.client.vue'

const LazyImagePreview = defineAsyncComponent(() => {
  return Promise.resolve(ImagePreview)
})

describe('Chat/Files', () => {
  beforeEach(() => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get')
      .mockReturnValue(false)
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function () {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function () {
        this.removeAttribute('open')
      })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('derives preview and action links from a safe tokenized file URL', async () => {
    const wrapper = await mountSuspended(Files, {
      props: {
        message: {
          id: 'message-1',
          role: 'assistant',
          parts: [{
            type: 'file',
            mediaType: 'image/webp',
            filename: 'shared.webp',
            url:
              '/files/shared.webp?token=header.payload.signature#preview',
          }],
        },
      },
      global: {
        stubs: {
          LazyChatImagePreview: LazyImagePreview,
          teleport: true,
        },
      },
    })

    expect(wrapper.get('img').attributes('src'))
      .toBe('/files/shared.webp?token=header.payload.signature#preview')
    expect(wrapper.find('[data-testid="image-preview-modal"]').exists())
      .toBe(false)
    expect(wrapper.findAll('img')).toHaveLength(1)
    const open = wrapper.get('[data-testid="chat-file-open"]')

    expect(open.element.tagName).toBe('BUTTON')
    expect(open.attributes('href')).toBeUndefined()
    expect(
      wrapper.get('[data-testid="chat-file-download"]').attributes('href'),
    ).toBe(
      '/files/shared.webp?token=header.payload.signature&download=1#preview',
    )

    await wrapper.get('[data-testid="chat-file-preview-trigger"]')
      .trigger('click')
    await flushPromises()

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-testid="image-preview-modal"]').exists())
      .toBe(true)
    expect(wrapper.get('[data-testid="image-preview-image"]')
      .attributes('src')).toBe(
      '/files/shared.webp?token=header.payload.signature#preview',
    )
  })

  it('renders malformed legacy file parts without actionable URLs', async () => {
    const wrapper = await mountSuspended(Files, {
      props: {
        message: {
          id: 'message-1',
          role: 'assistant',
          parts: [
            {
              type: 'file',
              mediaType: 'image/png',
              filename: 'javascript.png',
              url: 'javascript:alert(1)',
            },
            {
              type: 'file',
              mediaType: 'image/png',
              filename: 'data.png',
              url: 'data:image/png;base64,unsafe',
            },
            {
              type: 'file',
              mediaType: 'image/png',
              filename: 'remote.png',
              url: '//evil.example/remote.png',
            },
            {
              type: 'file',
              mediaType: 'image/png',
              filename: 'traversal.png',
              url: '/files/%2e%2e%2fsecret',
            },
          ],
        },
      },
    })

    expect(wrapper.findAll('[data-testid="chat-file-unavailable"]'))
      .toHaveLength(4)
    expect(wrapper.findAll('a')).toHaveLength(0)
    expect(wrapper.findAll('img')).toHaveLength(0)
    expect(wrapper.html()).not.toContain('javascript:')
    expect(wrapper.html()).not.toContain('data:image')
    expect(wrapper.html()).not.toContain('//evil.example')
  })

  it('removes actions when a valid image preview fails', async () => {
    const wrapper = await mountSuspended(Files, {
      props: {
        message: {
          id: 'message-1',
          role: 'assistant',
          parts: [{
            type: 'file',
            mediaType: 'image/webp',
            filename: 'missing.webp',
            url: '/files/missing.webp',
          }],
        },
      },
    })

    await wrapper.get('img').trigger('error')

    expect(wrapper.find('[data-testid="chat-file-open"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="chat-file-download"]').exists())
      .toBe(false)
  })

  it('renders a hidden placeholder without revealing any file info', async () => {
    const wrapper = await mountSuspended(Files, {
      props: {
        message: {
          id: 'message-1',
          role: 'assistant',
          parts: [
            { type: 'text', text: 'Hello' },
            {
              type: 'file',
              mediaType: HIDDEN_FILE_MEDIA_TYPE,
              filename: undefined,
              url: '',
            },
          ],
        },
      },
    })

    const hidden = wrapper.get('[data-testid="chat-file-hidden"]')

    expect(hidden.text()).toContain('Hidden')
    expect(wrapper.find('[data-testid="chat-file-unavailable"]').exists())
      .toBe(false)
    expect(wrapper.findAll('img')).toHaveLength(0)
    expect(wrapper.find('[data-testid="chat-file-preview-trigger"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="chat-file-open"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="chat-file-download"]').exists())
      .toBe(false)
    expect(wrapper.html()).not.toContain(HIDDEN_FILE_MEDIA_TYPE)
  })

  it('marks a generated image with an AI badge', async () => {
    const wrapper = await mountSuspended(Files, {
      props: {
        message: {
          id: 'message-1',
          role: 'assistant',
          parts: [
            {
              type: 'file',
              mediaType: 'image/webp',
              filename: 'generated.webp',
              url: '/files/generated.webp?generated=1',
            },
            {
              type: 'file',
              mediaType: 'image/webp',
              filename: 'uploaded.webp',
              url: '/files/uploaded.webp',
            },
          ],
        },
      },
      global: {
        stubs: {
          LazyChatImagePreview: LazyImagePreview,
          teleport: true,
        },
      },
    })

    const badges = wrapper.findAll('[aria-label="Generated by AI"]')

    expect(badges).toHaveLength(1)
  })
})

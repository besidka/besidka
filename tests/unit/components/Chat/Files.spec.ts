import { mountSuspended } from '@nuxt/test-utils/runtime'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import Files from '../../../../app/components/Chat/Files.vue'

describe('Chat/Files', () => {
  beforeEach(() => {
    vi.spyOn(HTMLImageElement.prototype, 'complete', 'get')
      .mockReturnValue(false)
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
    })

    expect(wrapper.get('img').attributes('src'))
      .toBe('/files/shared.webp?token=header.payload.signature#preview')
    expect(wrapper.get('[data-testid="chat-file-open"]').attributes('href'))
      .toBe('/files/shared.webp?token=header.payload.signature#preview')
    expect(
      wrapper.get('[data-testid="chat-file-download"]').attributes('href'),
    ).toBe(
      '/files/shared.webp?token=header.payload.signature&download=1#preview',
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
})

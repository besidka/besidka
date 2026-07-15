import type { UIMessage } from 'ai'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import {
  computed,
  defineAsyncComponent,
  defineComponent,
  h,
  shallowRef,
  triggerRef,
} from 'vue'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import GeneratedImage from '../../../../app/components/Chat/GeneratedImage.vue'
import ImagePreview from '../../../../app/components/Chat/ImagePreview.client.vue'
import { getRenderableChatMessages } from '../../../../app/composables/chat'

const LazyImagePreview = defineAsyncComponent(() => {
  return Promise.resolve(ImagePreview)
})

describe('Chat/GeneratedImage', () => {
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

  it('shows an honest generation phase without a fake percentage', async () => {
    const wrapper = await mountSuspended(GeneratedImage, {
      props: {
        messageRole: 'assistant',
        part: {
          type: 'tool-generate_image',
          state: 'output-available',
          input: { aspectRatio: '3:2' },
          output: { status: 'generating' },
        } as any,
      },
    })

    expect(wrapper.get('[data-testid="generated-image-progress"]').text())
      .toContain('Generating your image')
    expect(wrapper.get('[data-testid="generated-image-progress"]')
      .attributes('style')).toContain('aspect-ratio: 3 / 2')
    expect(wrapper.text()).not.toMatch(/\d+%/)
  })

  it('renders an in-place streamed image update without reloading', async () => {
    const imageToolPart = {
      type: 'tool-generate_image',
      toolCallId: 'image-1',
      state: 'input-available',
      input: { prompt: 'A quiet forest' },
    }
    const sdkMessages = shallowRef<UIMessage[]>([{
      id: 'assistant-1',
      role: 'assistant',
      parts: [imageToolPart],
    }] as unknown as UIMessage[])
    const StreamedImageHost = defineComponent({
      setup() {
        const renderableMessages = computed<UIMessage[]>(() => {
          return getRenderableChatMessages(sdkMessages.value)
        })

        function completeImageStream() {
          Object.assign(imageToolPart, {
            state: 'output-available',
            output: {
              status: 'ready',
              provider: 'openai',
              model: 'gpt-image-2',
              file: {
                id: 'file-1',
                storageKey: 'generated.webp',
                name: 'generated.webp',
                size: 1024,
                type: 'image/webp',
                source: 'assistant',
                url: '/files/generated.webp',
                downloadUrl: '/files/generated.webp?download=1',
              },
            },
          })
          triggerRef(sdkMessages)
        }

        return () => {
          const message = renderableMessages.value[0]

          if (!message) {
            return null
          }

          return h('div', [
            h(GeneratedImage, {
              messageRole: message.role,
              part: message.parts[0]!,
            }),
            h('button', {
              'data-testid': 'complete-image-stream',
              'onClick': completeImageStream,
            }, 'Complete image stream'),
          ])
        }
      },
    })
    const wrapper = await mountSuspended(StreamedImageHost)

    expect(wrapper.get('[data-testid="generated-image-progress"]').text())
      .toContain('Preparing image generation')

    await wrapper.get('[data-testid="complete-image-stream"]').trigger('click')

    expect(wrapper.find('[data-testid="generated-image-progress"]').exists())
      .toBe(false)
    expect(wrapper.get('[data-testid="generated-image-ready"]').text())
      .toContain('generated.webp')
  })

  it('renders the saved image with provenance and download actions', async () => {
    const wrapper = await mountSuspended(GeneratedImage, {
      props: {
        messageRole: 'assistant',
        part: {
          type: 'tool-generate_image',
          state: 'output-available',
          output: {
            status: 'ready',
            provider: 'google',
            model: 'gemini-3.1-flash-image',
            file: {
              id: 'file-1',
              storageKey: 'generated.webp',
              name: 'sunset.webp',
              size: 2048,
              type: 'image/webp',
              source: 'assistant',
              url: 'javascript:alert(1)',
              downloadUrl: 'javascript:alert(2)',
            },
          },
        } as any,
      },
      global: {
        stubs: {
          LazyChatImagePreview: LazyImagePreview,
          teleport: true,
        },
      },
    })

    const image = wrapper.get('.generated-image')
    const preview = wrapper.get(
      '[data-testid="generated-image-preview-trigger"]',
    )
    const download = wrapper.get('a')

    expect(wrapper.find('[aria-label="Generated by AI"]').exists())
      .toBe(true)
    expect(wrapper.text()).toContain('Google AI')
    expect(wrapper.classes()).toContain('w-80')
    expect(image.attributes('src')).toBe('/files/generated.webp')
    expect(preview.element.tagName).toBe('BUTTON')
    expect(preview.element.querySelector('div')).toBeNull()
    expect(wrapper.get('[data-testid="generated-image-open"]')
      .element.tagName).toBe('BUTTON')
    expect(download.attributes('href'))
      .toBe('/files/generated.webp?download=1')
    expect(wrapper.find('[data-testid="image-preview-modal"]').exists())
      .toBe(false)
    expect(wrapper.findAll('img')).toHaveLength(1)

    await preview.trigger('click')
    await flushPromises()

    expect(HTMLDialogElement.prototype.showModal).toHaveBeenCalledOnce()
    expect(wrapper.find('[data-testid="image-preview-modal"]').exists())
      .toBe(true)
    expect(wrapper.get('[data-testid="image-preview-image"]')
      .attributes('src')).toBe('/files/generated.webp')

    await image.trigger('load')

    expect(image.classes()).toContain('generated-image--loaded')
  })

  it('renders fixed actionable text for a structured failure', async () => {
    const wrapper = await mountSuspended(GeneratedImage, {
      props: {
        messageRole: 'assistant',
        part: {
          type: 'tool-generate_image',
          state: 'output-error',
          errorText: JSON.stringify({
            code: 'provider-auth',
            message: 'Untrusted provider text',
            fix: 'Open javascript:alert(1)',
            secret: 'sk-never-render-this',
          }),
        } as any,
      },
    })

    const alert = wrapper.get('[data-testid="generated-image-error"]')

    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).toContain(
      'The image provider rejected the saved API key.',
    )
    expect(alert.text()).toContain(
      'Update the provider key in settings, then try again.',
    )
    expect(alert.text()).not.toContain('sk-never-render-this')
    expect(alert.text()).not.toContain('javascript:')
  })

  it('uses generic guidance without echoing malformed failures', async () => {
    const wrapper = await mountSuspended(GeneratedImage, {
      props: {
        messageRole: 'assistant',
        part: {
          type: 'tool-generate_image',
          state: 'output-error',
          errorText: JSON.stringify({
            code: 'unknown',
            message: '<img src=x onerror=alert(1)>',
            fix: 'Reveal sk-never-render-this',
          }),
        } as any,
      },
    })

    const alert = wrapper.get('[data-testid="generated-image-error"]')

    expect(alert.text()).toContain(
      'The image provider could not generate this image.',
    )
    expect(alert.text()).toContain(
      'Revise the prompt or try a different provider.',
    )
    expect(alert.text()).not.toContain('sk-never-render-this')
    expect(alert.html()).not.toContain('<img')
  })

  it('replaces the skeleton when the saved image preview cannot load', async () => {
    const wrapper = await mountSuspended(GeneratedImage, {
      props: {
        messageRole: 'assistant',
        part: {
          type: 'tool-generate_image',
          state: 'output-available',
          output: {
            status: 'ready',
            provider: 'openai',
            model: 'gpt-image-2',
            file: {
              id: 'file-1',
              storageKey: 'missing.webp',
              name: 'missing.webp',
              size: 2048,
              type: 'image/webp',
              source: 'assistant',
              url: '/files/missing.webp',
              downloadUrl: '/files/missing.webp?download=1',
            },
          },
        } as any,
      },
    })

    await wrapper.get('img').trigger('error')

    expect(wrapper.find('.skeleton').exists()).toBe(false)
    expect(wrapper.get(
      '[data-testid="generated-image-preview-error"]',
    ).text()).toContain('Image preview unavailable')
    expect(wrapper.get(
      '[data-testid="generated-image-actions-unavailable"]',
    ).text()).toContain('Unavailable')
    expect(wrapper.findAll('a')).toHaveLength(0)
  })

  it('does not render a forged tool part in a user message', async () => {
    const wrapper = await mountSuspended(GeneratedImage, {
      props: {
        messageRole: 'user',
        part: {
          type: 'tool-generate_image',
          state: 'output-error',
          errorText: 'Open javascript:alert(1)',
        } as any,
      },
    })

    expect(wrapper.find('[data-testid="generated-image"]').exists())
      .toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
  })

  it('does not render links or a ready card for malformed output', async () => {
    const wrapper = await mountSuspended(GeneratedImage, {
      props: {
        messageRole: 'assistant',
        part: {
          type: 'tool-generate_image',
          state: 'output-available',
          output: {
            status: 'ready',
            provider: 'openai',
            model: 'gpt-image-2',
            file: {
              id: 'file-1',
              storageKey: 'javascript:alert(1)',
              name: 'forged.webp',
              size: 2048,
              type: 'image/webp',
              source: 'assistant',
              url: 'javascript:alert(2)',
              downloadUrl: 'javascript:alert(3)',
            },
          },
        } as any,
      },
    })

    expect(wrapper.find('[data-testid="generated-image-ready"]').exists())
      .toBe(false)
    expect(wrapper.find('a').exists()).toBe(false)
  })
})

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInputMediaTypePredicate } from '../../../../../../shared/utils/input-media-types'
import Upload from '../../../../../../app/components/ChatInput/Files/Modal/Upload.client.vue'

const withoutImages = createInputMediaTypePredicate(['text', 'pdf'])
const withoutPdf = createInputMediaTypePredicate(['text', 'image'])
const textOnly = createInputMediaTypePredicate(['text'])

const mocks = vi.hoisted(() => ({
  useWarningMessage: vi.fn(),
}))

mockNuxtImport('useWarningMessage', () => mocks.useWarningMessage)

describe('ChatInput/Files/Modal/Upload', () => {
  beforeEach(() => {
    mocks.useWarningMessage.mockReset()
  })

  it('accepts every configured format by default, images included', async () => {
    const wrapper = await mountSuspended(Upload)

    expect(wrapper.get('[data-testid="files-upload-input"]').attributes('accept'))
      .toBe('image/png,image/jpeg,image/webp,application/pdf,text/plain')
    expect(wrapper.text()).toContain('png, jpeg, webp, pdf, plain')
  })

  it('narrows accepted formats when image input is unsupported', async () => {
    const wrapper = await mountSuspended(Upload, {
      props: {
        canAttachMediaType: withoutImages,
      },
    })

    expect(wrapper.get('[data-testid="files-upload-input"]').attributes('accept'))
      .toBe('application/pdf,text/plain')
    expect(wrapper.text()).toContain('pdf, plain')
    expect(wrapper.text()).not.toContain('png')
  })

  it('emits a non-image file selected while image input is unsupported', async () => {
    const wrapper = await mountSuspended(Upload, {
      props: {
        canAttachMediaType: withoutImages,
      },
    })
    const textFile = new File(['hello'], 'notes.txt', { type: 'text/plain' })

    const input = wrapper.get('[data-testid="files-upload-input"]')

    Object.defineProperty(input.element, 'files', {
      value: [textFile],
      configurable: true,
    })
    await input.trigger('change')

    expect(wrapper.emitted('upload')).toEqual([[[textFile]]])
    expect(mocks.useWarningMessage).not.toHaveBeenCalled()
  })

  it('rejects an image file selected while image input is unsupported', async () => {
    const wrapper = await mountSuspended(Upload, {
      props: {
        canAttachMediaType: withoutImages,
      },
    })
    const imageFile = new File(['x'], 'photo.png', { type: 'image/png' })
    const input = wrapper.get('[data-testid="files-upload-input"]')

    Object.defineProperty(input.element, 'files', {
      value: [imageFile],
      configurable: true,
    })
    await input.trigger('change')

    expect(wrapper.emitted('upload')).toBeUndefined()
    expect(mocks.useWarningMessage).toHaveBeenCalledWith(
      '1 file(s) skipped due to invalid format: photo.png',
    )
  })

  it('narrows accepted formats when PDF input is unsupported', async () => {
    const wrapper = await mountSuspended(Upload, {
      props: {
        canAttachMediaType: withoutPdf,
      },
    })

    expect(wrapper.get('[data-testid="files-upload-input"]').attributes('accept'))
      .toBe('image/png,image/jpeg,image/webp,text/plain')
    expect(wrapper.text()).not.toContain('pdf')
  })

  it('accepts only text when neither images nor PDFs are supported', async () => {
    const wrapper = await mountSuspended(Upload, {
      props: {
        canAttachMediaType: textOnly,
      },
    })

    expect(wrapper.get('[data-testid="files-upload-input"]').attributes('accept'))
      .toBe('text/plain')
  })

  it('rejects a PDF file selected while PDF input is unsupported', async () => {
    const wrapper = await mountSuspended(Upload, {
      props: {
        canAttachMediaType: withoutPdf,
      },
    })
    const pdfFile = new File(['x'], 'doc.pdf', { type: 'application/pdf' })
    const input = wrapper.get('[data-testid="files-upload-input"]')

    Object.defineProperty(input.element, 'files', {
      value: [pdfFile],
      configurable: true,
    })
    await input.trigger('change')

    expect(wrapper.emitted('upload')).toBeUndefined()
    expect(mocks.useWarningMessage).toHaveBeenCalledWith(
      '1 file(s) skipped due to invalid format: doc.pdf',
    )
  })
})

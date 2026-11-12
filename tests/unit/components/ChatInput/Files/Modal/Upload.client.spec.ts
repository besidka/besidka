import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { KeepAlive, defineComponent, h, nextTick, shallowRef } from 'vue'
import { useState } from '#imports'
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
    useState('features').value = null
  })

  function turnOfficeOn() {
    useState('features').value = {
      features: {
        'files.office': { enabled: true, active: true, variant: null },
      },
      isAdmin: false,
    }
  }

  async function chooseFiles(
    wrapper: Awaited<ReturnType<typeof mountSuspended>>,
    files: File[],
  ) {
    const input = wrapper.get('[data-testid="files-upload-input"]')

    Object.defineProperty(input.element, 'files', {
      value: files,
      configurable: true,
    })
    await input.trigger('change')
  }

  it('accepts every configured format by default, images included', async () => {
    const wrapper = await mountSuspended(Upload)

    expect(wrapper.get('[data-testid="files-upload-input"]').attributes('accept'))
      .toBe('image/png,image/jpeg,image/webp,application/pdf,text/plain,text/markdown,text/csv,text/tab-separated-values,.md,.markdown,.txt,.csv,.tsv')
    expect(wrapper.text()).toContain('PNG, JPEG, WebP, PDF, Text, Markdown, CSV, TSV')
  })

  it('narrows accepted formats when image input is unsupported', async () => {
    const wrapper = await mountSuspended(Upload, {
      props: {
        canAttachMediaType: withoutImages,
      },
    })

    expect(wrapper.get('[data-testid="files-upload-input"]').attributes('accept'))
      .toBe('application/pdf,text/plain,text/markdown,text/csv,text/tab-separated-values,.md,.markdown,.txt,.csv,.tsv')
    expect(wrapper.text()).toContain('PDF, Text, Markdown, CSV, TSV')
    expect(wrapper.text()).not.toContain('PNG')
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
      .toBe('image/png,image/jpeg,image/webp,text/plain,text/markdown,text/csv,text/tab-separated-values,.md,.markdown,.txt,.csv,.tsv')
    expect(wrapper.text()).not.toContain('pdf')
  })

  it('accepts only text when neither images nor PDFs are supported', async () => {
    const wrapper = await mountSuspended(Upload, {
      props: {
        canAttachMediaType: textOnly,
      },
    })

    expect(wrapper.get('[data-testid="files-upload-input"]').attributes('accept'))
      .toBe('text/plain,text/markdown,text/csv,text/tab-separated-values,.md,.markdown,.txt,.csv,.tsv')
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

  describe('Office documents', () => {
    const docxType = 'application/vnd.openxmlformats-officedocument'
      + '.wordprocessingml.document'
    const xlsxType = 'application/vnd.openxmlformats-officedocument'
      + '.spreadsheetml.sheet'
    const pptxType = 'application/vnd.openxmlformats-officedocument'
      + '.presentationml.presentation'

    it('adds Office types and extensions to the picker when the flag is on',
      async () => {
        turnOfficeOn()

        const wrapper = await mountSuspended(Upload)
        const accept = wrapper.get('[data-testid="files-upload-input"]')
          .attributes('accept')!
        const accepted = accept.split(',')

        expect(accepted).toEqual(expect.arrayContaining([
          docxType,
          xlsxType,
          pptxType,
          '.docx',
          '.xlsx',
          '.pptx',
          '.doc',
          '.xls',
          '.ppt',
          '.docm',
          '.xlsm',
          '.pptm',
        ]))
        expect(accepted).toEqual(expect.arrayContaining([
          'image/png',
          'application/pdf',
          '.csv',
        ]))
      })

    it('keeps the picker as it was when the flag is off', async () => {
      const wrapper = await mountSuspended(Upload)
      const accept = wrapper.get('[data-testid="files-upload-input"]')
        .attributes('accept')!

      expect(accept).not.toContain('openxmlformats')
      expect(accept).not.toContain('.docx')
      expect(accept).not.toContain('.xls')
      expect(wrapper.text()).not.toContain('Word')
    })

    it('lists readable names, never the media type', async () => {
      turnOfficeOn()

      const wrapper = await mountSuspended(Upload)
      const formats = wrapper.get('[data-testid="files-upload-formats"]').text()

      expect(formats).toBe(
        'PNG, JPEG, WebP, PDF, Word, Excel, PowerPoint, Text, Markdown, '
        + 'CSV, TSV',
      )
      expect(wrapper.text()).not.toContain('vnd.')
      expect(wrapper.text()).not.toContain('openxmlformats')
    })

    it('keeps Office listed for a model that only reads text',
      async () => {
        turnOfficeOn()

        const wrapper = await mountSuspended(Upload, {
          props: { canAttachMediaType: textOnly },
        })

        expect(wrapper.get('[data-testid="files-upload-formats"]').text())
          .toBe('Word, Excel, PowerPoint, Text, Markdown, CSV, TSV')
      })

    it('gives an Office file with no browser type its Office type',
      async () => {
        turnOfficeOn()

        const wrapper = await mountSuspended(Upload)
        const workbook = new File(['PK'], 'budget.xlsx', { type: '' })
        const archiveTyped = new File(['PK'], 'plan.docx', {
          type: 'application/zip',
        })

        await chooseFiles(wrapper, [workbook, archiveTyped])

        const uploaded = wrapper.emitted('upload')![0]![0] as File[]

        expect(uploaded.map(file => [file.name, file.type])).toEqual([
          ['budget.xlsx', xlsxType],
          ['plan.docx', docxType],
        ])
        expect(mocks.useWarningMessage).not.toHaveBeenCalled()
      })

    it('rejects legacy and macro files with the save-as hint', async () => {
      turnOfficeOn()

      const wrapper = await mountSuspended(Upload)
      const legacySheet = new File(['x'], 'old.xls', {
        type: 'application/vnd.ms-excel',
      })
      const macroDoc = new File(['x'], 'macro.docm', { type: '' })
      const fine = new File(['x'], 'notes.txt', { type: 'text/plain' })

      await chooseFiles(wrapper, [legacySheet, macroDoc, fine])

      const uploaded = wrapper.emitted('upload')![0]![0] as File[]

      expect(uploaded.map(file => file.name)).toEqual(['notes.txt'])
      expect(mocks.useWarningMessage).toHaveBeenCalledTimes(1)
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(
        '2 files are old Office formats and cannot be read: '
        + 'old.xls, macro.docm. '
        + 'Save it as .xlsx / .docx / .pptx and upload again.',
      )
    })

    describe('legacy .xls', () => {
      const compoundFileHeader = new Uint8Array([
        0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1, 0, 0, 0, 0,
      ])

      function realXls(name = 'jira.xls'): File {
        return new File([compoundFileHeader], name, {
          type: 'application/vnd.ms-excel',
        })
      }

      it('hands a real compound-file .xls on to be converted', async () => {
        turnOfficeOn()

        const wrapper = await mountSuspended(Upload)

        await chooseFiles(wrapper, [realXls()])
        await vi.waitFor(() => {
          expect(wrapper.emitted('upload')).toBeDefined()
        })

        const uploaded = wrapper.emitted('upload')![0]![0] as File[]

        expect(uploaded.map(file => file.name)).toEqual(['jira.xls'])
        expect(mocks.useWarningMessage).not.toHaveBeenCalled()
        expect(wrapper.find('[data-testid="files-upload-legacy-hint"]').exists())
          .toBe(false)
      })

      it('still shows the hint for an .xls that is not a compound file',
        async () => {
          turnOfficeOn()

          const wrapper = await mountSuspended(Upload)
          const disguisedHtml = new File(
            ['<html><table></table></html>'],
            'jira.xls',
            { type: 'application/vnd.ms-excel' },
          )

          await chooseFiles(wrapper, [disguisedHtml])
          await vi.waitFor(() => {
            expect(wrapper.find('[data-testid="files-upload-legacy-hint"]')
              .exists()).toBe(true)
          })

          expect(wrapper.emitted('upload')).toBeUndefined()
          expect(wrapper.get('[data-testid="files-upload-legacy-hint"]').text())
            .toBe(
              'jira.xls is an old Office format and cannot be read. '
              + 'Save it as .xlsx / .docx / .pptx and upload again.',
            )
        })

      it('keeps .doc, .ppt and .xlsm on the hint even with the signature',
        async () => {
          turnOfficeOn()

          const wrapper = await mountSuspended(Upload)

          await chooseFiles(wrapper, [
            realXls('old.doc'),
            realXls('old.ppt'),
            realXls('macro.xlsm'),
          ])
          await vi.waitFor(() => {
            expect(wrapper.find('[data-testid="files-upload-legacy-hint"]')
              .exists()).toBe(true)
          })

          expect(wrapper.emitted('upload')).toBeUndefined()
        })

      it('splits a batch: the real .xls goes on, the fake one gets the hint',
        async () => {
          turnOfficeOn()

          const wrapper = await mountSuspended(Upload)

          await chooseFiles(wrapper, [
            realXls('real.xls'),
            new File(['nope'], 'fake.xls', { type: '' }),
          ])
          await vi.waitFor(() => {
            expect(wrapper.emitted('upload')).toBeDefined()
          })

          const uploaded = wrapper.emitted('upload')![0]![0] as File[]

          expect(uploaded.map(file => file.name)).toEqual(['real.xls'])
          expect(mocks.useWarningMessage).toHaveBeenCalledWith(
            'fake.xls is an old Office format and cannot be read. '
            + 'Save it as .xlsx / .docx / .pptx and upload again.',
          )
        })
    })

    it('uploads nothing for a lone legacy file', async () => {
      turnOfficeOn()

      const wrapper = await mountSuspended(Upload)

      await chooseFiles(wrapper, [new File(['x'], 'old.ppt', { type: '' })])

      expect(wrapper.emitted('upload')).toBeUndefined()
      expect(mocks.useWarningMessage).toHaveBeenCalledWith(
        'old.ppt is an old Office format and cannot be read. '
        + 'Save it as .xlsx / .docx / .pptx and upload again.',
      )
      expect(wrapper.get('[data-testid="files-upload-legacy-hint"]').text())
        .toBe(
          'old.ppt is an old Office format and cannot be read. '
          + 'Save it as .xlsx / .docx / .pptx and upload again.',
        )
    })

    it('clears the legacy hint on a tab switch or when the modal closes',
      async () => {
        turnOfficeOn()

        const isShown = shallowRef<boolean>(true)
        const Host = defineComponent({
          components: { Upload },
          setup() {
            return () => h(KeepAlive, null, {
              default: () => isShown.value ? h(Upload) : h('div'),
            })
          },
        })
        const wrapper = await mountSuspended(Host)

        await chooseFiles(wrapper, [new File(['x'], 'old.xls', { type: '' })])

        expect(wrapper.find('[data-testid="files-upload-legacy-hint"]').exists())
          .toBe(true)

        isShown.value = false
        await nextTick()
        isShown.value = true
        await nextTick()

        expect(wrapper.find('[data-testid="files-upload-legacy-hint"]').exists())
          .toBe(false)
      })

    it('clears the legacy hint when the next pick is fine', async () => {
      turnOfficeOn()

      const wrapper = await mountSuspended(Upload)

      await chooseFiles(wrapper, [new File(['x'], 'old.doc', { type: '' })])

      expect(wrapper.find('[data-testid="files-upload-legacy-hint"]').exists())
        .toBe(true)

      await chooseFiles(wrapper, [
        new File(['x'], 'notes.txt', { type: 'text/plain' }),
      ])

      expect(wrapper.find('[data-testid="files-upload-legacy-hint"]').exists())
        .toBe(false)
    })

    it('keeps the generic message for Office files when the flag is off',
      async () => {
        const wrapper = await mountSuspended(Upload)

        await chooseFiles(wrapper, [new File(['x'], 'old.xls', { type: '' })])

        expect(wrapper.emitted('upload')).toBeUndefined()
        expect(mocks.useWarningMessage).toHaveBeenCalledWith(
          '1 file(s) skipped due to invalid format: old.xls',
        )
      })
  })
})

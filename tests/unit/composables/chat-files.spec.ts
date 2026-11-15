import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { useState } from '#imports'
import { createInputMediaTypePredicate } from '../../../shared/utils/input-media-types'
import { useChatFiles } from '../../../app/composables/chat-files'
import { OFFICE_MEDIA_TYPES } from '../../../shared/utils/office-files'
import { createFileDeliveryResolver } from '../../../app/utils/file-delivery-hints'

const {
  uploadWithProgressMock,
  fetchMock,
  useWarningMessageMock,
  ensureSendConsentMock,
  convertXlsFileMock,
} = vi.hoisted(() => ({
  uploadWithProgressMock: vi.fn(),
  fetchMock: vi.fn(),
  useWarningMessageMock: vi.fn(),
  ensureSendConsentMock: vi.fn(),
  convertXlsFileMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useWarningMessage', () => useWarningMessageMock)
mockNuxtImport('useLegalConsent', () => () => ({
  ensureSendConsent: ensureSendConsentMock,
}))
mockNuxtImport('useXlsConversion', () => () => ({
  convertXlsFile: convertXlsFileMock,
  dispose: vi.fn(),
}))

vi.mock('~/utils/upload-with-progress', () => ({
  uploadWithProgress: (...args: any[]) => uploadWithProgressMock(...args),
}))

async function waitFor(
  condition: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const startedAt = Date.now()

  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('Condition not met within timeout')
    }

    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function createTextFile(name: string, size = 4): File {
  return new File(['x'.repeat(size)], name, { type: 'text/plain' })
}

function createImageFile(name: string, size = 4): File {
  return new File(['x'.repeat(size)], name, { type: 'image/png' })
}

function createPdfFile(name: string, size = 4): File {
  return new File(['x'.repeat(size)], name, { type: 'application/pdf' })
}

const textAndPdf = createInputMediaTypePredicate(['text', 'pdf'])
const textAndImages = createInputMediaTypePredicate(['text', 'image'])
const textOnly = createInputMediaTypePredicate(['text'])

describe('useChatFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ensureSendConsentMock.mockResolvedValue(true)
    convertXlsFileMock.mockResolvedValue({
      status: 'failed',
      reason: 'not-cfb',
    })
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-preview')
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/files/policy') {
        return {
          policy: {
            tier: 'free',
            maxStorageBytes: 20 * 1024 * 1024,
            maxFilesPerMessage: 10,
            maxMessageFilesBytes: 1000 * 1024 * 1024,
            fileRetentionDays: 30,
            imageTransformLimitTotal: 0,
            imageTransformUsedTotal: 0,
          },
          globalTransformRemainingMonth: 1000,
        }
      }

      throw new Error(`Unhandled $fetch call: ${url}`)
    })
  })

  afterEach(() => {
    uploadWithProgressMock.mockReset()
    useWarningMessageMock.mockReset()
    useState('features').value = null
  })

  it('resolves true when the files are accepted and queued', async () => {
    uploadWithProgressMock.mockResolvedValue({ data: undefined })

    const { uploadFiles } = useChatFiles(ref([]) as any, ref(() => true))

    expect(await uploadFiles([createTextFile('ok.txt')])).toBe(true)
  })

  it('resolves false when consent is declined', async () => {
    ensureSendConsentMock.mockResolvedValue(false)

    const { uploadFiles, uploadingFiles } = useChatFiles(
      ref([]) as any,
      ref(() => true),
    )

    expect(await uploadFiles([createTextFile('no.txt')])).toBe(false)
    expect(uploadingFiles.value.size).toBe(0)
  })

  it('resolves false when every file is rejected by the model', async () => {
    const { uploadFiles } = useChatFiles(ref([]) as any, ref(textOnly))

    expect(await uploadFiles([createImageFile('photo.png')])).toBe(false)
  })

  it('resolves false when the file count cap is exceeded', async () => {
    const { uploadFiles } = useChatFiles(ref([]) as any, ref(() => true))
    const files = Array.from({ length: 11 }, (_, index) => {
      return createTextFile(`file-${index}.txt`)
    })

    expect(await uploadFiles(files)).toBe(false)
  })

  it('resolves false when the total file count cap is exceeded', async () => {
    const attachedFiles = ref(
      Array.from({ length: 10 }, (_, index) => ({
        storageKey: `attached-${index}`,
        size: 1,
      })),
    ) as any
    const { uploadFiles } = useChatFiles(attachedFiles, ref(() => true))

    expect(await uploadFiles([createTextFile('one-too-many.txt')]))
      .toBe(false)
  })

  it('resolves false when the size cap is exceeded', async () => {
    fetchMock.mockImplementation(async () => ({
      policy: {
        tier: 'free',
        maxStorageBytes: 20 * 1024 * 1024,
        maxFilesPerMessage: 10,
        maxMessageFilesBytes: 5,
        fileRetentionDays: 30,
        imageTransformLimitTotal: 0,
        imageTransformUsedTotal: 0,
      },
      globalTransformRemainingMonth: 1000,
    }))

    const { uploadFiles } = useChatFiles(ref([]) as any, ref(() => true))

    expect(await uploadFiles([createTextFile('big.txt', 8)])).toBe(false)
  })

  it('validates max file count before enqueue', async () => {
    const attachedFiles = ref([]) as any
    const { uploadFiles, uploadingFiles } = useChatFiles(
      attachedFiles,
      ref(() => true),
    )

    const files = Array.from({ length: 11 }, (_, index) => {
      return createTextFile(`file-${index}.txt`)
    })

    await uploadFiles(files)

    expect(uploadingFiles.value.size).toBe(0)
  })

  it('validates total file size before enqueue', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/files/policy') {
        return {
          policy: {
            tier: 'free',
            maxStorageBytes: 20 * 1024 * 1024,
            maxFilesPerMessage: 10,
            maxMessageFilesBytes: 5,
            fileRetentionDays: 30,
            imageTransformLimitTotal: 0,
            imageTransformUsedTotal: 0,
          },
          globalTransformRemainingMonth: 1000,
        }
      }

      throw new Error(`Unhandled $fetch call: ${url}`)
    })

    const attachedFiles = ref([]) as any
    const { uploadFiles, uploadingFiles } = useChatFiles(
      attachedFiles,
      ref(() => true),
    )

    await uploadFiles([createTextFile('big.txt', 8)])

    expect(uploadingFiles.value.size).toBe(0)
    expect(uploadWithProgressMock).not.toHaveBeenCalled()
  })

  it('uploads files sequentially', async () => {
    const attachedFiles = ref([]) as any
    const { uploadFiles } = useChatFiles(attachedFiles, ref(() => true))
    const order: string[] = []

    uploadWithProgressMock.mockImplementation(async ({ file }) => {
      order.push(`start:${file.name}`)
      await new Promise(resolve => setTimeout(resolve, 5))
      order.push(`end:${file.name}`)

      return {
        data: {
          id: file.name,
          storageKey: file.name,
          name: file.name,
          size: file.size,
          type: file.type,
          source: 'upload',
          expiresAt: null,
        },
      }
    })

    await uploadFiles([
      createTextFile('first.txt'),
      createTextFile('second.txt'),
    ])

    await waitFor(() => attachedFiles.value.length === 2)

    expect(order).toEqual([
      'start:first.txt',
      'end:first.txt',
      'start:second.txt',
      'end:second.txt',
    ])
  })

  it('retries once for retryable upload errors', async () => {
    const attachedFiles = ref([]) as any
    const { uploadFiles } = useChatFiles(attachedFiles, ref(() => true))
    let calls = 0

    uploadWithProgressMock.mockImplementation(async ({ file }) => {
      calls += 1

      if (calls === 1) {
        throw {
          status: 500,
          message: 'Server unavailable',
        }
      }

      return {
        data: {
          id: file.name,
          storageKey: file.name,
          name: file.name,
          size: file.size,
          type: file.type,
          source: 'upload',
          expiresAt: null,
        },
      }
    })

    await uploadFiles([createTextFile('retry.txt')])
    await waitFor(() => attachedFiles.value.length === 1)

    expect(calls).toBe(2)
  })

  it('does not retry non-retryable validation/quota errors', async () => {
    const attachedFiles = ref([]) as any
    const { uploadFiles, uploadingFiles } = useChatFiles(
      attachedFiles,
      ref(() => true),
    )
    let calls = 0

    uploadWithProgressMock.mockImplementation(async () => {
      calls += 1
      throw {
        status: 400,
        message: 'Storage quota exceeded',
      }
    })

    await uploadFiles([createTextFile('quota.txt')])
    await waitFor(() => {
      return Array.from(uploadingFiles.value.values())
        .some(file => file.status === 'failed')
    })

    expect(calls).toBe(1)
  })

  it('rejects an image at enqueue time when unsupported', async () => {
    const attachedFiles = ref([]) as any
    const canAttachMediaType = ref(textAndPdf)
    const { uploadFiles, uploadingFiles } = useChatFiles(
      attachedFiles,
      canAttachMediaType,
    )

    await uploadFiles([createImageFile('photo.png')])

    expect(uploadingFiles.value.size).toBe(0)
    expect(uploadWithProgressMock).not.toHaveBeenCalled()
    expect(useWarningMessageMock).toHaveBeenCalledWith(
      'This model does not support image input. Attach a PDF or text '
      + 'file instead, or switch models.',
    )
  })

  it('rejects a PDF at enqueue time when unsupported', async () => {
    const attachedFiles = ref([]) as any
    const canAttachMediaType = ref(textAndImages)
    const { uploadFiles, uploadingFiles } = useChatFiles(
      attachedFiles,
      canAttachMediaType,
    )

    await uploadFiles([createPdfFile('doc.pdf')])

    expect(uploadingFiles.value.size).toBe(0)
    expect(uploadWithProgressMock).not.toHaveBeenCalled()
    expect(useWarningMessageMock).toHaveBeenCalledWith(
      'This model does not support PDF input. Attach an image or text '
      + 'file instead, or switch models.',
    )
  })

  it('warns once with a combined message when both kinds are rejected', async () => {
    const attachedFiles = ref([]) as any
    const canAttachMediaType = ref(textOnly)
    const { uploadFiles, uploadingFiles } = useChatFiles(
      attachedFiles,
      canAttachMediaType,
    )

    await uploadFiles([
      createImageFile('photo.png'),
      createPdfFile('doc.pdf'),
    ])

    expect(uploadingFiles.value.size).toBe(0)
    expect(useWarningMessageMock).toHaveBeenCalledTimes(1)
    expect(useWarningMessageMock).toHaveBeenCalledWith(
      'This model does not support image or PDF input. Attach a text '
      + 'file instead, or switch models.',
    )
  })

  it('uploads a non-media file even when images and PDFs are unsupported', async () => {
    const attachedFiles = ref([]) as any
    const canAttachMediaType = ref(textOnly)
    const { uploadFiles } = useChatFiles(attachedFiles, canAttachMediaType)

    uploadWithProgressMock.mockImplementation(async ({ file }) => {
      return {
        data: {
          id: file.name,
          storageKey: file.name,
          name: file.name,
          size: file.size,
          type: file.type,
          source: 'upload',
          expiresAt: null,
        },
      }
    })

    await uploadFiles([createTextFile('notes.txt')])
    await waitFor(() => attachedFiles.value.length === 1)

    expect(useWarningMessageMock).not.toHaveBeenCalled()
  })

  it('uploads an untyped markdown file as text/markdown', async () => {
    const attachedFiles = ref([]) as any
    const canAttachMediaType = ref(textOnly)
    const { uploadFiles } = useChatFiles(attachedFiles, canAttachMediaType)

    uploadWithProgressMock.mockImplementation(async ({ file, headers }) => {
      return {
        data: {
          id: file.name,
          storageKey: file.name,
          name: file.name,
          size: file.size,
          type: headers['Content-Type'],
          source: 'upload',
          expiresAt: null,
        },
      }
    })

    expect(await uploadFiles([new File(['# Notes'], 'notes.md')])).toBe(true)
    await waitFor(() => attachedFiles.value.length === 1)

    expect(uploadWithProgressMock.mock.calls[0]![0].file.type)
      .toBe('text/markdown')
    expect(attachedFiles.value[0].type).toBe('text/markdown')
  })

  it('keeps supported files from a mixed batch and warns about the rest', async () => {
    const attachedFiles = ref([]) as any
    const canAttachMediaType = ref(textAndPdf)
    const { uploadFiles } = useChatFiles(attachedFiles, canAttachMediaType)

    uploadWithProgressMock.mockImplementation(async ({ file }) => {
      return {
        data: {
          id: file.name,
          storageKey: file.name,
          name: file.name,
          size: file.size,
          type: file.type,
          source: 'upload',
          expiresAt: null,
        },
      }
    })

    await uploadFiles([
      createImageFile('photo.png'),
      createPdfFile('doc.pdf'),
    ])
    await waitFor(() => attachedFiles.value.length === 1)

    expect(attachedFiles.value[0].name).toBe('doc.pdf')
    expect(useWarningMessageMock).toHaveBeenCalledTimes(1)
  })

  it('drops a completed image upload if support is revoked mid-flight', async () => {
    const attachedFiles = ref([]) as any
    const canAttachMediaType = ref<(mediaType: string) => boolean>(
      () => true,
    )
    const { uploadFiles } = useChatFiles(attachedFiles, canAttachMediaType)

    uploadWithProgressMock.mockImplementation(async ({ file }) => {
      canAttachMediaType.value = textAndPdf

      return {
        data: {
          id: file.name,
          storageKey: file.name,
          name: file.name,
          size: file.size,
          type: file.type,
          source: 'upload',
          expiresAt: null,
        },
      }
    })

    await uploadFiles([createImageFile('mid-flight.png')])
    await waitFor(() => useWarningMessageMock.mock.calls.length > 0)

    expect(attachedFiles.value).toEqual([])
    expect(useWarningMessageMock).toHaveBeenCalledWith(
      'This model does not support image input. Attach a PDF or text '
      + 'file instead, or switch models.',
    )
  })

  it('drops a completed PDF upload if support is revoked mid-flight', async () => {
    const attachedFiles = ref([]) as any
    const canAttachMediaType = ref<(mediaType: string) => boolean>(
      () => true,
    )
    const { uploadFiles } = useChatFiles(attachedFiles, canAttachMediaType)

    uploadWithProgressMock.mockImplementation(async ({ file }) => {
      canAttachMediaType.value = textAndImages

      return {
        data: {
          id: file.name,
          storageKey: file.name,
          name: file.name,
          size: file.size,
          type: file.type,
          source: 'upload',
          expiresAt: null,
        },
      }
    })

    await uploadFiles([createPdfFile('mid-flight.pdf')])
    await waitFor(() => useWarningMessageMock.mock.calls.length > 0)

    expect(attachedFiles.value).toEqual([])
    expect(useWarningMessageMock).toHaveBeenCalledWith(
      'This model does not support PDF input. Attach an image or text '
      + 'file instead, or switch models.',
    )
  })

  describe('Office documents', () => {
    const resolveDelivery = ref(createFileDeliveryResolver({
      route: 'direct',
      providerId: 'anthropic',
      modalities: ['text', 'image', 'pdf'],
    }))

    function turnOfficeOn() {
      useState('features').value = {
        features: {
          'files.office': { enabled: true, active: true, variant: null },
        },
        isAdmin: false,
      }
    }

    function echoUpload(extra: Record<string, unknown> = {}) {
      uploadWithProgressMock.mockImplementation(async ({ file }) => {
        return {
          data: {
            id: file.name,
            storageKey: file.name,
            name: file.name,
            size: file.size,
            type: file.type,
            source: 'upload',
            expiresAt: null,
            ...extra,
          },
        }
      })
    }

    it('never uploads a legacy Office file and says how to save it', async () => {
      turnOfficeOn()
      echoUpload()

      const { uploadFiles, uploadingFiles } = useChatFiles(
        ref([]) as any,
        ref(() => true),
        resolveDelivery,
      )

      const accepted = await uploadFiles([
        new File(['x'], 'old.xls', { type: 'application/vnd.ms-excel' }),
        new File(['x'], 'macro.docm', { type: '' }),
      ])

      expect(accepted).toBe(false)
      expect(uploadingFiles.value.size).toBe(0)
      expect(uploadWithProgressMock).not.toHaveBeenCalled()
      expect(useWarningMessageMock).toHaveBeenCalledWith(
        '2 files are old Office formats and cannot be read: '
        + 'old.xls, macro.docm. '
        + 'Save it as .xlsx / .docx / .pptx and upload again.',
      )
    })

    it('uploads the rest of a batch that has a legacy file', async () => {
      turnOfficeOn()
      echoUpload()

      const attachedFiles = ref([]) as any
      const { uploadFiles } = useChatFiles(
        attachedFiles,
        ref(() => true),
        resolveDelivery,
      )

      await uploadFiles([
        new File(['x'], 'old.ppt', { type: '' }),
        createTextFile('notes.txt'),
      ])
      await waitFor(() => attachedFiles.value.length === 1)

      expect(attachedFiles.value[0].name).toBe('notes.txt')
      expect(useWarningMessageMock).toHaveBeenCalledTimes(1)
    })

    it('uploads an xlsx whose browser type was empty with the Office type',
      async () => {
        turnOfficeOn()
        echoUpload({ textStatus: 'ready', textBytes: 120 })

        const attachedFiles = ref([]) as any
        const { uploadFiles } = useChatFiles(
          attachedFiles,
          ref(() => true),
          resolveDelivery,
        )

        await uploadFiles([new File(['PK'], 'budget.xlsx', { type: '' })])
        await waitFor(() => attachedFiles.value.length === 1)

        expect(uploadWithProgressMock.mock.calls[0]![0].file.type)
          .toBe(OFFICE_MEDIA_TYPES.xlsx)
        expect(uploadWithProgressMock.mock.calls[0]![0].headers['Content-Type'])
          .toBe(OFFICE_MEDIA_TYPES.xlsx)
        expect(attachedFiles.value[0]).toMatchObject({
          name: 'budget.xlsx',
          type: OFFICE_MEDIA_TYPES.xlsx,
          textStatus: 'ready',
        })
        expect(useWarningMessageMock).not.toHaveBeenCalled()
      })

    it('does not attach an upload whose text could not be read', async () => {
      turnOfficeOn()
      echoUpload({ textStatus: 'empty', textBytes: 0 })

      const attachedFiles = ref([]) as any
      const { uploadFiles } = useChatFiles(
        attachedFiles,
        ref(() => true),
        resolveDelivery,
      )

      await uploadFiles([new File(['PK'], 'blank.docx', { type: '' })])
      await waitFor(() => useWarningMessageMock.mock.calls.length > 0)

      expect(attachedFiles.value).toEqual([])
      expect(useWarningMessageMock).toHaveBeenCalledWith(
        expect.stringContaining('blank.docx: No text could be read'),
      )
    })

    it('attaches an upload whose text is read after the response', async () => {
      turnOfficeOn()
      echoUpload({ textStatus: null, textBytes: null })

      const attachedFiles = ref([]) as any
      const { uploadFiles } = useChatFiles(
        attachedFiles,
        ref(() => true),
        resolveDelivery,
      )

      await uploadFiles([new File(['PK'], 'slow.pptx', { type: '' })])
      await waitFor(() => attachedFiles.value.length === 1)

      expect(useWarningMessageMock).not.toHaveBeenCalled()
    })

    it('skips a type no model can take before uploading, like any invalid '
      + 'format', async () => {
      echoUpload()

      const { uploadFiles } = useChatFiles(
        ref([]) as any,
        ref(() => true),
        resolveDelivery,
      )

      const accepted = await uploadFiles([
        new File(['{}'], 'data.json', { type: 'application/json' }),
        new File(['x'], 'backup.zip', { type: 'application/zip' }),
      ])

      expect(accepted).toBe(false)
      expect(uploadWithProgressMock).not.toHaveBeenCalled()
      expect(useWarningMessageMock).toHaveBeenCalledWith(
        '2 file(s) skipped due to invalid format: data.json, backup.zip',
      )
    })

    it('uploads a JSON file when Run code can take it', async () => {
      echoUpload()

      const attachedFiles = ref([]) as any
      const { uploadFiles } = useChatFiles(
        attachedFiles,
        ref(() => true),
        ref(createFileDeliveryResolver({
          route: 'direct',
          providerId: 'anthropic',
          modalities: ['text', 'image', 'pdf'],
          codeExecutionFiles: true,
        })),
      )

      await uploadFiles([
        new File(['{}'], 'data.json', { type: 'application/json' }),
      ])
      await waitFor(() => attachedFiles.value.length === 1)

      expect(useWarningMessageMock).not.toHaveBeenCalled()
    })

    describe('legacy .xls conversion', () => {
      const xlsxType = OFFICE_MEDIA_TYPES.xlsx

      function convertedFile(name = 'jira.xlsx'): File {
        return new File(['converted'], name, { type: xlsxType })
      }

      function createXls(name = 'jira.xls'): File {
        return new File(['x'], name, { type: 'application/vnd.ms-excel' })
      }

      it('uploads the converted .xlsx instead of the .xls', async () => {
        turnOfficeOn()
        echoUpload()

        convertXlsFileMock.mockResolvedValue({
          status: 'converted',
          file: convertedFile(),
        })

        const attachedFiles = ref([]) as any
        const { uploadFiles, convertedFromXlsKeys } = useChatFiles(
          attachedFiles,
          ref(() => true),
          resolveDelivery,
        )

        const accepted = await uploadFiles([createXls()])

        await waitFor(() => attachedFiles.value.length === 1)

        expect(accepted).toBe(true)
        expect(convertXlsFileMock).toHaveBeenCalledTimes(1)
        expect(uploadWithProgressMock).toHaveBeenCalledTimes(1)

        const uploaded = uploadWithProgressMock.mock.calls[0]![0].file as File

        expect(await uploaded.text()).toBe('converted')
        expect(uploaded.name).toBe('jira.xlsx')
        expect(uploaded.type).toBe(xlsxType)
        expect(attachedFiles.value[0].name).toBe('jira.xlsx')
        expect([...convertedFromXlsKeys.value]).toEqual(['jira.xlsx'])
        expect(useWarningMessageMock).not.toHaveBeenCalled()
      })

      it('marks only the converted upload, not an .xlsx in the same batch',
        async () => {
          turnOfficeOn()
          echoUpload()
          convertXlsFileMock.mockResolvedValue({
            status: 'converted',
            file: convertedFile('jira.xlsx'),
          })

          const attachedFiles = ref([]) as any
          const { uploadFiles, convertedFromXlsKeys } = useChatFiles(
            attachedFiles,
            ref(() => true),
            resolveDelivery,
          )

          await uploadFiles([
            createXls(),
            new File(['y'], 'plain.xlsx', { type: xlsxType }),
          ])
          await waitFor(() => attachedFiles.value.length === 2)

          expect(convertXlsFileMock).toHaveBeenCalledTimes(1)
          expect([...convertedFromXlsKeys.value]).toEqual(['jira.xlsx'])
        })

      it('forgets the note when the attachment is removed', async () => {
        turnOfficeOn()
        echoUpload()
        convertXlsFileMock.mockResolvedValue({
          status: 'converted',
          file: convertedFile(),
        })

        const attachedFiles = ref([]) as any
        const {
          uploadFiles,
          convertedFromXlsKeys,
          removeAttachedFile,
          removeAllFiles,
        } = useChatFiles(attachedFiles, ref(() => true), resolveDelivery)

        await uploadFiles([createXls()])
        await waitFor(() => attachedFiles.value.length === 1)
        removeAttachedFile('jira.xlsx')

        expect(convertedFromXlsKeys.value.size).toBe(0)

        await uploadFiles([createXls()])
        await waitFor(() => attachedFiles.value.length === 1)
        removeAllFiles()

        expect(convertedFromXlsKeys.value.size).toBe(0)
      })

      it('falls back to the save-as hint when the conversion fails',
        async () => {
          turnOfficeOn()
          echoUpload()
          convertXlsFileMock.mockResolvedValue({
            status: 'failed',
            reason: 'timeout',
          })

          const { uploadFiles, uploadingFiles } = useChatFiles(
            ref([]) as any,
            ref(() => true),
            resolveDelivery,
          )

          const accepted = await uploadFiles([createXls()])

          expect(accepted).toBe(false)
          expect(uploadingFiles.value.size).toBe(0)
          expect(uploadWithProgressMock).not.toHaveBeenCalled()
          expect(useWarningMessageMock).toHaveBeenCalledWith(
            'jira.xls is an old Office format and cannot be read. '
            + 'Save it as .xlsx / .docx / .pptx and upload again.',
          )
        })

      it('keeps the rest of a batch when one .xls cannot be converted',
        async () => {
          turnOfficeOn()
          echoUpload()

          const attachedFiles = ref([]) as any
          const { uploadFiles } = useChatFiles(
            attachedFiles,
            ref(() => true),
            resolveDelivery,
          )

          await uploadFiles([createXls('fake.xls'), createTextFile('a.txt')])
          await waitFor(() => attachedFiles.value.length === 1)

          expect(attachedFiles.value[0].name).toBe('a.txt')
          expect(useWarningMessageMock).toHaveBeenCalledTimes(1)
        })

      it('never converts .doc, .ppt, macro files or .xlsm', async () => {
        turnOfficeOn()
        echoUpload()

        const { uploadFiles } = useChatFiles(
          ref([]) as any,
          ref(() => true),
          resolveDelivery,
        )

        await uploadFiles([
          new File(['x'], 'old.doc', { type: '' }),
          new File(['x'], 'old.ppt', { type: '' }),
          new File(['x'], 'macro.xlsm', { type: '' }),
          new File(['x'], 'template.xlt', { type: '' }),
        ])

        expect(convertXlsFileMock).not.toHaveBeenCalled()
        expect(uploadWithProgressMock).not.toHaveBeenCalled()
      })

      it('does not convert while the flag is off', async () => {
        echoUpload()

        const { uploadFiles } = useChatFiles(
          ref([]) as any,
          ref(() => true),
          resolveDelivery,
        )

        await uploadFiles([createXls()])
        await waitFor(() => uploadWithProgressMock.mock.calls.length === 1)

        expect(convertXlsFileMock).not.toHaveBeenCalled()
      })

      it('counts the converted size against the message limits', async () => {
        turnOfficeOn()
        echoUpload()
        convertXlsFileMock.mockResolvedValue({
          status: 'converted',
          file: new File(['z'.repeat(2048)], 'big.xlsx', { type: xlsxType }),
        })
        fetchMock.mockImplementation(async () => ({
          policy: {
            maxFilesPerMessage: 10,
            maxMessageFilesBytes: 1024,
          },
        }))

        const { uploadFiles } = useChatFiles(
          ref([]) as any,
          ref(() => true),
          resolveDelivery,
        )

        const accepted = await uploadFiles([createXls('big.xls')])

        expect(accepted).toBe(false)
        expect(uploadWithProgressMock).not.toHaveBeenCalled()
      })
    })

    it('leaves a legacy file to the server while the flag is off', async () => {
      echoUpload()

      const { uploadFiles } = useChatFiles(
        ref([]) as any,
        ref(() => true),
        resolveDelivery,
      )

      await uploadFiles([
        new File(['x'], 'old.xls', { type: 'application/vnd.ms-excel' }),
      ])
      await waitFor(() => uploadWithProgressMock.mock.calls.length === 1)

      expect(useWarningMessageMock).not.toHaveBeenCalledWith(
        expect.stringContaining('Save it as .xlsx'),
      )
    })
  })
})

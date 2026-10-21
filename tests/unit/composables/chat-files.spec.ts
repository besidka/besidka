import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { createInputMediaTypePredicate } from '../../../shared/utils/input-media-types'
import { useChatFiles } from '../../../app/composables/chat-files'

const {
  uploadWithProgressMock,
  fetchMock,
  useWarningMessageMock,
} = vi.hoisted(() => ({
  uploadWithProgressMock: vi.fn(),
  fetchMock: vi.fn(),
  useWarningMessageMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)
mockNuxtImport('useWarningMessage', () => useWarningMessageMock)

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
})

import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatFiles } from '../../../app/composables/chat-files'

const uploadWithProgressMock = vi.fn()

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

describe('useChatFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
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
    }))
  })

  afterEach(() => {
    uploadWithProgressMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('validates max file count before enqueue', async () => {
    const attachedFiles = ref([]) as any
    const { uploadFiles, uploadingFiles } = useChatFiles(attachedFiles)

    const files = Array.from({ length: 11 }, (_, index) => {
      return createTextFile(`file-${index}.txt`)
    })

    await uploadFiles(files)

    expect(uploadingFiles.value.size).toBe(0)
  })

  it('validates total file size before enqueue', async () => {
    vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
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
    }))

    const attachedFiles = ref([]) as any
    const { uploadFiles, uploadingFiles } = useChatFiles(attachedFiles)

    await uploadFiles([createTextFile('big.txt', 8)])

    expect(uploadingFiles.value.size).toBe(0)
    expect(uploadWithProgressMock).not.toHaveBeenCalled()
  })

  it('uploads files sequentially', async () => {
    const attachedFiles = ref([]) as any
    const { uploadFiles } = useChatFiles(attachedFiles)
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
    const { uploadFiles } = useChatFiles(attachedFiles)
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
    const { uploadFiles, uploadingFiles } = useChatFiles(attachedFiles)
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
})

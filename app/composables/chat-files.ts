import type { ModelRef } from 'vue'
import type { FileMetadata } from '#shared/types/files.d'
import { uploadWithProgress } from '~/utils/upload-with-progress'

export interface UploadingFile {
  id: string
  file: File
  status: 'waiting' | 'uploading' | 'completed' | 'failed'
  progress: number
  retryCount: number
  previewUrl?: string
  error?: string
  abortController?: AbortController
}

export interface UploadError {
  type: 'network' | 'validation' | 'server' | 'quota' | 'timeout' | 'cancelled'
  message: string
  retryable: boolean
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function useChatFiles(attachedFiles: ModelRef<FileMetadata[]>) {
  const nuxtApp = useNuxtApp()
  const uploadingFiles = ref<Map<string, UploadingFile>>(new Map())
  const uploadQueue = ref<string[]>([])
  const emitFilesUploaded = useDebounceFn(() => {
    nuxtApp.callHook('files:uploaded')
  }, 500)
  let isProcessing = false
  const MAX_AUTO_RETRIES = 1
  const AUTO_RETRY_DELAY_MS = 600

  const uploadingCount = computed(() =>
    Array.from(uploadingFiles.value.values())
      .filter(file => file.status === 'uploading').length,
  )

  const overallProgress = computed(() => {
    const files = Array.from(uploadingFiles.value.values())
    if (files.length === 0) return 0

    const totalProgress = files.reduce((sum, file) => sum + file.progress, 0)

    return Math.round(totalProgress / files.length)
  })

  const hasUploading = computed(() => uploadingFiles.value.size > 0)

  const completedCount = computed(() =>
    Array.from(uploadingFiles.value.values())
      .filter(file => file.status === 'completed').length,
  )

  const failedCount = computed(() =>
    Array.from(uploadingFiles.value.values())
      .filter(file => file.status === 'failed').length,
  )

  /**
   * Generate preview URL for image files
   */
  async function generatePreview(file: File): Promise<string | undefined> {
    if (!file.type.startsWith('image/')) return undefined

    return URL.createObjectURL(file)
  }

  /**
   * Classify upload error for user-friendly messaging
   */
  function classifyError(error: any): UploadError {
    if (error.message?.includes('Network') || error.message?.includes('network')) {
      return {
        type: 'network',
        message: 'Network connection lost. Please try again.',
        retryable: true,
      }
    }

    if (error.message?.includes('cancelled') || error.message?.includes('abort')) {
      return {
        type: 'cancelled',
        message: 'Upload was cancelled',
        retryable: false,
      }
    }

    if (error.status >= 500) {
      return {
        type: 'server',
        message: 'Server error occurred. Please try again.',
        retryable: true,
      }
    }

    if (error.status === 400 || error.status === 413) {
      return {
        type: 'validation',
        message: error.message || 'Invalid file. Please check file type and size.',
        retryable: false,
      }
    }

    if (error.message?.includes('storage') || error.message?.includes('quota')) {
      return {
        type: 'quota',
        message: 'Storage limit exceeded. Please delete some files.',
        retryable: false,
      }
    }

    if (error.message?.includes('timeout')) {
      return {
        type: 'timeout',
        message: 'Upload timed out. Please try again.',
        retryable: true,
      }
    }

    return {
      type: 'server',
      message: error.message || 'Upload failed. Please try again.',
      retryable: true,
    }
  }

  async function getValidationLimits(): Promise<{
    maxFilesPerMessage: number
    maxMessageFilesBytes: number
  }> {
    const defaults = useRuntimeConfig().public

    try {
      const filePolicyResponse = await $fetch(
        '/api/v1/files/policy',
      )

      return {
        maxFilesPerMessage: filePolicyResponse.policy.maxFilesPerMessage,
        maxMessageFilesBytes: filePolicyResponse.policy.maxMessageFilesBytes,
      }
    } catch (exception) {
      void exception
    }

    return {
      maxFilesPerMessage: defaults.maxFilesPerMessage,
      maxMessageFilesBytes: defaults.maxMessageFilesBytes,
    }
  }

  /**
   * Add files to upload queue
   */
  async function uploadFiles(newFiles: File[]) {
    const {
      maxFilesPerMessage,
      maxMessageFilesBytes,
    } = await getValidationLimits()

    const newFilesSize = newFiles.reduce((acc, file) => acc + file.size, 0)
    const existingFilesSize = attachedFiles.value.reduce(
      (acc, file) => acc + (file.size || 0), 0,
    )
    const totalSize = newFilesSize + existingFilesSize
    const totalCount = newFiles.length + attachedFiles.value.length

    if (newFiles.length > maxFilesPerMessage) {
      return useErrorMessage(
        `You can upload a maximum of ${maxFilesPerMessage} files at once.`,
      )
    } else if (totalCount > maxFilesPerMessage) {
      return useErrorMessage(
        `You can attach a maximum of ${maxFilesPerMessage} files in total. You currently have ${attachedFiles.value.length} attached.`,
      )
    } else if (newFilesSize > maxMessageFilesBytes) {
      return useErrorMessage(
        `Selected files size exceeds the maximum of ${formatFileSize(maxMessageFilesBytes)}`,
      )
    } else if (totalSize > maxMessageFilesBytes) {
      return useErrorMessage(
        `Total files size would exceed the maximum of ${formatFileSize(maxMessageFilesBytes)}. Current: ${formatFileSize(existingFilesSize)}, Adding: ${formatFileSize(newFilesSize)}`,
      )
    }

    for (const file of newFiles) {
      const id = crypto.randomUUID()
      const previewUrl = await generatePreview(file)

      uploadingFiles.value.set(id, {
        id,
        file,
        status: 'waiting',
        progress: 0,
        retryCount: 0,
        previewUrl,
      })

      uploadQueue.value.push(id)
    }

    void processQueue()
  }

  /**
   * Process upload queue sequentially
   */
  async function processQueue() {
    if (isProcessing) {
      return
    }

    isProcessing = true

    try {
      while (uploadQueue.value.length > 0) {
        const fileId = uploadQueue.value.shift()
        if (!fileId) continue

        const uploadFile = uploadingFiles.value.get(fileId)
        if (!uploadFile) continue

        await uploadSingleFile(uploadFile)
      }
    } finally {
      isProcessing = false
    }
  }

  /**
   * Upload single file with progress tracking
   */
  async function uploadSingleFile(uploadFile: UploadingFile) {
    uploadFile.status = 'uploading'
    uploadFile.progress = 0
    uploadFile.error = undefined
    uploadFile.abortController = new AbortController()

    try {
      const response = await uploadWithProgress({
        url: '/api/v1/files/upload',
        file: uploadFile.file,
        headers: {
          'Content-Type': uploadFile.file.type,
          'X-Filename': encodeURIComponent(uploadFile.file.name),
          'X-Filesize': uploadFile.file.size.toString(),
        },
        onProgress: (percent) => {
          uploadFile.progress = percent
        },
        signal: uploadFile.abortController.signal,
      })

      const isStillTracked = uploadingFiles.value.has(uploadFile.id)

      uploadFile.status = 'completed'
      uploadFile.progress = 100

      if (!isStillTracked) {
        return
      }

      if (response.data) {
        attachedFiles.value.push(response.data)
      }

      emitFilesUploaded()

      if (uploadFile.previewUrl) {
        URL.revokeObjectURL(uploadFile.previewUrl)
        uploadFile.previewUrl = undefined
      }

      setTimeout(() => {
        if (uploadingFiles.value.has(uploadFile.id)) {
          uploadingFiles.value.delete(uploadFile.id)
        }
      }, 2000)
    } catch (error: any) {
      if (!uploadingFiles.value.has(uploadFile.id)) {
        return
      }

      const classifiedError = classifyError(error)

      if (
        classifiedError.retryable
        && uploadFile.retryCount < MAX_AUTO_RETRIES
      ) {
        uploadFile.retryCount += 1
        uploadFile.status = 'waiting'
        uploadFile.progress = 0
        uploadFile.error = undefined

        await delay(AUTO_RETRY_DELAY_MS)

        if (uploadingFiles.value.has(uploadFile.id)) {
          uploadQueue.value.push(uploadFile.id)

          return
        }
      }

      uploadFile.status = 'failed'
      uploadFile.error = classifiedError.message

      if (classifiedError.type !== 'cancelled') {
        useErrorMessage(
          `Failed to upload ${uploadFile.file.name}: ${classifiedError.message}`,
        )
      }
    }
  }

  /**
   * Cancel upload for a specific file
   */
  function cancelUpload(fileId: string) {
    const file = uploadingFiles.value.get(fileId)
    if (!file) return

    if (file.abortController) {
      file.abortController.abort()
    }

    if (file.previewUrl) {
      URL.revokeObjectURL(file.previewUrl)
    }

    uploadingFiles.value.delete(fileId)

    const queueIndex = uploadQueue.value.indexOf(fileId)
    if (queueIndex !== -1) {
      uploadQueue.value.splice(queueIndex, 1)
    }
  }

  /**
   * Retry failed upload
   */
  async function retryUpload(fileId: string) {
    const file = uploadingFiles.value.get(fileId)
    if (!file) return

    file.status = 'waiting'
    file.progress = 0
    file.error = undefined
    file.retryCount = 0

    uploadQueue.value.push(fileId)
    void processQueue()
  }

  /**
   * Clear all completed uploads
   */
  function clearCompleted() {
    for (const [id, file] of uploadingFiles.value) {
      if (file.status === 'completed') {
        if (file.previewUrl) {
          URL.revokeObjectURL(file.previewUrl)
        }
        uploadingFiles.value.delete(id)
      }
    }
  }

  /**
   * Cancel all uploads
   */
  function cancelAllUploads() {
    for (const [_id, file] of uploadingFiles.value) {
      if (file.abortController) {
        file.abortController.abort()
      }
      if (file.previewUrl) {
        URL.revokeObjectURL(file.previewUrl)
      }
    }
    uploadingFiles.value.clear()
    uploadQueue.value = []
  }

  /**
   * Remove file from attached files array
   */
  function removeAttachedFile(storageKey: string) {
    const index = attachedFiles.value.findIndex((file) => {
      return file.storageKey === storageKey
    })

    if (index !== -1) {
      attachedFiles.value.splice(index, 1)
    }
  }

  /**
   * Remove all attached files and cancel all uploads
   */
  function removeAllFiles() {
    cancelAllUploads()
    attachedFiles.value = []
  }

  nuxtApp.hook('files:deleted', (deletedIds: string[]) => {
    const deletedSet = new Set(deletedIds)
    attachedFiles.value = attachedFiles.value.filter((file) => {
      return !deletedSet.has(file.id)
    })
  })

  nuxtApp.hook('chat:submit', () => {
    cancelAllUploads()
  })

  onUnmounted(() => {
    cancelAllUploads()
  })

  return {
    uploadingFiles,
    uploadingCount,
    overallProgress,
    hasUploading,
    completedCount,
    failedCount,
    uploadFiles,
    cancelUpload,
    retryUpload,
    clearCompleted,
    cancelAllUploads,
    removeAttachedFile,
    removeAllFiles,
  }
}

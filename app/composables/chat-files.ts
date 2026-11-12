import type { ModelRef, Ref } from 'vue'
import type { FileMetadata } from '#shared/types/files.d'
import type { FileDeliveryReason } from '#shared/utils/file-delivery'
import type {
  FileDeliveryResolver,
  FileRejection,
} from '~/utils/file-delivery-hints'
import { uploadWithProgress } from '~/utils/upload-with-progress'
import { isXlsFile } from '~/utils/xls-convert'

export interface UploadingFile {
  id: string
  file: File
  status: 'waiting' | 'uploading' | 'completed' | 'failed'
  progress: number
  retryCount: number
  previewUrl?: string
  convertedFromXls?: boolean
  error?: string
  abortController?: AbortController
}

export interface ClassifiedUploadError {
  type: 'network' | 'validation' | 'server' | 'quota' | 'timeout' | 'cancelled'
  message: string
  retryable: boolean
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

const PRE_UPLOAD_REJECTION_REASONS: readonly (FileDeliveryReason | undefined)[]
  = ['model-no-image', 'model-no-pdf', 'unsupported-type']

export function useChatFiles(
  attachedFiles: ModelRef<FileMetadata[]>,
  canAttachMediaType: Ref<(mediaType: string) => boolean>,
  resolveDelivery?: Ref<FileDeliveryResolver>,
) {
  const nuxtApp = useNuxtApp()
  const officeFeature = useFeature('files.office')
  const { ensureSendConsent } = useLegalConsent()
  const { convertXlsFile } = useXlsConversion()
  const uploadingFiles = ref<Map<string, UploadingFile>>(new Map())
  const uploadQueue = ref<string[]>([])
  const convertedFromXlsKeys = ref<Set<string>>(new Set())
  const convertedFiles = new WeakSet<File>()
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
  function classifyError(error: any): ClassifiedUploadError {
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

  function getFileRejections(
    files: { type: string, name: string, textStatus?: string | null }[],
  ): FileRejection[] {
    const resolve = resolveDelivery?.value
      ?? createPredicateDeliveryResolver(canAttachMediaType.value)

    return files.flatMap((file) => {
      const rejection = getFileRejection(file, resolve)

      return rejection ? [rejection] : []
    })
  }

  /**
   * Replaces each browser-readable `.xls` with its `.xlsx` conversion. A file
   * that cannot be converted stays as it is, so the legacy-file check right
   * after it shows the "Save it as .xlsx" hint instead of a crash.
   */
  async function convertLegacySpreadsheets(
    candidateFiles: File[],
  ): Promise<File[]> {
    if (!officeFeature.value.active) {
      return candidateFiles
    }

    const preparedFiles: File[] = []

    for (const file of candidateFiles) {
      if (!isXlsFile(file)) {
        preparedFiles.push(file)

        continue
      }

      const conversion = await convertXlsFile(file)

      if (conversion.status === 'converted') {
        convertedFiles.add(conversion.file)
        preparedFiles.push(conversion.file)

        continue
      }

      preparedFiles.push(file)
    }

    return preparedFiles
  }

  /**
   * Central choke point for every upload path (the modal, the full-page
   * drop zone, and clipboard paste) — filtering here instead of in each
   * caller guarantees an image or PDF never reaches the server for a model
   * that can't take it, and a legacy Office file (.doc, .xls, .ppt) never
   * reaches it at all, regardless of which affordance the user picked.
   */
  function rejectUnsupportedFiles(candidateFiles: File[]): File[] {
    const allowedFiles: File[] = []
    const legacyOfficeNames: string[] = []
    const rejections: FileRejection[] = []
    const invalidFormatNames: string[] = []

    for (const file of candidateFiles) {
      if (officeFeature.value.active && isLegacyOfficeFile(file)) {
        legacyOfficeNames.push(file.name)

        continue
      }

      const [rejection] = getFileRejections([file])

      if (
        rejection
        && PRE_UPLOAD_REJECTION_REASONS.includes(rejection.reason)
      ) {
        if (rejection.reason === 'unsupported-type') {
          invalidFormatNames.push(file.name)
        } else {
          rejections.push(rejection)
        }

        continue
      }

      allowedFiles.push(file)
    }

    if (legacyOfficeNames.length > 0) {
      useWarningMessage(getLegacyOfficeMessage(legacyOfficeNames))
    }

    if (invalidFormatNames.length > 0) {
      useWarningMessage(getInvalidFormatMessage(invalidFormatNames))
    }

    for (const message of getRejectionMessages(
      rejections,
      canAttachMediaType.value,
    )) {
      useWarningMessage(message)
    }

    return allowedFiles
  }

  /**
   * Add files to upload queue. Resolves true only when the files were
   * accepted and queued, false when they were refused before queuing.
   */
  async function uploadFiles(candidateFiles: File[]): Promise<boolean> {
    const preparedFiles = await convertLegacySpreadsheets(candidateFiles)
    const newFiles = rejectUnsupportedFiles(
      preparedFiles.map(normalizeUploadFile),
    )

    if (newFiles.length === 0) {
      return false
    }

    if (!await ensureSendConsent(null)) {
      return false
    }

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
      useErrorMessage(
        `You can upload a maximum of ${maxFilesPerMessage} files at once.`,
      )

      return false
    } else if (totalCount > maxFilesPerMessage) {
      useErrorMessage(
        `You can attach a maximum of ${maxFilesPerMessage} files in total. You currently have ${attachedFiles.value.length} attached.`,
      )

      return false
    } else if (newFilesSize > maxMessageFilesBytes) {
      useErrorMessage(
        `Selected files size exceeds the maximum of ${formatFileSize(maxMessageFilesBytes)}`,
      )

      return false
    } else if (totalSize > maxMessageFilesBytes) {
      useErrorMessage(
        `Total files size would exceed the maximum of ${formatFileSize(maxMessageFilesBytes)}. Current: ${formatFileSize(existingFilesSize)}, Adding: ${formatFileSize(newFilesSize)}`,
      )

      return false
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
        convertedFromXls: convertedFiles.has(file),
      })

      uploadQueue.value.push(id)
    }

    void processQueue()

    return true
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
        const rejections = getFileRejections([response.data])

        if (rejections.length > 0) {
          for (const message of getRejectionMessages(
            rejections,
            canAttachMediaType.value,
          )) {
            useWarningMessage(message)
          }
        } else {
          attachedFiles.value.push(response.data)

          if (uploadFile.convertedFromXls) {
            convertedFromXlsKeys.value.add(response.data.storageKey)
          }
        }
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

    convertedFromXlsKeys.value.delete(storageKey)
  }

  /**
   * Remove all attached files and cancel all uploads
   */
  function removeAllFiles() {
    cancelAllUploads()
    attachedFiles.value = []
    convertedFromXlsKeys.value.clear()
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
    convertedFromXlsKeys,
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

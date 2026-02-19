export interface UploadOptions {
  url: string
  file: File
  headers?: Record<string, string>
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}

export interface UploadResponse<T = any> {
  data: T
  status: number
  statusText: string
}

export class UploadError extends Error {
  constructor(
    message: string,
    public status?: number,
    public statusText?: string,
  ) {
    super(message)
    this.name = 'UploadError'
  }
}

/**
 * Upload a file using XMLHttpRequest with progress tracking
 * @param options Upload configuration options
 * @returns Promise resolving to upload response
 */
export function uploadWithProgress<T = any>(
  options: UploadOptions,
): Promise<UploadResponse<T>> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()

    if (options.onProgress) {
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percentComplete = Math.round(
            (event.loaded / event.total) * 100,
          )
          options.onProgress?.(percentComplete)
        }
      })
    }

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = xhr.responseText
            ? JSON.parse(xhr.responseText)
            : null

          resolve({
            data,
            status: xhr.status,
            statusText: xhr.statusText,
          })
        } catch {
          reject(
            new UploadError(
              'Failed to parse response',
              xhr.status,
              xhr.statusText,
            ),
          )
        }
      } else {
        let errorMessage = xhr.statusText
        let parsedErrorMessage: string | null = null

        try {
          const errorData = JSON.parse(xhr.responseText)
          parsedErrorMessage = errorData.statusMessage
            || errorData.message
            || null
        } catch (exception) {
          parsedErrorMessage = null
          void exception
        }

        if (parsedErrorMessage) {
          errorMessage = parsedErrorMessage
        }

        reject(
          new UploadError(
            errorMessage,
            xhr.status,
            xhr.statusText,
          ),
        )
      }
    })

    xhr.addEventListener('error', () => {
      reject(new UploadError('Network error occurred during upload'))
    })

    xhr.addEventListener('timeout', () => {
      reject(new UploadError('Upload request timed out'))
    })

    xhr.addEventListener('abort', () => {
      reject(new UploadError('Upload was cancelled'))
    })

    if (options.signal) {
      options.signal.addEventListener('abort', () => {
        xhr.abort()
      })
    }

    xhr.open('PUT', options.url)

    if (options.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        xhr.setRequestHeader(key, value)
      }
    }

    xhr.send(options.file)
  })
}

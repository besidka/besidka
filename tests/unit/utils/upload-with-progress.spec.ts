import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  UploadError,
  uploadWithProgress,
} from '../../../app/utils/upload-with-progress'

interface MockProgressEvent {
  lengthComputable: boolean
  loaded: number
  total: number
}

type ProgressListener = (event: MockProgressEvent) => void

class MockXMLHttpRequest {
  static queue: Array<(xhr: MockXMLHttpRequest) => void> = []

  upload = {
    addEventListener: (
      event: string,
      callback: (progressEvent: MockProgressEvent) => void,
    ) => {
      this.uploadListeners.set(event, callback)
    },
  }

  status = 0
  statusText = ''
  responseText = ''

  private listeners = new Map<string, () => void>()
  private uploadListeners = new Map<string, ProgressListener>()

  addEventListener(event: string, callback: () => void) {
    this.listeners.set(event, callback)
  }

  open(_method: string, _url: string) {}

  setRequestHeader(_key: string, _value: string) {}

  send(_file: File) {
    const behavior = MockXMLHttpRequest.queue.shift()

    if (behavior) {
      behavior(this)
    }
  }

  abort() {
    this.emit('abort')
  }

  emit(event: string) {
    const callback = this.listeners.get(event)

    if (callback) {
      callback()
    }
  }

  emitProgress(event: MockProgressEvent) {
    const callback = this.uploadListeners.get('progress')

    if (callback) {
      callback(event)
    }
  }
}

describe('uploadWithProgress', () => {
  beforeEach(() => {
    MockXMLHttpRequest.queue = []
    vi.stubGlobal('XMLHttpRequest', MockXMLHttpRequest as any)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports upload progress and resolves data', async () => {
    const progress = vi.fn()

    MockXMLHttpRequest.queue.push((xhr) => {
      xhr.emitProgress({
        lengthComputable: true,
        loaded: 50,
        total: 100,
      })
      xhr.status = 200
      xhr.statusText = 'OK'
      xhr.responseText = JSON.stringify({ id: 'file-1' })
      xhr.emit('load')
    })

    const response = await uploadWithProgress({
      url: '/api/v1/files/upload',
      file: new File(['hello'], 'hello.txt', { type: 'text/plain' }),
      onProgress: progress,
    })

    expect(progress).toHaveBeenCalledWith(50)
    expect(response.status).toBe(200)
    expect(response.data).toEqual({ id: 'file-1' })
  })

  it('parses statusMessage from non-2xx response', async () => {
    MockXMLHttpRequest.queue.push((xhr) => {
      xhr.status = 400
      xhr.statusText = 'Bad Request'
      xhr.responseText = JSON.stringify({
        statusMessage: 'Invalid file type',
      })
      xhr.emit('load')
    })

    await expect(uploadWithProgress({
      url: '/api/v1/files/upload',
      file: new File(['abc'], 'a.txt', { type: 'text/plain' }),
    })).rejects.toMatchObject({
      message: 'Invalid file type',
      status: 400,
    })
  })

  it('rejects with timeout error', async () => {
    MockXMLHttpRequest.queue.push((xhr) => {
      xhr.emit('timeout')
    })

    await expect(uploadWithProgress({
      url: '/api/v1/files/upload',
      file: new File(['abc'], 'a.txt', { type: 'text/plain' }),
    })).rejects.toEqual(
      expect.objectContaining({
        message: 'Upload request timed out',
      }),
    )
  })

  it('rejects with network error', async () => {
    MockXMLHttpRequest.queue.push((xhr) => {
      xhr.emit('error')
    })

    await expect(uploadWithProgress({
      url: '/api/v1/files/upload',
      file: new File(['abc'], 'a.txt', { type: 'text/plain' }),
    })).rejects.toEqual(
      expect.objectContaining({
        message: 'Network error occurred during upload',
      }),
    )
  })

  it('aborts upload through AbortSignal', async () => {
    MockXMLHttpRequest.queue.push((_xhr) => {})

    const controller = new AbortController()
    const promise = uploadWithProgress({
      url: '/api/v1/files/upload',
      file: new File(['abc'], 'a.txt', { type: 'text/plain' }),
      signal: controller.signal,
    })

    controller.abort()

    await expect(promise).rejects.toBeInstanceOf(UploadError)
    await expect(promise).rejects.toMatchObject({
      message: 'Upload was cancelled',
    })
  })
})

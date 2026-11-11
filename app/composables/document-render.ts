import type {
  DocumentRenderFailureCode,
  DocumentRenderInput,
  DocumentRenderOutput,
  DocumentWorkerRequest,
  DocumentWorkerResponse,
} from '~/types/document-render.d'
import {
  DOCUMENT_WORKER_IDLE_MS,
  DOCUMENT_WORKER_TIMEOUT_MS,
} from '#shared/utils/documents'

export class DocumentRenderError extends Error {
  readonly code: DocumentRenderFailureCode
  readonly detail: string

  constructor(code: DocumentRenderFailureCode, detail: string = code) {
    super(detail)
    this.name = 'DocumentRenderError'
    this.code = code
    this.detail = detail
  }
}

let worker: Worker | null = null
let queue: Promise<unknown> = Promise.resolve()
let pendingCount: number = 0
let nextRequestId: number = 0
let idleTimeoutId: ReturnType<typeof setTimeout> | null = null
let failActiveRequest: ((error: DocumentRenderError) => void) | null = null

function clearIdleTimer(): void {
  if (idleTimeoutId === null) {
    return
  }

  clearTimeout(idleTimeoutId)
  idleTimeoutId = null
}

function terminateWorker(): void {
  clearIdleTimer()

  if (!worker) {
    return
  }

  worker.onmessage = null
  worker.onerror = null
  worker.onmessageerror = null
  worker.terminate()
  worker = null
}

function scheduleIdleTermination(): void {
  clearIdleTimer()
  idleTimeoutId = setTimeout(() => {
    if (pendingCount === 0) {
      terminateWorker()
    }
  }, DOCUMENT_WORKER_IDLE_MS)
}

function getWorker(): Worker {
  if (worker) {
    return worker
  }

  if (!import.meta.client || typeof Worker === 'undefined') {
    throw new DocumentRenderError('worker_error', 'worker-unavailable')
  }

  try {
    worker = new Worker(
      new URL('../workers/document-render.ts', import.meta.url),
      { type: 'module' },
    )
  } catch (_exception) {
    throw new DocumentRenderError('worker_error', 'worker-unavailable')
  }

  return worker
}

function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}

function buildWorkerRequest(
  requestId: number,
  input: DocumentRenderInput,
): DocumentWorkerRequest {
  return {
    id: requestId,
    spec: input.spec,
    assets: (input.assets ?? []).map((asset) => {
      return {
        id: asset.id,
        bytes: toTransferableBuffer(asset.bytes),
        mediaType: asset.mediaType,
      }
    }),
    ...(input.modelId ? { modelId: input.modelId } : {}),
  }
}

function runRequest(input: DocumentRenderInput): Promise<DocumentRenderOutput> {
  return new Promise((resolve, reject) => {
    let activeWorker: Worker

    try {
      activeWorker = getWorker()
    } catch (exception) {
      reject(exception)

      return
    }

    nextRequestId += 1

    const request = buildWorkerRequest(nextRequestId, input)
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let isSettled = false

    function settle(finish: () => void): void {
      if (isSettled) {
        return
      }

      isSettled = true
      failActiveRequest = null

      if (timeoutId !== null) {
        clearTimeout(timeoutId)
      }

      finish()
    }

    function failWith(error: DocumentRenderError): void {
      settle(() => {
        if (worker === activeWorker) {
          terminateWorker()
        }

        reject(error)
      })
    }

    failActiveRequest = failWith
    timeoutId = setTimeout(() => {
      failWith(new DocumentRenderError('timeout', 'render-timeout'))
    }, DOCUMENT_WORKER_TIMEOUT_MS)

    activeWorker.onmessage = (
      event: MessageEvent<DocumentWorkerResponse>,
    ) => {
      const response = event.data

      if (response?.id !== request.id) {
        return
      }

      settle(() => {
        if (!response.ok) {
          reject(new DocumentRenderError(response.code, response.detail))

          return
        }

        resolve({
          bytes: new Uint8Array(response.bytes),
          mediaType: response.mediaType,
          stats: response.stats,
        })
      })
    }
    activeWorker.onerror = () => {
      failWith(new DocumentRenderError('worker_error', 'worker-error'))
    }
    activeWorker.onmessageerror = () => {
      failWith(new DocumentRenderError('worker_error', 'worker-error'))
    }

    try {
      activeWorker.postMessage(
        request,
        request.assets.map(asset => asset.bytes),
      )
    } catch (_exception) {
      failWith(new DocumentRenderError('worker_error', 'worker-error'))
    }
  })
}

/**
 * Renders a document spec to file bytes in a lazily created, shared module
 * Web Worker. One render runs at a time; further calls queue behind it. A
 * render that exceeds `DOCUMENT_WORKER_TIMEOUT_MS` terminates the worker and
 * rejects with code `timeout`; the idle worker is terminated after
 * `DOCUMENT_WORKER_IDLE_MS`. Every failure rejects with a
 * `DocumentRenderError` carrying a stable `code`.
 */
export function useDocumentRender() {
  function render(input: DocumentRenderInput): Promise<DocumentRenderOutput> {
    pendingCount += 1
    clearIdleTimer()

    const rendering = queue.then(() => runRequest(input))

    queue = rendering.then(() => undefined, () => undefined)

    return rendering.finally(() => {
      pendingCount -= 1

      if (pendingCount === 0 && worker) {
        scheduleIdleTermination()
      }
    })
  }

  function dispose(): void {
    if (pendingCount === 0) {
      terminateWorker()
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose)
  }

  return { render, dispose }
}

/**
 * Forces the shared worker down and rejects the render in flight; queued
 * renders then start a fresh worker.
 */
export function resetDocumentRenderWorker(): void {
  failActiveRequest?.(new DocumentRenderError('worker_error', 'worker-reset'))
  terminateWorker()
}

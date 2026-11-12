import type {
  XlsConversionResult,
  XlsConvertFailureReason,
  XlsWorkerRequest,
  XlsWorkerResponse,
} from '~/types/xls-convert.d'
import {
  XLSX_MEDIA_TYPE,
  XLS_CONVERT_MAX_INPUT_BYTES,
  XLS_CONVERT_TIMEOUT_MS,
  getConvertedXlsxName,
  readsAsCfb,
} from '~/utils/xls-convert'

function fail(reason: XlsConvertFailureReason): XlsConversionResult {
  return { status: 'failed', reason }
}

/**
 * Converts a legacy `.xls` to `.xlsx` in the browser, one file at a time.
 * Each file gets its own lazily created Web Worker that is terminated as soon
 * as the file is done, fails or times out, so SheetJS is never loaded on the
 * server or in the main thread. Never throws: every failure is a `failed`
 * result and the caller falls back to the "Save it as .xlsx" hint.
 */
export function useXlsConversion() {
  const activeWorkers = new Map<Worker, () => void>()

  function createWorker(): Worker | null {
    if (!import.meta.client || typeof Worker === 'undefined') {
      return null
    }

    try {
      return new Worker(
        new URL('../workers/xls-convert.ts', import.meta.url),
        { type: 'module' },
      )
    } catch (exception) {
      void exception

      return null
    }
  }

  function terminateWorker(worker: Worker): void {
    worker.onmessage = null
    worker.onerror = null
    worker.onmessageerror = null
    worker.terminate()
    activeWorkers.delete(worker)
  }

  function abortWorker(worker: Worker): void {
    activeWorkers.get(worker)?.()
    terminateWorker(worker)
  }

  function runInWorker(
    worker: Worker,
    request: XlsWorkerRequest,
  ): Promise<XlsWorkerResponse> {
    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        resolve({ id: request.id, ok: false, reason: 'timeout' })
      }, XLS_CONVERT_TIMEOUT_MS)

      function settle(response: XlsWorkerResponse): void {
        clearTimeout(timeoutId)
        resolve(response)
      }

      activeWorkers.set(worker, () => {
        settle({ id: request.id, ok: false, reason: 'worker-error' })
      })
      worker.onmessage = (event: MessageEvent<XlsWorkerResponse>) => {
        if (event.data?.id !== request.id) {
          return
        }

        settle(event.data)
      }
      worker.onerror = () => {
        settle({ id: request.id, ok: false, reason: 'worker-error' })
      }
      worker.onmessageerror = () => {
        settle({ id: request.id, ok: false, reason: 'worker-error' })
      }
      worker.postMessage(request, [request.bytes])
    })
  }

  async function convertXlsFile(file: File): Promise<XlsConversionResult> {
    if (file.size > XLS_CONVERT_MAX_INPUT_BYTES) {
      return fail('too-large')
    }

    if (!await readsAsCfb(file)) {
      return fail('not-cfb')
    }

    let bytes: ArrayBuffer

    try {
      bytes = await file.arrayBuffer()
    } catch (exception) {
      void exception

      return fail('convert-failed')
    }

    const worker = createWorker()

    if (!worker) {
      return fail('worker-unavailable')
    }

    try {
      const response = await runInWorker(worker, { id: 1, bytes })

      if (!response.ok) {
        return fail(response.reason)
      }

      const convertedFile = new File(
        [response.bytes],
        getConvertedXlsxName(file.name),
        { type: XLSX_MEDIA_TYPE, lastModified: file.lastModified },
      )

      return { status: 'converted', file: convertedFile }
    } catch (exception) {
      void exception

      return fail('convert-failed')
    } finally {
      terminateWorker(worker)
    }
  }

  function dispose(): void {
    for (const worker of [...activeWorkers.keys()]) {
      abortWorker(worker)
    }
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose)
  }

  return { convertXlsFile, dispose }
}

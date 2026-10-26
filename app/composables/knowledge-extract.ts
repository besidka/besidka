import type {
  KnowledgeExtractionResult,
  KnowledgeExtractOptions,
  KnowledgeWorkerRequest,
  KnowledgeWorkerResponse,
  KnowledgeWorkerResult,
} from '~/types/knowledge-extract.d'
import {
  KNOWLEDGE_LIMITS,
  getKnowledgeFileCategory,
} from '#shared/utils/project-knowledge-policy'

export const KNOWLEDGE_EXTRACTION_TIMEOUT_MS = 60_000
export const KNOWLEDGE_WORKER_IDLE_MS = 30_000

const MAX_MEDIA_TYPE_CHARS = 100
const MAX_CONVERTIBLE_HTML_CHARS = 8 * 1024 * 1024

const mediaTypesByExtension: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument'
    + '.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument'
    + '.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  md: 'text/markdown',
  mdx: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  css: 'text/css',
}

const originalUploadErrors: ReadonlyArray<string | null> = [
  null,
  'ios-update-required',
]

function getFileExtension(fileName: string): string {
  const separatorIndex = fileName.lastIndexOf('.')

  if (separatorIndex < 0) {
    return ''
  }

  return fileName.slice(separatorIndex + 1).toLowerCase()
}

function resolveMediaType(file: File): string {
  const declaredType = file.type.trim().toLowerCase()
  const mediaType = declaredType
    || mediaTypesByExtension[getFileExtension(file.name)]
    || 'text/plain'

  return mediaType.slice(0, MAX_MEDIA_TYPE_CHARS)
}

function isOriginalUploadCandidate(file: File): boolean {
  return getFileExtension(file.name) === 'pdf'
    || getKnowledgeFileCategory(file.name) === 'image'
}

function createFailedWorkerResult(extractError: string): KnowledgeWorkerResult {
  return {
    extractor: 'text',
    extractStatus: 'failed',
    extractError,
    text: '',
    pageCount: null,
    contentHash: '',
  }
}

function createAbortError(): DOMException {
  return new DOMException('Knowledge extraction aborted', 'AbortError')
}

function getUtf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createAbortError()
  }
}

function yieldToEventLoop(): Promise<void> {
  const { scheduler } = globalThis as {
    scheduler?: { yield?: () => Promise<void> }
  }

  if (typeof scheduler?.yield === 'function') {
    return scheduler.yield()
  }

  return new Promise((resolve) => {
    setTimeout(resolve)
  })
}

async function convertWorkerResultText(
  result: KnowledgeWorkerResult,
  signal: AbortSignal,
): Promise<KnowledgeWorkerResult> {
  if (result.html === undefined) {
    return result
  }

  const { html, ...resultWithoutHtml } = result

  if (html.length > MAX_CONVERTIBLE_HTML_CHARS) {
    return {
      ...resultWithoutHtml,
      extractStatus: 'failed',
      extractError: 'too-large',
      text: '',
    }
  }

  throwIfAborted(signal)
  await yieldToEventLoop()
  throwIfAborted(signal)

  const { htmlToKnowledgeMarkdown } = await import(
    '~/utils/knowledge-html-to-markdown'
  )

  throwIfAborted(signal)

  const markdown = htmlToKnowledgeMarkdown(html)

  await yieldToEventLoop()
  throwIfAborted(signal)

  if (markdown.length === 0) {
    return { ...resultWithoutHtml, extractStatus: 'no-text', text: '' }
  }

  return { ...resultWithoutHtml, text: markdown }
}

function enforceItemTextLimit(
  result: KnowledgeWorkerResult,
): KnowledgeWorkerResult {
  if (
    result.extractStatus !== 'ready'
    || getUtf8ByteLength(result.text) <= KNOWLEDGE_LIMITS.maxItemTextBytes
  ) {
    return result
  }

  return {
    ...result,
    extractStatus: 'failed',
    extractError: 'too-large',
    text: '',
  }
}

function toExtractionResult(
  file: File,
  workerResult: KnowledgeWorkerResult,
): KnowledgeExtractionResult {
  const canUploadOriginal = isOriginalUploadCandidate(file)
    && (
      workerResult.extractStatus !== 'failed'
      || originalUploadErrors.includes(workerResult.extractError)
    )

  return {
    extractor: workerResult.extractor,
    extractStatus: workerResult.extractStatus,
    extractError: workerResult.extractError,
    text: workerResult.text,
    pageCount: workerResult.pageCount,
    contentHash: workerResult.contentHash,
    mediaType: resolveMediaType(file),
    sizeBytes: file.size,
    needsOriginalUpload: canUploadOriginal,
  }
}

/**
 * Extracts knowledge text from files one at a time in a lazily created Web
 * Worker, with a main-thread fallback. Aborting rejects with an `AbortError`
 * DOMException; a timeout resolves with `extractStatus: 'failed'` and
 * `extractError: 'timeout'`.
 */
export function useKnowledgeExtraction() {
  const isBusy = shallowRef<boolean>(false)

  let worker: Worker | null = null
  let queue: Promise<unknown> = Promise.resolve()
  let pendingCount: number = 0
  let nextRequestId: number = 0
  let idleTimeoutId: ReturnType<typeof setTimeout> | null = null
  let lifetime = new AbortController()

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
    idleTimeoutId = setTimeout(terminateWorker, KNOWLEDGE_WORKER_IDLE_MS)
  }

  function getWorker(): Worker | null {
    if (worker) {
      return worker
    }

    if (!import.meta.client || typeof Worker === 'undefined') {
      return null
    }

    try {
      worker = new Worker(
        new URL('../workers/knowledge-extract.ts', import.meta.url),
        { type: 'module' },
      )
    } catch {
      return null
    }

    return worker
  }

  function runInWorker(
    activeWorker: Worker,
    request: KnowledgeWorkerRequest,
  ): Promise<KnowledgeWorkerResult> {
    return new Promise((resolve) => {
      function failWorker(extractError: string): void {
        if (worker === activeWorker) {
          terminateWorker()
        }

        resolve(createFailedWorkerResult(extractError))
      }

      activeWorker.onmessage = (
        event: MessageEvent<KnowledgeWorkerResponse>,
      ) => {
        if (event.data?.id !== request.id) {
          return
        }

        const { id: _id, ...result } = event.data

        resolve(result)
      }
      activeWorker.onerror = () => failWorker('worker-error')
      activeWorker.onmessageerror = () => failWorker('worker-error')
      activeWorker.postMessage(request, [request.bytes])
    })
  }

  async function runOnMainThread(
    request: KnowledgeWorkerRequest,
  ): Promise<KnowledgeWorkerResult> {
    const { extractKnowledgeBytes } = await import('~/workers/knowledge-extract')

    return await extractKnowledgeBytes({
      name: request.name,
      bytes: request.bytes,
    })
  }

  function executeRequest(
    request: KnowledgeWorkerRequest,
  ): Promise<KnowledgeWorkerResult> {
    const activeWorker = getWorker()

    if (!activeWorker) {
      return runOnMainThread(request)
    }

    return runInWorker(activeWorker, request)
  }

  function runWithGuards(
    request: KnowledgeWorkerRequest,
    signal: AbortSignal,
  ): Promise<KnowledgeWorkerResult> {
    return new Promise((resolve, reject) => {
      let isSettled = false
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      function settle(finish: () => void): void {
        if (isSettled) {
          return
        }

        isSettled = true
        signal.removeEventListener('abort', handleAbort)

        if (timeoutId !== null) {
          clearTimeout(timeoutId)
        }

        finish()
      }

      function handleAbort(): void {
        settle(() => {
          terminateWorker()
          reject(createAbortError())
        })
      }

      function handleTimeout(): void {
        settle(() => {
          terminateWorker()
          resolve(createFailedWorkerResult('timeout'))
        })
      }

      signal.addEventListener('abort', handleAbort, { once: true })
      timeoutId = setTimeout(handleTimeout, KNOWLEDGE_EXTRACTION_TIMEOUT_MS)

      executeRequest(request).then(
        result => settle(() => resolve(result)),
        () => settle(() => resolve(createFailedWorkerResult('extract-failed'))),
      )
    })
  }

  async function extractQueuedFile(
    file: File,
    signals: Array<AbortSignal | undefined>,
  ): Promise<KnowledgeExtractionResult> {
    const controller = new AbortController()

    function abortExtraction(): void {
      controller.abort()
    }

    for (const signal of signals) {
      if (signal?.aborted) {
        abortExtraction()
      }

      signal?.addEventListener('abort', abortExtraction, { once: true })
    }

    try {
      if (controller.signal.aborted) {
        throw createAbortError()
      }

      if (file.size > KNOWLEDGE_LIMITS.maxOriginalFileBytes) {
        return toExtractionResult(file, createFailedWorkerResult('too-large'))
      }

      clearIdleTimer()

      const bytes = await file.arrayBuffer()

      if (controller.signal.aborted) {
        throw createAbortError()
      }

      nextRequestId += 1

      const workerResult = await runWithGuards(
        { id: nextRequestId, name: file.name, bytes },
        controller.signal,
      )
      const converted = await convertWorkerResultText(
        workerResult,
        controller.signal,
      )

      return toExtractionResult(file, enforceItemTextLimit(converted))
    } finally {
      for (const signal of signals) {
        signal?.removeEventListener('abort', abortExtraction)
      }
    }
  }

  function extractFile(
    file: File,
    options: KnowledgeExtractOptions = {},
  ): Promise<KnowledgeExtractionResult> {
    pendingCount += 1
    isBusy.value = true
    clearIdleTimer()

    const lifetimeSignal = lifetime.signal
    const extraction = queue.then(() => {
      return extractQueuedFile(file, [options.signal, lifetimeSignal])
    })

    queue = extraction.then(() => undefined, () => undefined)

    return extraction.finally(() => {
      pendingCount -= 1

      if (pendingCount > 0) {
        return
      }

      isBusy.value = false

      if (worker) {
        scheduleIdleTermination()
      }
    })
  }

  function dispose(): void {
    lifetime.abort()
    lifetime = new AbortController()
    terminateWorker()
  }

  if (getCurrentScope()) {
    onScopeDispose(dispose)
  }

  return { extractFile, isBusy, dispose }
}

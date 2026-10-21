import type {
  DiagramFontDescriptor,
  DiagramRenderOptions,
  DiagramRenderResult,
  DiagramWorkerRequest,
  DiagramWorkerResponse,
} from '~/types/diagram.d'

interface RenderRequest {
  id: number
  source: string
  maxWidth: number | undefined
  cacheKey: string
  phase: 'preparing' | 'rendering'
  resolve: (result: DiagramRenderResult) => void
  timeoutId: ReturnType<typeof setTimeout> | null
}

const RENDER_CACHE_LIMIT: number = 50
const TIMED_OUT_LIMIT: number = 50
const WAITING_REQUESTS_LIMIT: number = 20
const RENDER_TIMEOUT_MS: number = 3000
const PREPARE_TIMEOUT_MS: number = 15000
const DEFAULT_ID_PREFIX: string = 'pele'
const TIMEOUT_MESSAGE: string = 'Diagram took too long to render'
const PREPARE_TIMEOUT_MESSAGE: string = 'Diagram renderer took too long to start'
const WORKER_FAILURE_MESSAGE: string = 'Diagram renderer failed'
const QUEUE_FULL_MESSAGE: string = 'Too many diagrams queued'

const renderCache = new Map<string, string>()
const inFlightRenders = new Map<string, Promise<DiagramRenderResult>>()
const timedOutKeys = new Set<string>()
const waitingRequests: RenderRequest[] = []

let diagramWorker: Worker | null = null
let activeRequest: RenderRequest | null = null
let nextRequestId: number = 0
let fontDescriptors: DiagramFontDescriptor[] = []
let fontSheetCount: number = -1

function createDiagramWorker(): Worker | null {
  if (!import.meta.client || typeof Worker === 'undefined') {
    return null
  }

  try {
    return new Worker(
      new URL('../workers/diagram.worker.ts', import.meta.url),
      { type: 'module' },
    )
  } catch {
    return null
  }
}

function getFontDescriptors(): DiagramFontDescriptor[] {
  const sheetCount = document.styleSheets.length

  if (sheetCount !== fontSheetCount) {
    fontDescriptors = collectDiagramFontDescriptors(
      document.styleSheets,
      location.href,
    )
    fontSheetCount = sheetCount
  }

  return fontDescriptors
}

function discardWorker(worker: Worker): void {
  worker.onmessage = null
  worker.onerror = null
  worker.onmessageerror = null
  worker.terminate()

  if (diagramWorker === worker) {
    diagramWorker = null
  }
}

function rememberTimeout(cacheKey: string): void {
  if (timedOutKeys.size >= TIMED_OUT_LIMIT) {
    const oldestKey = timedOutKeys.values().next().value

    if (oldestKey !== undefined) {
      timedOutKeys.delete(oldestKey)
    }
  }

  timedOutKeys.add(cacheKey)
}

function finishRequest(
  request: RenderRequest,
  result: DiagramRenderResult,
): void {
  if (activeRequest !== request) {
    return
  }

  if (request.timeoutId !== null) {
    clearTimeout(request.timeoutId)
  }

  activeRequest = null

  request.resolve(result)
  startNextRequest()
}

function failActiveRequest(worker: Worker, message: string): void {
  discardWorker(worker)

  if (activeRequest) {
    finishRequest(activeRequest, { error: { message } })
  }
}

function startRenderTimer(worker: Worker, request: RenderRequest): void {
  if (request.timeoutId !== null) {
    clearTimeout(request.timeoutId)
  }

  request.phase = 'rendering'
  request.timeoutId = setTimeout(() => {
    rememberTimeout(request.cacheKey)
    failActiveRequest(worker, TIMEOUT_MESSAGE)
  }, RENDER_TIMEOUT_MS)
}

function handleWorkerMessage(
  worker: Worker,
  response: DiagramWorkerResponse,
): void {
  const request = activeRequest

  if (!request || request.id !== response?.id) {
    return
  }

  if ('status' in response) {
    if (response.status === 'ready' && request.phase === 'preparing') {
      startRenderTimer(worker, request)
    }

    return
  }

  if ('svg' in response && typeof response.svg === 'string') {
    finishRequest(request, { svg: response.svg })

    return
  }

  if ('error' in response && response.error) {
    finishRequest(request, { error: response.error })

    return
  }

  failActiveRequest(worker, WORKER_FAILURE_MESSAGE)
}

function ensureWorker(): Worker | null {
  if (diagramWorker) {
    return diagramWorker
  }

  const worker = createDiagramWorker()

  if (!worker) {
    return null
  }

  worker.onmessage = (event: MessageEvent<DiagramWorkerResponse>) => {
    handleWorkerMessage(worker, event.data)
  }
  worker.onerror = (event: ErrorEvent) => {
    event.preventDefault()
    failActiveRequest(worker, WORKER_FAILURE_MESSAGE)
  }
  worker.onmessageerror = () => {
    failActiveRequest(worker, WORKER_FAILURE_MESSAGE)
  }

  diagramWorker = worker

  return worker
}

async function renderInThread(request: RenderRequest): Promise<void> {
  try {
    const svg = await renderDiagramSvg(request.source, request.maxWidth)

    finishRequest(request, { svg })
  } catch (exception) {
    finishRequest(request, { error: toDiagramRenderError(exception) })
  }
}

function postToWorker(worker: Worker, request: RenderRequest): void {
  request.timeoutId = setTimeout(() => {
    failActiveRequest(worker, PREPARE_TIMEOUT_MESSAGE)
  }, PREPARE_TIMEOUT_MS)

  try {
    const message: DiagramWorkerRequest = {
      id: request.id,
      source: request.source,
      options: { maxWidth: request.maxWidth },
      fonts: getFontDescriptors(),
    }

    worker.postMessage(message)
  } catch {
    failActiveRequest(worker, WORKER_FAILURE_MESSAGE)
  }
}

function startNextRequest(): void {
  if (activeRequest) {
    return
  }

  const request = waitingRequests.shift()

  if (!request) {
    return
  }

  activeRequest = request

  const worker = ensureWorker()

  if (!worker) {
    renderInThread(request)

    return
  }

  postToWorker(worker, request)
}

function dropOldestWaitingRequests(): void {
  while (waitingRequests.length > WAITING_REQUESTS_LIMIT) {
    waitingRequests.shift()?.resolve({ error: { message: QUEUE_FULL_MESSAGE } })
  }
}

function enqueueRender(
  source: string,
  maxWidth: number | undefined,
  cacheKey: string,
): Promise<DiagramRenderResult> {
  return new Promise((resolve) => {
    waitingRequests.push({
      id: nextRequestId++,
      source,
      maxWidth,
      cacheKey,
      phase: 'preparing',
      resolve,
      timeoutId: null,
    })

    dropOldestWaitingRequests()
    startNextRequest()
  })
}

function getCacheKey(source: string, maxWidth: number | undefined): string {
  return `${source}\u0000${maxWidth ?? ''}`
}

function rememberSvg(cacheKey: string, svg: string): void {
  if (renderCache.size >= RENDER_CACHE_LIMIT) {
    const oldestKey = renderCache.keys().next().value

    if (oldestKey !== undefined) {
      renderCache.delete(oldestKey)
    }
  }

  renderCache.set(cacheKey, svg)
}

function applyIdPrefix(svg: string, idPrefix: string | undefined): string {
  return svg.replaceAll(
    DIAGRAM_CACHED_ID_PREFIX,
    idPrefix ?? DEFAULT_ID_PREFIX,
  )
}

async function renderOnce(
  source: string,
  maxWidth: number | undefined,
  cacheKey: string,
): Promise<DiagramRenderResult> {
  try {
    const result = await enqueueRender(source, maxWidth, cacheKey)

    if ('svg' in result) {
      rememberSvg(cacheKey, result.svg)
    }

    return result
  } catch (exception) {
    return { error: toDiagramRenderError(exception) }
  } finally {
    inFlightRenders.delete(cacheKey)
  }
}

function renderShared(
  source: string,
  maxWidth: number | undefined,
  cacheKey: string,
): Promise<DiagramRenderResult> {
  const pendingRender = inFlightRenders.get(cacheKey)

  if (pendingRender) {
    return pendingRender
  }

  const render = renderOnce(source, maxWidth, cacheKey)

  inFlightRenders.set(cacheKey, render)

  return render
}

async function renderDiagram(
  source: string,
  options: DiagramRenderOptions = {},
): Promise<DiagramRenderResult> {
  const maxWidth = toPositiveDiagramNumber(options.maxWidth)
  const cacheKey = getCacheKey(source, maxWidth)
  const cachedSvg = renderCache.get(cacheKey)

  if (cachedSvg !== undefined) {
    return { svg: applyIdPrefix(cachedSvg, options.idPrefix) }
  }

  if (timedOutKeys.has(cacheKey)) {
    return { error: { message: TIMEOUT_MESSAGE } }
  }

  const result = await renderShared(source, maxWidth, cacheKey)

  if ('error' in result) {
    return result
  }

  return { svg: applyIdPrefix(result.svg, options.idPrefix) }
}

export function useDiagramRenderer() {
  return { renderDiagram }
}

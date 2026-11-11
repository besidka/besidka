import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope } from 'vue'
import {
  DocumentRenderError,
  resetDocumentRenderWorker,
  useDocumentRender,
} from '~/composables/document-render'
import type {
  DocumentWorkerRequest,
  DocumentWorkerResponse,
} from '~/types/document-render.d'
import {
  DOCUMENT_WORKER_IDLE_MS,
  DOCUMENT_WORKER_TIMEOUT_MS,
} from '#shared/utils/documents'

class FakeWorker {
  static instances: FakeWorker[] = []

  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onmessageerror: (() => void) | null = null
  posted: Array<{ request: DocumentWorkerRequest, transfer: unknown[] }> = []
  terminate = vi.fn()

  constructor(
    public url: URL,
    public options: WorkerOptions,
  ) {
    FakeWorker.instances.push(this)
  }

  postMessage(request: DocumentWorkerRequest, transfer: unknown[]): void {
    this.posted.push({ request, transfer })
  }

  reply(index: number, response: Partial<DocumentWorkerResponse> = {}): void {
    const posted = this.posted[index]

    this.onmessage?.({
      data: {
        id: posted?.request.id,
        ok: true,
        bytes: new Uint8Array([1, 2, 3]).buffer,
        mediaType: 'application/pdf',
        stats: { pages: 1 },
        ...response,
      },
    })
  }
}

const SPEC = { specVersion: 1, format: 'pdf', title: 'Report', blocks: [] }

async function waitForPosts(worker: FakeWorker, count: number) {
  await vi.waitFor(() => expect(worker.posted).toHaveLength(count))
}

beforeEach(() => {
  FakeWorker.instances = []
  vi.stubGlobal('Worker', FakeWorker)
})

afterEach(() => {
  resetDocumentRenderWorker()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useDocumentRender worker protocol', () => {
  it('creates the module worker lazily and resolves with the bytes', async () => {
    const { render } = useDocumentRender()

    expect(FakeWorker.instances).toHaveLength(0)

    const rendering = render({ spec: SPEC })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const [worker] = FakeWorker.instances as [FakeWorker]

    expect(worker.options).toEqual({ type: 'module' })
    expect(worker.url.pathname).toContain('document-render')

    await waitForPosts(worker, 1)
    worker.reply(0)

    const output = await rendering

    expect(Array.from(output.bytes)).toEqual([1, 2, 3])
    expect(output.mediaType).toBe('application/pdf')
    expect(output.stats).toEqual({ pages: 1 })
  })

  it('sends the spec, the model id and transferable assets', async () => {
    const { render } = useDocumentRender()
    const assetBytes = new Uint8Array([9, 8, 7])
    const rendering = render({
      spec: SPEC,
      modelId: 'claude-haiku',
      assets: [{ id: 'img-1', bytes: assetBytes, mediaType: 'image/png' }],
    })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const [worker] = FakeWorker.instances as [FakeWorker]

    await waitForPosts(worker, 1)

    const [posted] = worker.posted as [FakeWorker['posted'][number]]

    expect(posted.request.spec).toEqual(SPEC)
    expect(posted.request.modelId).toBe('claude-haiku')
    expect(posted.request.assets).toHaveLength(1)
    expect(posted.request.assets[0]?.id).toBe('img-1')
    expect(posted.transfer).toEqual([posted.request.assets[0]?.bytes])
    expect(Array.from(assetBytes)).toEqual([9, 8, 7])

    worker.reply(0)
    await rendering
  })

  it('renders one document at a time through one shared worker', async () => {
    const first = useDocumentRender()
    const second = useDocumentRender()
    const firstRendering = first.render({ spec: SPEC })
    const secondRendering = second.render({ spec: SPEC })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const [worker] = FakeWorker.instances as [FakeWorker]

    await waitForPosts(worker, 1)
    await Promise.resolve()

    expect(worker.posted).toHaveLength(1)

    worker.reply(0)
    await firstRendering
    await waitForPosts(worker, 2)

    expect(FakeWorker.instances).toHaveLength(1)

    worker.reply(1)
    await secondRendering
  })

  it('ignores replies for a different request id', async () => {
    const { render } = useDocumentRender()
    const rendering = render({ spec: SPEC })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const [worker] = FakeWorker.instances as [FakeWorker]

    await waitForPosts(worker, 1)
    worker.reply(0, { id: 99_999 })

    const outcome = vi.fn()

    rendering.then(outcome, outcome)
    await Promise.resolve()

    expect(outcome).not.toHaveBeenCalled()

    worker.reply(0)
    await rendering
  })
})

describe('useDocumentRender failures', () => {
  it('maps a worker failure response to a typed error', async () => {
    const { render } = useDocumentRender()
    const rendering = render({ spec: SPEC })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const [worker] = FakeWorker.instances as [FakeWorker]

    await waitForPosts(worker, 1)
    worker.reply(0, {
      ok: false,
      code: 'validation_failed',
      detail: 'zip_ratio',
    } as Partial<DocumentWorkerResponse>)

    const error = await rendering.catch((exception: unknown) => exception)

    expect(error).toBeInstanceOf(DocumentRenderError)
    expect(error).toMatchObject({
      code: 'validation_failed',
      detail: 'zip_ratio',
    })
    expect(worker.terminate).not.toHaveBeenCalled()
  })

  it('rejects with worker_error and drops the worker on a crash', async () => {
    const { render } = useDocumentRender()
    const rendering = render({ spec: SPEC })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const [worker] = FakeWorker.instances as [FakeWorker]

    await waitForPosts(worker, 1)
    worker.onerror?.()

    await expect(rendering).rejects.toMatchObject({ code: 'worker_error' })
    expect(worker.terminate).toHaveBeenCalledTimes(1)

    const next = useDocumentRender().render({ spec: SPEC })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(2))

    const nextWorker = FakeWorker.instances[1] as FakeWorker

    await waitForPosts(nextWorker, 1)
    nextWorker.reply(0)
    await next
  })

  it('rejects with worker_error when the Worker API is missing', async () => {
    vi.stubGlobal('Worker', undefined)

    await expect(useDocumentRender().render({ spec: SPEC })).rejects
      .toMatchObject({ code: 'worker_error' })
  })

  it('terminates the worker and rejects with timeout', async () => {
    vi.useFakeTimers()

    const { render } = useDocumentRender()
    const rendering = render({ spec: SPEC })
    const outcome = rendering.catch((exception: unknown) => exception)

    await vi.advanceTimersByTimeAsync(0)

    const [worker] = FakeWorker.instances as [FakeWorker]

    expect(worker.posted).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(DOCUMENT_WORKER_TIMEOUT_MS)

    expect(await outcome).toMatchObject({ code: 'timeout' })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('starts a fresh worker for a queued render after a timeout', async () => {
    vi.useFakeTimers()

    const { render } = useDocumentRender()
    const first = render({ spec: SPEC })
      .catch((exception: unknown) => exception)
    const second = render({ spec: SPEC })

    await vi.advanceTimersByTimeAsync(DOCUMENT_WORKER_TIMEOUT_MS)

    expect(await first).toMatchObject({ code: 'timeout' })
    expect(FakeWorker.instances).toHaveLength(2)

    const nextWorker = FakeWorker.instances[1] as FakeWorker

    expect(nextWorker.posted).toHaveLength(1)
    nextWorker.reply(0)
    await second
  })
})

describe('useDocumentRender idle termination', () => {
  it('terminates the idle worker after the idle delay', async () => {
    vi.useFakeTimers()

    const { render } = useDocumentRender()
    const rendering = render({ spec: SPEC })

    await vi.advanceTimersByTimeAsync(0)

    const [worker] = FakeWorker.instances as [FakeWorker]

    worker.reply(0)
    await rendering
    await vi.advanceTimersByTimeAsync(DOCUMENT_WORKER_IDLE_MS - 1)

    expect(worker.terminate).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('keeps the worker alive while a render is queued', async () => {
    vi.useFakeTimers()

    const { render } = useDocumentRender()
    const first = render({ spec: SPEC })

    await vi.advanceTimersByTimeAsync(0)

    const [worker] = FakeWorker.instances as [FakeWorker]

    worker.reply(0)
    await first
    await vi.advanceTimersByTimeAsync(DOCUMENT_WORKER_IDLE_MS - 1000)

    const second = render({ spec: SPEC })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2000)

    expect(worker.terminate).not.toHaveBeenCalled()

    worker.reply(1)
    await second
  })

  it('terminates an idle worker when the owning scope is disposed', async () => {
    const scope = effectScope()
    const { render } = scope.run(() => useDocumentRender())!
    const rendering = render({ spec: SPEC })

    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1))

    const [worker] = FakeWorker.instances as [FakeWorker]

    await waitForPosts(worker, 1)
    worker.reply(0)
    await rendering
    scope.stop()

    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
})

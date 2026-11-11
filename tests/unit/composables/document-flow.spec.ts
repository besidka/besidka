import { effectScope, shallowRef } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getDocumentErrorMessage,
  getDocumentFileUrls,
  useDocumentFlow,
} from '~/composables/document-flow'
import { DocumentRenderError } from '~/composables/document-render'
import type {
  DocumentFileRef,
  DocumentStatus,
  DocumentStatusResponse,
} from '#shared/utils/documents'
import {
  DOCUMENT_POLL_INTERVAL_MS,
  DOCUMENT_POLL_TIMEOUT_MS,
} from '#shared/utils/documents'

interface FetchInit {
  method?: string
  body?: unknown
  headers?: Record<string, string>
}

const { fetchMock, renderMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  renderMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)

mockNuxtImport('useDocumentRender', () => {
  return () => ({ render: renderMock, dispose: vi.fn() })
})

const FILE: DocumentFileRef = {
  id: 'file_1',
  storageKey: 'user/abc/report.pdf',
  name: 'Report.pdf',
  size: 1234,
  type: 'application/pdf',
}

const SPEC = { specVersion: 1, format: 'pdf', title: 'Report', blocks: [] }
const SPEC_WITH_IMAGE = {
  specVersion: 1,
  format: 'pdf',
  title: 'Report',
  blocks: [{ type: 'image', fileId: 'file_9', alt: 'Chart' }],
}
const STUCK_MESSAGE = 'Building this document is taking longer than expected.'
const RENDERED_BYTES = new Uint8Array([37, 80, 68, 70])

let documentCounter = 0

function nextDocumentId(): string {
  documentCounter += 1

  return `doc_${documentCounter}`
}

function statusResponse(
  id: string,
  status: DocumentStatus,
  overrides: Partial<DocumentStatusResponse> = {},
): DocumentStatusResponse {
  return {
    id,
    format: 'pdf',
    title: 'Report',
    status,
    file: status === 'ready' ? FILE : null,
    renderedBy: status === 'ready' ? 'client' : null,
    errorCode: null,
    stats: null,
    ...overrides,
  }
}

function httpError(statusCode: number, message: string = 'Failed') {
  return { statusCode, data: { message } }
}

function callsTo(method: string, path: string): unknown[][] {
  return fetchMock.mock.calls.filter((call) => {
    const init = call[1] as FetchInit | undefined

    return call[0] === path && (init?.method ?? 'GET') === method
  })
}

function mockRoutes(
  id: string,
  routes: {
    statuses: Array<DocumentStatusResponse | Error | object>
    spec?: () => unknown
    file?: () => unknown
    render?: () => unknown
  },
) {
  const statusQueue = [...routes.statuses]

  fetchMock.mockImplementation(async (path: string, init?: FetchInit) => {
    const method = init?.method ?? 'GET'

    if (path === `/api/v1/documents/${id}` && method === 'GET') {
      const next = statusQueue.length > 1
        ? statusQueue.shift()
        : statusQueue[0]

      if (next instanceof Error || (next && 'statusCode' in next)) {
        throw next
      }

      return next
    }

    if (path === `/api/v1/documents/${id}/spec`) {
      return routes.spec ? routes.spec() : SPEC
    }

    if (path === `/api/v1/documents/${id}/file` && method === 'POST') {
      return routes.file ? routes.file() : {}
    }

    if (path === `/api/v1/documents/${id}/render` && method === 'POST') {
      return routes.render ? routes.render() : {}
    }

    throw new Error(`Unexpected request ${method} ${path}`)
  })

  return statusQueue
}

function runFlow(id: string | null, isStreaming: boolean = false) {
  const streaming = shallowRef<boolean>(isStreaming)
  const scope = effectScope()
  const flow = scope.run(() => {
    return useDocumentFlow(id, {
      isStreaming: streaming,
      modelId: 'claude-haiku',
    })
  })!

  return { flow, scope, streaming }
}

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(0)
  await vi.advanceTimersByTimeAsync(0)
}

const activeScopes: Array<{ stop: () => void }> = []

function start(id: string | null, isStreaming: boolean = false) {
  const result = runFlow(id, isStreaming)

  activeScopes.push(result.scope)

  return result
}

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  renderMock.mockReset()
  renderMock.mockResolvedValue({
    bytes: RENDERED_BYTES,
    mediaType: 'application/pdf',
    stats: { pages: 1 },
  })
})

afterEach(() => {
  for (const scope of activeScopes.splice(0)) {
    scope.stop()
  }

  vi.useRealTimers()
})

describe('useDocumentFlow client render', () => {
  it('renders in the browser, uploads the bytes and exposes the file', async () => {
    const id = nextDocumentId()

    mockRoutes(id, {
      statuses: [statusResponse(id, 'spec_ready'), statusResponse(id, 'ready')],
    })

    const { flow } = start(id)

    await settle()

    expect(flow.status.value).toBe('ready')
    expect(flow.document.value?.file).toEqual(FILE)
    expect(flow.fileUrls.value).toEqual({
      downloadUrl: '/files/user/abc/report.pdf?download=1',
      viewUrl: '/files/user/abc/report.pdf',
    })
    expect(flow.isBusy.value).toBe(false)
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(renderMock).toHaveBeenCalledWith({
      spec: SPEC,
      modelId: 'claude-haiku',
    })

    const [fileCall] = callsTo('POST', `/api/v1/documents/${id}/file`)
    const init = fileCall![1] as FetchInit

    expect(init.body).toBe(RENDERED_BYTES)
    expect(init.headers).toEqual({
      'Content-Type': 'application/octet-stream',
      'x-document-format': 'pdf',
    })
    expect(callsTo('POST', `/api/v1/documents/${id}/render`)).toHaveLength(0)
  })

  it('unwraps a spec delivered under a spec key', async () => {
    const id = nextDocumentId()

    mockRoutes(id, {
      statuses: [statusResponse(id, 'spec_ready'), statusResponse(id, 'ready')],
      spec: () => ({ specVersion: 1, spec: SPEC }),
    })
    start(id)
    await settle()

    expect(renderMock).toHaveBeenCalledWith(
      expect.objectContaining({ spec: SPEC }),
    )
  })

  it('only exposes the file when the document is already ready', async () => {
    const id = nextDocumentId()

    mockRoutes(id, { statuses: [statusResponse(id, 'ready')] })

    const { flow } = start(id)

    await settle()

    expect(flow.status.value).toBe('ready')
    expect(flow.document.value?.file).toEqual(FILE)
    expect(renderMock).not.toHaveBeenCalled()
    expect(callsTo('GET', `/api/v1/documents/${id}/spec`)).toHaveLength(0)
  })

  it('does not render while the message is still streaming', async () => {
    const id = nextDocumentId()

    mockRoutes(id, {
      statuses: [
        statusResponse(id, 'spec_ready'),
        statusResponse(id, 'spec_ready'),
        statusResponse(id, 'ready'),
      ],
    })

    const { flow, streaming } = start(id, true)

    await settle()

    expect(flow.status.value).toBe('spec_ready')
    expect(renderMock).not.toHaveBeenCalled()

    streaming.value = false
    await settle()

    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(flow.status.value).toBe('ready')
  })

  it('does not auto-render a failed document, retry renders it', async () => {
    const id = nextDocumentId()

    mockRoutes(id, {
      statuses: [
        statusResponse(id, 'failed', { errorCode: 'render_failed' }),
        statusResponse(id, 'failed', { errorCode: 'render_failed' }),
        statusResponse(id, 'ready'),
      ],
    })

    const { flow } = start(id)

    await settle()

    expect(flow.status.value).toBe('failed')
    expect(flow.errorMessage.value).toBe(getDocumentErrorMessage(null))
    expect(renderMock).not.toHaveBeenCalled()

    await flow.retry()
    await settle()

    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(flow.status.value).toBe('ready')
    expect(flow.errorMessage.value).toBe('')
  })

  it('does not retry while the message is streaming', async () => {
    const id = nextDocumentId()

    mockRoutes(id, {
      statuses: [statusResponse(id, 'failed', { errorCode: 'render_failed' })],
    })

    const { flow } = start(id, true)

    await settle()
    fetchMock.mockClear()
    await flow.retry()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useDocumentFlow fallbacks', () => {
  it('polls instead of falling back when another renderer holds the lease', async () => {
    const id = nextDocumentId()

    mockRoutes(id, {
      statuses: [
        statusResponse(id, 'spec_ready'),
        statusResponse(id, 'rendering'),
        statusResponse(id, 'rendering'),
        statusResponse(id, 'ready'),
      ],
      file: () => {
        throw httpError(409, 'Rendering')
      },
    })

    const { flow } = start(id)

    await settle()

    expect(flow.status.value).toBe('rendering')
    expect(callsTo('POST', `/api/v1/documents/${id}/render`)).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_INTERVAL_MS)

    expect(flow.status.value).toBe('rendering')

    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_INTERVAL_MS)

    expect(flow.status.value).toBe('ready')
    expect(flow.isBusy.value).toBe(false)
    expect(callsTo('POST', `/api/v1/documents/${id}/render`)).toHaveLength(0)
  })

  it('asks the server to render exactly once after a worker failure', async () => {
    const id = nextDocumentId()

    renderMock.mockRejectedValue(new DocumentRenderError('timeout'))
    mockRoutes(id, {
      statuses: [
        statusResponse(id, 'spec_ready'),
        statusResponse(id, 'rendering'),
        statusResponse(id, 'ready', { renderedBy: 'worker' }),
      ],
    })

    const { flow } = start(id)

    await settle()

    expect(callsTo('POST', `/api/v1/documents/${id}/render`)).toHaveLength(1)
    expect(callsTo('POST', `/api/v1/documents/${id}/file`)).toHaveLength(0)
    expect(flow.status.value).toBe('rendering')

    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_INTERVAL_MS)

    expect(flow.status.value).toBe('ready')
    expect(callsTo('POST', `/api/v1/documents/${id}/render`)).toHaveLength(1)
  })

  it.each([422, 503, 500])(
    'asks the server to render once when the upload fails with %i',
    async (statusCode) => {
      const id = nextDocumentId()

      mockRoutes(id, {
        statuses: [
          statusResponse(id, 'spec_ready'),
          statusResponse(id, 'ready', { renderedBy: 'worker' }),
        ],
        file: () => {
          throw httpError(statusCode)
        },
      })

      const { flow } = start(id)

      await settle()

      expect(callsTo('POST', `/api/v1/documents/${id}/render`))
        .toHaveLength(1)
      expect(flow.status.value).toBe('ready')
    },
  )

  it('skips the client render and asks the server when the spec has images', async () => {
    const id = nextDocumentId()

    mockRoutes(id, {
      statuses: [
        statusResponse(id, 'spec_ready'),
        statusResponse(id, 'ready', { renderedBy: 'worker' }),
      ],
      spec: () => SPEC_WITH_IMAGE,
    })

    const { flow } = start(id)

    await settle()

    expect(renderMock).not.toHaveBeenCalled()
    expect(callsTo('POST', `/api/v1/documents/${id}/file`)).toHaveLength(0)
    expect(callsTo('POST', `/api/v1/documents/${id}/render`)).toHaveLength(1)
    expect(flow.status.value).toBe('ready')
  })

  it.each([507, 429, 413])(
    'shows the error without a server fallback when the upload fails with %i',
    async (statusCode) => {
      const id = nextDocumentId()
      let shouldFail = true

      mockRoutes(id, {
        statuses: [
          statusResponse(id, 'spec_ready'),
          statusResponse(id, 'spec_ready'),
          statusResponse(id, 'ready'),
        ],
        file: () => {
          if (shouldFail) {
            throw httpError(statusCode, 'Upload refused')
          }

          return {}
        },
      })

      const { flow } = start(id)

      await settle()

      expect(callsTo('POST', `/api/v1/documents/${id}/render`))
        .toHaveLength(0)
      expect(flow.status.value).toBe('failed')
      expect(flow.errorMessage.value).toBe('Upload refused')
      expect(flow.isBusy.value).toBe(false)

      shouldFail = false
      await flow.retry()
      await settle()

      expect(callsTo('POST', `/api/v1/documents/${id}/render`))
        .toHaveLength(0)
      expect(renderMock).toHaveBeenCalledTimes(2)
      expect(flow.status.value).toBe('ready')
      expect(flow.errorMessage.value).toBe('')
    },
  )

  it('asks the server to render when the spec cannot be fetched', async () => {
    const id = nextDocumentId()

    mockRoutes(id, {
      statuses: [
        statusResponse(id, 'spec_ready'),
        statusResponse(id, 'failed', { errorCode: 'spec_missing' }),
      ],
      spec: () => {
        throw httpError(404)
      },
    })

    const { flow } = start(id)

    await settle()

    expect(renderMock).not.toHaveBeenCalled()
    expect(callsTo('POST', `/api/v1/documents/${id}/render`)).toHaveLength(1)
    expect(flow.status.value).toBe('failed')
  })

  it('reports a failed server render without asking twice', async () => {
    const id = nextDocumentId()

    renderMock.mockRejectedValue(new DocumentRenderError('worker_error'))
    mockRoutes(id, {
      statuses: [statusResponse(id, 'spec_ready')],
      render: () => {
        throw httpError(503, 'Document rendering is unavailable')
      },
    })

    const { flow } = start(id)

    await settle()

    expect(callsTo('POST', `/api/v1/documents/${id}/render`)).toHaveLength(1)
    expect(flow.status.value).toBe('failed')
    expect(flow.errorMessage.value).toBe('Document rendering is unavailable')
    expect(flow.isBusy.value).toBe(false)
  })
})

describe('useDocumentFlow polling', () => {
  it('resumes polling when the document is already rendering', async () => {
    const id = nextDocumentId()

    mockRoutes(id, {
      statuses: [
        statusResponse(id, 'rendering'),
        statusResponse(id, 'rendering'),
        statusResponse(id, 'ready'),
      ],
    })

    const { flow } = start(id)

    await settle()

    expect(flow.status.value).toBe('rendering')
    expect(renderMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_INTERVAL_MS * 2)

    expect(flow.status.value).toBe('ready')
  })

  it('makes one more client attempt after a poll timeout, then offers a retry', async () => {
    const id = nextDocumentId()

    mockRoutes(id, { statuses: [statusResponse(id, 'rendering')] })

    const { flow } = start(id)

    await settle()
    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_TIMEOUT_MS)

    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(flow.status.value).toBe('rendering')

    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_TIMEOUT_MS)

    expect(flow.hasTimedOut.value).toBe(true)
    expect(flow.status.value).toBe('failed')
    expect(flow.errorMessage.value).toBe(STUCK_MESSAGE)
    expect(flow.isBusy.value).toBe(false)
    expect(renderMock).toHaveBeenCalledTimes(1)

    const statusCalls = callsTo('GET', `/api/v1/documents/${id}`).length

    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_INTERVAL_MS * 5)

    expect(callsTo('GET', `/api/v1/documents/${id}`)).toHaveLength(statusCalls)
  })

  it('retries after a timeout and clears the timed-out flag', async () => {
    const id = nextDocumentId()
    const statusQueue = mockRoutes(id, {
      statuses: [statusResponse(id, 'rendering')],
    })
    const { flow } = start(id)

    await settle()
    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_TIMEOUT_MS * 2)

    expect(flow.hasTimedOut.value).toBe(true)
    expect(flow.status.value).toBe('failed')

    statusQueue.splice(
      0,
      statusQueue.length,
      statusResponse(id, 'rendering'),
      statusResponse(id, 'ready'),
    )
    await flow.retry()
    await settle()

    expect(flow.hasTimedOut.value).toBe(false)
    expect(flow.status.value).toBe('ready')
    expect(flow.errorMessage.value).toBe('')
    expect(renderMock).toHaveBeenCalledTimes(2)
  })

  it('makes one client attempt when the peer lease expired during polling', async () => {
    const id = nextDocumentId()

    mockRoutes(id, {
      statuses: [
        statusResponse(id, 'rendering'),
        statusResponse(id, 'spec_ready'),
        statusResponse(id, 'ready'),
      ],
    })

    const { flow } = start(id)

    await settle()

    expect(flow.status.value).toBe('rendering')

    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_INTERVAL_MS)
    await settle()

    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(callsTo('POST', `/api/v1/documents/${id}/file`)).toHaveLength(1)
    expect(flow.status.value).toBe('ready')
  })

  it('shows the retryable state when polling again ends on spec_ready', async () => {
    const id = nextDocumentId()

    mockRoutes(id, {
      statuses: [
        statusResponse(id, 'spec_ready'),
        statusResponse(id, 'rendering'),
        statusResponse(id, 'spec_ready'),
      ],
      file: () => {
        throw httpError(409, 'Rendering')
      },
    })

    const { flow } = start(id)

    await settle()

    expect(flow.status.value).toBe('rendering')

    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_INTERVAL_MS)
    await settle()

    expect(flow.status.value).toBe('failed')
    expect(flow.errorMessage.value).toBe(STUCK_MESSAGE)
    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(flow.isBusy.value).toBe(false)
  })

  it('stops polling when the owning scope is disposed', async () => {
    const id = nextDocumentId()

    mockRoutes(id, { statuses: [statusResponse(id, 'rendering')] })

    const { flow, scope } = start(id)

    await settle()
    scope.stop()
    fetchMock.mockClear()
    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_INTERVAL_MS * 10)

    expect(fetchMock).not.toHaveBeenCalled()
    expect(flow.status.value).toBe('rendering')
  })
})

describe('useDocumentFlow unavailable documents', () => {
  it.each([404, 403])('is unavailable on %i', async (statusCode) => {
    const id = nextDocumentId()

    mockRoutes(id, { statuses: [httpError(statusCode, 'Not found')] })

    const { flow } = start(id)

    await settle()

    expect(flow.status.value).toBe('unavailable')
    expect(flow.document.value).toBeNull()
    expect(renderMock).not.toHaveBeenCalled()
  })

  it('is unavailable without a document id', async () => {
    const { flow } = start(null)

    await settle()

    expect(flow.status.value).toBe('unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useDocumentFlow across cards', () => {
  it('renders a document once when two cards show it', async () => {
    const id = nextDocumentId()
    let releaseRender: (value: unknown) => void = () => {}

    renderMock.mockImplementation(() => {
      return new Promise((resolve) => {
        releaseRender = resolve
      })
    })
    mockRoutes(id, {
      statuses: [
        statusResponse(id, 'spec_ready'),
        statusResponse(id, 'spec_ready'),
        statusResponse(id, 'ready'),
      ],
    })

    const first = start(id)
    const second = start(id)

    await settle()

    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(second.flow.status.value).toBe('rendering')

    releaseRender({
      bytes: RENDERED_BYTES,
      mediaType: 'application/pdf',
      stats: {},
    })
    await settle()
    await vi.advanceTimersByTimeAsync(DOCUMENT_POLL_INTERVAL_MS)

    expect(renderMock).toHaveBeenCalledTimes(1)
    expect(callsTo('POST', `/api/v1/documents/${id}/file`)).toHaveLength(1)
    expect(callsTo('POST', `/api/v1/documents/${id}/render`)).toHaveLength(0)
    expect(first.flow.status.value).toBe('ready')
    expect(second.flow.status.value).toBe('ready')
  })
})

describe('document file helpers', () => {
  it('builds the download and view urls from the storage key', () => {
    expect(getDocumentFileUrls(FILE)).toEqual({
      downloadUrl: '/files/user/abc/report.pdf?download=1',
      viewUrl: '/files/user/abc/report.pdf',
    })
  })

  it('maps known error codes to messages with a generic fallback', () => {
    expect(getDocumentErrorMessage('file_deleted')).toBe(
      'The document file was deleted.',
    )
    expect(getDocumentErrorMessage('spec_missing')).toBe(
      'The content of this document is no longer available.',
    )
    expect(getDocumentErrorMessage('spec_expired')).toBe(
      'The content of this document has expired.',
    )
    expect(getDocumentErrorMessage('unknown')).toBe(
      'The document could not be created.',
    )
  })
})

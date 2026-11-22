import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentWorkerResponse } from '~/types/document-render.d'
import { loadReferenceSpec } from '~~/tests/setup/helpers/documents'

const ORIGIN = 'https://besidka.test'
const FONT_DIRECTORY = resolve(
  import.meta.dirname,
  '../../../packages/doc-renderer/fonts',
)

const DOCX_SPEC = {
  specVersion: 1,
  format: 'docx',
  title: 'Plan',
  blocks: [
    { type: 'heading', level: 1, text: 'Plan' },
    { type: 'paragraph', runs: [{ text: 'Ship the document tool.' }] },
  ],
}

const PDF_SPEC = {
  specVersion: 1,
  format: 'pdf',
  title: 'Plan',
  pageSize: 'A4',
  blocks: [
    { type: 'heading', level: 1, text: 'Plan' },
    { type: 'paragraph', runs: [{ text: 'Ship the document tool.' }] },
  ],
}

const fetchMock = vi.fn()

async function importWorker() {
  vi.resetModules()

  return await import('~/workers/document-render')
}

function expectSuccess(
  response: DocumentWorkerResponse,
): Extract<DocumentWorkerResponse, { ok: true }> {
  expect(response.ok).toBe(true)

  return response as Extract<DocumentWorkerResponse, { ok: true }>
}

function fontResponse(requestedUrl: string): Response {
  const fileName = requestedUrl.split('/').pop()!.split('?')[0]!
  const bytes = readFileSync(resolve(FONT_DIRECTORY, fileName))

  return new Response(bytes)
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('location', { origin: ORIGIN })
})

afterEach(() => {
  vi.doUnmock('@besidka/doc-renderer/render')
  vi.doUnmock('@besidka/doc-renderer/validate')
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('handleDocumentWorkerRequest rendering', () => {
  it('renders a DOCX with AI provenance without any network call', async () => {
    const { handleDocumentWorkerRequest } = await importWorker()
    const response = expectSuccess(await handleDocumentWorkerRequest({
      id: 7,
      spec: DOCX_SPEC,
      assets: [],
      modelId: 'claude-haiku',
    }))

    expect(response.id).toBe(7)
    expect(response.mediaType).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
    expect(response.bytes).toBeInstanceOf(ArrayBuffer)
    expect(response.bytes.byteLength).toBeGreaterThan(500)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('renders the XLSX reference workbook against its own spec', async () => {
    const { handleDocumentWorkerRequest } = await importWorker()
    const response = expectSuccess(await handleDocumentWorkerRequest({
      id: 1,
      spec: loadReferenceSpec('workbook'),
      assets: [],
    }))

    expect(response.stats.sheets).toBeGreaterThan(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes the model id and chat provenance to the renderer', async () => {
    const renderSpy = vi.fn()

    vi.doMock('@besidka/doc-renderer/render', async (importOriginal) => {
      const original = await importOriginal<
        typeof import('@besidka/doc-renderer/render')
      >()

      renderSpy.mockImplementation(original.render)

      return { ...original, render: renderSpy }
    })

    const { handleDocumentWorkerRequest } = await importWorker()

    expectSuccess(await handleDocumentWorkerRequest({
      id: 1,
      spec: DOCX_SPEC,
      assets: [],
      modelId: 'claude-haiku',
    }))
    expectSuccess(await handleDocumentWorkerRequest({
      id: 2,
      spec: DOCX_SPEC,
      assets: [],
    }))

    expect(renderSpy.mock.calls[0]?.[2]).toMatchObject({
      provenance: {
        createdVia: 'chat',
        aiGenerated: true,
        model: 'claude-haiku',
      },
    })
    expect(renderSpy.mock.calls[1]?.[2].provenance).toEqual({
      createdVia: 'chat',
      aiGenerated: true,
    })
  })
})

describe('handleDocumentWorkerRequest PDF fonts', () => {
  it('fetches the three same-origin fonts once and renders a PDF', async () => {
    fetchMock.mockImplementation(async (url: string) => fontResponse(url))

    const { handleDocumentWorkerRequest } = await importWorker()
    const first = expectSuccess(await handleDocumentWorkerRequest({
      id: 1,
      spec: PDF_SPEC,
      assets: [],
    }))

    expect(first.mediaType).toBe('application/pdf')
    expect(fetchMock).toHaveBeenCalledTimes(3)

    for (const call of fetchMock.mock.calls) {
      expect(new URL(call[0] as string).origin).toBe(ORIGIN)
      expect(call[1]).toEqual({ credentials: 'same-origin' })
    }

    expect(fetchMock.mock.calls.map(call => call[0]).join(' '))
      .toMatch(/Regular.*Bold.*Italic/)

    expectSuccess(await handleDocumentWorkerRequest({
      id: 2,
      spec: PDF_SPEC,
      assets: [],
    }))

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('reports font_unavailable and retries the fetch on the next request', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }))

    const { handleDocumentWorkerRequest } = await importWorker()
    const failure = await handleDocumentWorkerRequest({
      id: 1,
      spec: PDF_SPEC,
      assets: [],
    })

    expect(failure).toEqual({
      id: 1,
      ok: false,
      code: 'font_unavailable',
      detail: 'font-fetch-failed',
    })

    fetchMock.mockReset()
    fetchMock.mockImplementation(async (url: string) => fontResponse(url))

    expectSuccess(await handleDocumentWorkerRequest({
      id: 2,
      spec: PDF_SPEC,
      assets: [],
    }))
  })

  it('does not load fonts for non-PDF formats', async () => {
    const { handleDocumentWorkerRequest } = await importWorker()

    expectSuccess(await handleDocumentWorkerRequest({
      id: 1,
      spec: DOCX_SPEC,
      assets: [],
    }))

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('handleDocumentWorkerRequest failures', () => {
  it('rejects an invalid spec without leaking issue text', async () => {
    const { handleDocumentWorkerRequest } = await importWorker()

    expect(await handleDocumentWorkerRequest({
      id: 3,
      spec: { format: 'docx', specVersion: 1, title: 'x', blocks: [] },
      assets: [],
    })).toEqual({
      id: 3,
      ok: false,
      code: 'spec_invalid',
      detail: 'spec-invalid',
    })
  })

  it('rejects an asset with an unsupported media type', async () => {
    const { handleDocumentWorkerRequest } = await importWorker()
    const response = await handleDocumentWorkerRequest({
      id: 4,
      spec: DOCX_SPEC,
      assets: [{
        id: 'a',
        bytes: new Uint8Array([1]).buffer,
        mediaType: 'image/gif',
      }],
    })

    expect(response).toMatchObject({ ok: false, code: 'asset_invalid' })
  })

  it('maps a missing image asset to asset_invalid', async () => {
    const { handleDocumentWorkerRequest } = await importWorker()
    const response = await handleDocumentWorkerRequest({
      id: 5,
      spec: {
        ...DOCX_SPEC,
        blocks: [
          { type: 'image', fileId: 'missing', alt: 'Chart', widthPercent: 50 },
        ],
      },
      assets: [],
    })

    expect(response).toMatchObject({
      ok: false,
      code: 'asset_invalid',
      detail: 'missing_asset',
    })
  })

  it('reports validation failures by their stable code', async () => {
    vi.doMock('@besidka/doc-renderer/validate', async (importOriginal) => {
      const original = await importOriginal<
        typeof import('@besidka/doc-renderer/validate')
      >()

      let callCount = 0

      return {
        ...original,
        validate: (...input: Parameters<typeof original.validate>) => {
          callCount += 1

          return callCount === 1
            ? original.validate(...input)
            : { ok: false, code: 'zip_ratio', detail: 'secret' }
        },
      }
    })

    const { handleDocumentWorkerRequest } = await importWorker()

    expect(await handleDocumentWorkerRequest({
      id: 6,
      spec: DOCX_SPEC,
      assets: [],
    })).toEqual({
      id: 6,
      ok: false,
      code: 'validation_failed',
      detail: 'zip_ratio',
    })
  })

  it('requires the AI provenance mark in the rendered bytes', async () => {
    vi.doMock('@besidka/doc-renderer/validate', async (importOriginal) => {
      const original = await importOriginal<
        typeof import('@besidka/doc-renderer/validate')
      >()

      return {
        ...original,
        validate: () => ({ ok: true, stats: { bytes: 1 }, provenance: 'missing' }),
      }
    })

    const { handleDocumentWorkerRequest } = await importWorker()

    expect(await handleDocumentWorkerRequest({
      id: 8,
      spec: DOCX_SPEC,
      assets: [],
    })).toMatchObject({ ok: false, code: 'provenance_missing' })
  })
})

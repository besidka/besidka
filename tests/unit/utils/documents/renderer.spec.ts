import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  RendererCapabilities,
  RenderRequest,
} from '~~/workers/doc-renderer/src/contract'

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}))

vi.mock('cloudflare:workers', () => ({
  env: mocks.env,
}))

const {
  getDocumentRenderer,
  getRendererCapabilities,
  getRenderFailureStatus,
  renderDocument,
  RENDERER_CAPABILITIES_TTL_MS,
  resetRendererCapabilitiesCache,
  validateDocumentBytes,
} = await import('~~/server/utils/documents/renderer')

const CAPABILITIES: RendererCapabilities = {
  rendererVersion: '1.0.0+1.0.0',
  specVersions: [1],
  formats: ['pdf', 'docx', 'pptx', 'xlsx'],
  maxOutputBytes: 20 * 1024 * 1024,
}

const SECRET_TITLE = 'Confidential merger memo'
const SECRET_FILE_ID = 'salary-spreadsheet-screenshot.png'

function createBinding() {
  return {
    capabilities: vi.fn(async () => CAPABILITIES),
    render: vi.fn(async () => {
      return {
        ok: true as const,
        bytes: new Uint8Array(1234),
        mediaType: 'application/pdf',
        extension: 'pdf' as const,
        stats: { pages: 2 },
        rendererVersion: '1.0.0+1.0.0',
      }
    }),
    validate: vi.fn(async () => {
      return {
        ok: true as const,
        stats: { bytes: 99 },
        provenance: 'ai' as const,
      }
    }),
  }
}

function createLogger() {
  return { set: vi.fn() }
}

function createRequest(overrides: Partial<RenderRequest> = {}): RenderRequest {
  return {
    specVersion: 1,
    spec: {
      specVersion: 1,
      format: 'pdf',
      title: SECRET_TITLE,
      blocks: [{
        type: 'image',
        fileId: SECRET_FILE_ID,
        alt: 'Private chart of salaries',
        widthPercent: 50,
      }],
    },
    assets: [{
      fileId: SECRET_FILE_ID,
      mediaType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    }],
    provenance: { model: 'claude-haiku-5-5', createdVia: 'chat' },
    ...overrides,
  }
}

function loggedText(logger: ReturnType<typeof createLogger>): string {
  return JSON.stringify(logger.set.mock.calls)
}

describe('document renderer binding', () => {
  beforeEach(() => {
    vi.useRealTimers()
    resetRendererCapabilitiesCache()

    for (const key of Object.keys(mocks.env)) {
      Reflect.deleteProperty(mocks.env, key)
    }
  })

  describe('missing binding', () => {
    it('answers 503 with a clear reason', () => {
      expect(() => getDocumentRenderer()).toThrow(
        expect.objectContaining({
          message: 'Document rendering is unavailable',
          status: 503,
          why: 'DOC_RENDERER binding missing',
          fix: 'Try again later',
        }),
      )
    })

    it('fails render, validate and capabilities the same way', async () => {
      const logger = createLogger()

      await expect(renderDocument(createRequest(), logger as never))
        .rejects.toMatchObject({ status: 503 })
      await expect(validateDocumentBytes(
        { format: 'pdf', bytes: new Uint8Array(4) },
        logger as never,
      )).rejects.toMatchObject({ status: 503 })
      await expect(getRendererCapabilities()).rejects
        .toMatchObject({ status: 503 })
    })
  })

  describe('capabilities', () => {
    it('caches the answer for five minutes', async () => {
      vi.useFakeTimers()

      const binding = createBinding()

      mocks.env.DOC_RENDERER = binding

      await getRendererCapabilities()
      await getRendererCapabilities()

      expect(binding.capabilities).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(RENDERER_CAPABILITIES_TTL_MS - 1)
      await getRendererCapabilities()

      expect(binding.capabilities).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(2)
      await getRendererCapabilities()

      expect(binding.capabilities).toHaveBeenCalledTimes(2)
    })

    it('does not cache a failed call', async () => {
      const binding = createBinding()

      binding.capabilities
        .mockRejectedValueOnce(new Error('connection lost'))
      mocks.env.DOC_RENDERER = binding

      await expect(getRendererCapabilities()).rejects
        .toMatchObject({ status: 503 })
      await expect(getRendererCapabilities()).resolves.toEqual(CAPABILITIES)
      expect(binding.capabilities).toHaveBeenCalledTimes(2)
    })
  })

  describe('render', () => {
    it('passes the request through and returns the result', async () => {
      const binding = createBinding()
      const request = createRequest()

      mocks.env.DOC_RENDERER = binding

      const result = await renderDocument(request, createLogger() as never)

      expect(binding.render).toHaveBeenCalledWith(request)
      expect(result).toMatchObject({ ok: true, extension: 'pdf' })
    })

    it('answers an unsupported spec version without calling render', async () => {
      const binding = createBinding()
      const logger = createLogger()

      mocks.env.DOC_RENDERER = binding

      const result = await renderDocument(
        createRequest({ specVersion: 2 }),
        logger as never,
      )

      expect(binding.render).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        ok: false,
        code: 'spec_version_unsupported',
      })
      expect(loggedText(logger)).toContain('spec_version_unsupported')
    })

    it('returns renderer failures as values', async () => {
      const binding = createBinding()

      binding.render.mockResolvedValueOnce({
        ok: false,
        code: 'spec_invalid',
        issues: [{ path: '$.title', message: 'Too small' }],
      } as never)
      mocks.env.DOC_RENDERER = binding

      const result = await renderDocument(
        createRequest(),
        createLogger() as never,
      )

      expect(result).toMatchObject({ ok: false, code: 'spec_invalid' })
    })

    it('turns a failed binding call into a 503', async () => {
      const binding = createBinding()
      const logger = createLogger()

      binding.render.mockRejectedValueOnce(
        new Error(`Could not reach ${SECRET_TITLE}`),
      )
      mocks.env.DOC_RENDERER = binding

      await expect(renderDocument(createRequest(), logger as never))
        .rejects.toMatchObject({
          status: 503,
          why: 'The DOC_RENDERER call failed',
        })
      expect(loggedText(logger)).toContain('binding_call_failed')
      expect(loggedText(logger)).not.toContain(SECRET_TITLE)
    })

    it('logs one renderer block with no spec text, file names or bytes', async () => {
      const binding = createBinding()
      const logger = createLogger()

      mocks.env.DOC_RENDERER = binding

      await renderDocument(createRequest(), logger as never)

      const renderBlock = logger.set.mock.calls
        .map(([fields]) => fields.attributes.documents.renderer)
        .find(block => block.operation === 'render')

      expect(renderBlock).toEqual({
        operation: 'render',
        format: 'pdf',
        ok: true,
        code: undefined,
        durationMs: expect.any(Number),
        bytes: 1234,
        rendererVersion: '1.0.0+1.0.0',
      })

      const text = loggedText(logger)

      expect(text).not.toContain(SECRET_TITLE)
      expect(text).not.toContain(SECRET_FILE_ID)
      expect(text).not.toContain('Private chart')
    })

    it('logs only a known format name', async () => {
      const binding = createBinding()
      const logger = createLogger()

      mocks.env.DOC_RENDERER = binding

      await renderDocument(
        createRequest({ spec: { format: SECRET_TITLE } }),
        logger as never,
      )

      expect(loggedText(logger)).not.toContain(SECRET_TITLE)
    })
  })

  describe('validate', () => {
    it('passes the bytes through and logs the size only', async () => {
      const binding = createBinding()
      const logger = createLogger()

      mocks.env.DOC_RENDERER = binding

      const result = await validateDocumentBytes(
        { format: 'docx', bytes: new Uint8Array(77) },
        logger as never,
      )

      expect(result).toMatchObject({ ok: true, provenance: 'ai' })
      expect(logger.set).toHaveBeenLastCalledWith({
        attributes: {
          documents: {
            renderer: expect.objectContaining({
              operation: 'validate',
              format: 'docx',
              ok: true,
              bytes: 77,
            }),
          },
        },
      })
    })

    it('logs the failure code of a rejected file', async () => {
      const binding = createBinding()
      const logger = createLogger()

      binding.validate.mockResolvedValueOnce({
        ok: false,
        code: 'ooxml_macro',
        detail: 'Macro part',
      } as never)
      mocks.env.DOC_RENDERER = binding

      const result = await validateDocumentBytes(
        { format: 'docx', bytes: new Uint8Array(8) },
        logger as never,
      )

      expect(result).toMatchObject({ ok: false, code: 'ooxml_macro' })
      expect(loggedText(logger)).toContain('ooxml_macro')
    })
  })

  describe('getRenderFailureStatus', () => {
    it('answers 503 for chat and 422 elsewhere on an unsupported version', () => {
      expect(getRenderFailureStatus('spec_version_unsupported', 'chat'))
        .toBe(503)
      expect(getRenderFailureStatus('spec_version_unsupported', 'mcp'))
        .toBe(422)
      expect(getRenderFailureStatus('spec_version_unsupported', 'research'))
        .toBe(422)
    })

    it('answers 422 for caller mistakes and 500 for renderer faults', () => {
      expect(getRenderFailureStatus('spec_invalid', 'mcp')).toBe(422)
      expect(getRenderFailureStatus('bounds_exceeded', 'chat')).toBe(422)
      expect(getRenderFailureStatus('asset_invalid', 'chat')).toBe(422)
      expect(getRenderFailureStatus('render_failed', 'chat')).toBe(500)
      expect(getRenderFailureStatus('output_invalid', 'mcp')).toBe(500)
    })
  })
})

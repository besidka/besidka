import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  loadFonts,
  loadReferenceAssets,
} from '~~/tests/setup/helpers/documents'
import type {
  RenderRequest,
  RenderResult,
} from '~~/workers/doc-renderer/src/contract'

const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  actualRender: null as null | ((...input: unknown[]) => unknown),
  renderFailure: null as Error | null,
}))

vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class {
    readonly env: Record<string, never> = {}
  },
}))

vi.mock('~~/workers/doc-renderer/src/fonts', async () => {
  const { loadFonts: readFonts } = await import(
    '~~/tests/setup/helpers/documents'
  )

  return { documentFonts: readFonts() }
})

vi.mock('@besidka/doc-renderer/render', async (importOriginal) => {
  const original
    = await importOriginal<typeof import('@besidka/doc-renderer/render')>()

  mocks.actualRender = original.render as (...input: unknown[]) => unknown

  return { ...original, render: mocks.render }
})

const { default: worker, DocRenderer } = await import(
  '~~/workers/doc-renderer/src/index'
)
const { validate } = await import('@besidka/doc-renderer/validate')

const WORKER_ROOT = resolve(import.meta.dirname, '../../../../workers/doc-renderer')
const fonts = loadFonts()

function createRenderer() {
  return new (DocRenderer as unknown as new () => InstanceType<
    typeof DocRenderer
  >)()
}

const SPECS = {
  docx: {
    specVersion: 1,
    format: 'docx',
    title: 'Quarterly report',
    blocks: [
      { type: 'heading', level: 1, text: 'Summary' },
      { type: 'paragraph', runs: [{ text: 'Revenue grew.' }] },
    ],
  },
  pdf: {
    specVersion: 1,
    format: 'pdf',
    title: 'Quarterly report',
    pageSize: 'A4',
    blocks: [
      { type: 'heading', level: 1, text: 'Резюме' },
      { type: 'paragraph', runs: [{ text: 'Дохід зріс.' }] },
    ],
  },
  pptx: {
    specVersion: 1,
    format: 'pptx',
    title: 'Deck',
    aspect: '16:9',
    slides: [{ layout: 'title', title: 'Hello' }],
  },
  xlsx: {
    specVersion: 1,
    format: 'xlsx',
    title: 'Book',
    sheets: [{
      name: 'Data',
      columns: [{ header: 'Name', type: 'string' }],
      rows: [['one'], ['two']],
    }],
  },
} as const

function createRequest(
  spec: unknown,
  overrides: Partial<RenderRequest> = {},
): RenderRequest {
  return {
    specVersion: 1,
    spec,
    assets: [],
    provenance: { model: 'claude-haiku-5-5', createdVia: 'chat' },
    ...overrides,
  }
}

function expectFailure(result: RenderResult, code: string) {
  expect(result.ok).toBe(false)
  expect(result).toMatchObject({ ok: false, code })
}

function listSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)

    return entry.isDirectory()
      ? listSourceFiles(path)
      : [path]
  })
}

describe('DocRenderer entrypoint', () => {
  beforeEach(() => {
    mocks.renderFailure = null
    mocks.render.mockReset()
    mocks.render.mockImplementation(async (...args: unknown[]) => {
      if (mocks.renderFailure) {
        throw mocks.renderFailure
      }

      return mocks.actualRender?.(...args)
    })
  })

  it('reports its capabilities', async () => {
    const capabilities = await createRenderer().capabilities()

    expect(capabilities).toEqual({
      rendererVersion: '1.0.0+1.0.0',
      specVersions: [1],
      formats: ['pdf', 'docx', 'pptx', 'xlsx'],
      maxOutputBytes: 20 * 1024 * 1024,
      extract: {
        version: 1,
        formats: ['docx', 'xlsx', 'pptx'],
        maxInputBytes: 30 * 1024 * 1024,
        maxTextBytes: 1024 * 1024,
      },
    })
  })

  it.each(['docx', 'pptx', 'xlsx'] as const)(
    'extracts the text of a rendered %s',
    async (format) => {
      const rendered = await createRenderer().render(
        createRequest(SPECS[format]),
      )

      expect(rendered.ok).toBe(true)

      if (!rendered.ok) {
        return
      }

      const result = await createRenderer().extract({
        format,
        bytes: rendered.bytes,
      })

      expect(result.status).toBe('ready')
      expect(result.truncated).toBe(false)
      expect(result.text.length).toBeGreaterThan(5)
    },
  )

  it('returns failure values from extract, never an exception', async () => {
    const renderer = createRenderer()
    const garbage = await renderer.extract({
      format: 'docx',
      bytes: new Uint8Array([1, 2, 3, 4]),
    })
    const badFormat = await renderer.extract({
      format: 'pdf' as never,
      bytes: new Uint8Array(4),
    })
    const badBytes = await renderer.extract({
      format: 'docx',
      bytes: 'text' as never,
    })
    const badRequest = await renderer.extract(null as never)

    expect(garbage).toMatchObject({ status: 'failed', errorCode: 'zip_invalid' })
    expect(badFormat).toMatchObject({
      status: 'failed',
      errorCode: 'unsupported_format',
    })
    expect(badBytes).toMatchObject({
      status: 'failed',
      errorCode: 'bad_request',
    })
    expect(badRequest).toMatchObject({
      status: 'failed',
      errorCode: 'bad_request',
    })
  })

  it.each(['docx', 'pdf', 'pptx', 'xlsx'] as const)(
    'renders %s and returns bytes that validate with the AI mark',
    async (format) => {
      const result = await createRenderer().render(
        createRequest(SPECS[format]),
      )

      expect(result.ok).toBe(true)

      if (!result.ok) {
        return
      }

      const validated = validate(
        result.extension,
        result.bytes,
        format === 'xlsx' ? { spec: SPECS.xlsx as never } : {},
      )

      expect(result.extension).toBe(format)
      expect(result.rendererVersion).toBe('1.0.0+1.0.0')
      expect(validated.ok && validated.provenance).toBe('ai')
    },
  )

  it('resolves image assets sent as bytes', async () => {
    const assets = [...loadReferenceAssets()].map(([fileId, asset]) => {
      return { fileId, ...asset }
    })
    const spec = {
      ...SPECS.docx,
      blocks: [{
        type: 'image',
        fileId: 'chart-revenue.png',
        alt: 'Revenue',
        widthPercent: 50,
      }],
    }
    const result = await createRenderer().render(
      createRequest(spec, { assets }),
    )

    expect(result.ok).toBe(true)
  })

  it('marks MCP content that the caller wrote as channel-only', async () => {
    const result = await createRenderer().render(createRequest(SPECS.docx, {
      provenance: { model: null, createdVia: 'mcp', aiGenerated: false },
    }))

    expect(result.ok).toBe(true)

    if (result.ok) {
      const validated = validate('docx', result.bytes)

      expect(validated.ok && validated.provenance).toBe('channel-only')
    }
  })

  it('returns spec_invalid with JSON paths for a bad spec', async () => {
    const result = await createRenderer().render(createRequest({
      ...SPECS.docx,
      title: '',
    }))

    expectFailure(result, 'spec_invalid')
    expect(result).toMatchObject({
      issues: [expect.objectContaining({ path: '$.title' })],
    })
  })

  it('returns bounds_exceeded for a spec over the serialized limit', async () => {
    const result = await createRenderer().render(createRequest({
      ...SPECS.docx,
      blocks: Array.from({ length: 60 }, () => {
        return { type: 'code', text: 'x'.repeat(5000) }
      }),
    }))

    expectFailure(result, 'bounds_exceeded')
  })

  it('returns bounds_exceeded for more than 20 assets', async () => {
    const assets = Array.from({ length: 21 }, (_item, index) => {
      return {
        fileId: `image-${index}`,
        mediaType: 'image/png' as const,
        bytes: new Uint8Array(10),
      }
    })
    const result = await createRenderer().render(
      createRequest(SPECS.docx, { assets }),
    )

    expectFailure(result, 'bounds_exceeded')
  })

  it('returns bounds_exceeded for an asset over the per-image limit', async () => {
    const result = await createRenderer().render(createRequest(SPECS.docx, {
      assets: [{
        fileId: 'big',
        mediaType: 'image/png',
        bytes: new Uint8Array(5 * 1024 * 1024 + 1),
      }],
    }))

    expectFailure(result, 'bounds_exceeded')
  })

  it('returns asset_invalid for malformed, repeated and fake assets', async () => {
    const malformed = await createRenderer().render(createRequest(
      SPECS.docx,
      { assets: [{ fileId: 'a', bytes: 'text' } as never] },
    ))
    const repeated = await createRenderer().render(createRequest(
      SPECS.docx,
      {
        assets: ['a', 'a'].map((fileId) => {
          return {
            fileId,
            mediaType: 'image/png' as const,
            bytes: new Uint8Array(4),
          }
        }),
      },
    ))
    const fake = await createRenderer().render(createRequest(
      {
        ...SPECS.docx,
        blocks: [{
          type: 'image',
          fileId: 'fake',
          alt: 'Fake',
          widthPercent: 50,
        }],
      },
      {
        assets: [{
          fileId: 'fake',
          mediaType: 'image/png',
          bytes: new TextEncoder().encode('not a png at all, just text'),
        }],
      },
    ))

    expectFailure(malformed, 'asset_invalid')
    expectFailure(repeated, 'asset_invalid')
    expectFailure(fake, 'asset_invalid')
  })

  it('returns asset_invalid when the spec names an image nobody sent', async () => {
    const result = await createRenderer().render(createRequest({
      ...SPECS.docx,
      blocks: [{
        type: 'image',
        fileId: 'missing',
        alt: 'Missing',
        widthPercent: 50,
      }],
    }))

    expectFailure(result, 'asset_invalid')
  })

  it('answers an unsupported spec version without rendering', async () => {
    const result = await createRenderer().render(createRequest(
      { ...SPECS.docx, specVersion: 2 },
      { specVersion: 2 },
    ))

    expectFailure(result, 'spec_version_unsupported')
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it('answers a spec whose own version is unsupported without rendering', async () => {
    const result = await createRenderer().render(createRequest(
      { ...SPECS.docx, specVersion: 7 },
    ))

    expectFailure(result, 'spec_version_unsupported')
    expect(mocks.render).not.toHaveBeenCalled()
  })

  it('rejects a spec whose version differs from the request', async () => {
    const { specVersion: _specVersion, ...withoutVersion } = SPECS.docx
    const result = await createRenderer().render(
      createRequest(withoutVersion),
    )

    expectFailure(result, 'spec_invalid')
  })

  it('rejects an unknown createdVia and a malformed model', async () => {
    const unknownChannel = await createRenderer().render(createRequest(
      SPECS.docx,
      { provenance: { model: null, createdVia: 'schedule' as never } },
    ))
    const badModel = await createRenderer().render(createRequest(
      SPECS.docx,
      { provenance: { model: 7 as never, createdVia: 'chat' } },
    ))

    expectFailure(unknownChannel, 'spec_invalid')
    expectFailure(badModel, 'spec_invalid')
  })

  it('never throws, whatever the input', async () => {
    const renderer = createRenderer()
    const inputs: unknown[] = [null, undefined, 7, 'text', [], {}]

    for (const input of inputs) {
      const rendered = await renderer.render(input as never)
      const validated = await renderer.validate(input as never)

      expect(rendered.ok).toBe(false)
      expect(validated.ok).toBe(false)
    }
  })

  it('hides the message of an unexpected exception', async () => {
    mocks.renderFailure = new Error('secret text from the document')

    const result = await createRenderer().render(createRequest(SPECS.docx))

    expectFailure(result, 'render_failed')
    expect(JSON.stringify(result)).not.toContain('secret text')
  })

  it('maps a self-validation failure to output_invalid', async () => {
    const { RenderError } = await import('@besidka/doc-renderer/render')

    mocks.renderFailure = new RenderError(
      'validation_failed',
      'The rendered docx failed validation: zip_ratio',
    )

    const result = await createRenderer().render(createRequest(SPECS.docx))

    expectFailure(result, 'output_invalid')
  })

  it('validates provider bytes and reports the mark', async () => {
    const rendered = await createRenderer().render(createRequest(SPECS.pptx))

    if (!rendered.ok) {
      throw new Error('render failed')
    }

    const result = await createRenderer().validate({
      format: 'pptx',
      bytes: rendered.bytes,
    })

    expect(result).toMatchObject({ ok: true, provenance: 'ai' })
  })

  it('validates an XLSX against its spec', async () => {
    const rendered = await createRenderer().render(createRequest(SPECS.xlsx))

    if (!rendered.ok) {
      throw new Error('render failed')
    }

    const accepted = await createRenderer().validate({
      format: 'xlsx',
      bytes: rendered.bytes,
      spec: SPECS.xlsx,
    })
    const rejected = await createRenderer().validate({
      format: 'xlsx',
      bytes: rendered.bytes,
      spec: { not: 'a spec' },
    })

    expect(accepted.ok).toBe(true)
    expect(rejected).toMatchObject({ ok: false, code: 'spec_invalid' })
  })

  it('returns failure values for unsafe, oversized and malformed files', async () => {
    const renderer = createRenderer()
    const truncated = await renderer.validate({
      format: 'pdf',
      bytes: new TextEncoder().encode('%PDF-1.7\n1 0 obj\n'),
    })
    const oversized = await renderer.validate({
      format: 'docx',
      bytes: new Uint8Array(21 * 1024 * 1024),
    })
    const badFormat = await renderer.validate({
      format: 'exe' as never,
      bytes: new Uint8Array(4),
    })
    const badBytes = await renderer.validate({
      format: 'pdf',
      bytes: 'text' as never,
    })

    expect(truncated).toMatchObject({ ok: false, code: 'pdf_truncated' })
    expect(oversized).toMatchObject({ ok: false, code: 'too_large' })
    expect(badFormat).toMatchObject({ ok: false, code: 'bad_request' })
    expect(badBytes).toMatchObject({ ok: false, code: 'bad_request' })
  })

  it('has no public fetch surface', async () => {
    const response = await worker.fetch()

    expect(response.status).toBe(404)
  })

  it('renders PDFs from the fonts it bundles', () => {
    expect(fonts.regular.length).toBeGreaterThan(10_000)
  })
})

describe('Worker deployment config', () => {
  const config = JSON.parse(
    readFileSync(resolve(WORKER_ROOT, 'wrangler.jsonc'), 'utf8')
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n'),
  ) as Record<string, unknown> & {
    env: { preview: Record<string, unknown> }
  }

  const BINDING_KEYS = [
    'd1_databases',
    'kv_namespaces',
    'r2_buckets',
    'services',
    'queues',
    'durable_objects',
    'ai',
    'images',
    'analytics_engine_datasets',
    'send_email',
    'ratelimits',
    'vars',
    'triggers',
    'routes',
  ]

  it('has no bindings, vars, routes or triggers of its own', () => {
    for (const key of BINDING_KEYS) {
      expect(config[key], key).toBeUndefined()
      expect(config.env.preview[key], `preview ${key}`).toBeUndefined()
    }
  })

  it('is private and bounded', () => {
    for (const block of [config, config.env.preview]) {
      expect(block.workers_dev).toBe(false)
      expect(block.preview_urls).toBe(false)
      expect(block.limits).toEqual({ cpu_ms: 15000 })
    }
  })

  it('names the production and the long-lived preview Worker', () => {
    expect(config.name).toBe('besidka-doc-renderer')
    expect(config.env.preview.name).toBe('besidka-doc-renderer-preview')
  })

  it('keeps the app flags and the three build aliases in both configs', () => {
    expect(config.compatibility_flags).toEqual([
      'nodejs_compat',
      'no_nodejs_compat_v2',
      'nodejs_als',
    ])

    for (const block of [config, config.env.preview]) {
      expect(block.alias).toEqual({
        'node:fs': './src/shims/empty.ts',
        'node:https': './src/shims/empty.ts',
        'fflate': './src/shims/fflate.ts',
      })
    }
  })
})

describe('Worker sources', () => {
  const sources = listSourceFiles(resolve(WORKER_ROOT, 'src'))
    .filter(file => file.endsWith('.ts'))

  it('write no logs, so Workers Logs carry no spec text or asset bytes', () => {
    expect(sources.length).toBeGreaterThan(3)

    for (const file of sources) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\bconsole\b/)
    }
  })

  it('use no network or binding access', () => {
    for (const file of sources) {
      const text = readFileSync(file, 'utf8')

      expect(text, file).not.toMatch(/XMLHttpRequest|WebSocket|\bthis\.env\b/)

      if (!file.endsWith('/index.ts')) {
        expect(text, file).not.toMatch(/\bfetch\b/)
      }
    }
  })
})

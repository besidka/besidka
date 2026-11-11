import type {
  DocumentRenderFailureCode,
  DocumentWorkerAsset,
  DocumentWorkerRequest,
  DocumentWorkerResponse,
} from '~/types/document-render.d'
import { DOCUMENT_ERROR_CODES } from '#shared/utils/documents'
import { parseDocumentSpec } from '@besidka/doc-renderer/spec'
import regularFontUrl from '~~/packages/doc-renderer/fonts/NotoSans-Regular.ttf?url'
import boldFontUrl from '~~/packages/doc-renderer/fonts/NotoSans-Bold.ttf?url'
import italicFontUrl from '~~/packages/doc-renderer/fonts/NotoSans-Italic.ttf?url'

interface DocumentWorkerScope {
  onmessage: ((event: MessageEvent<DocumentWorkerRequest>) => void) | null
  postMessage: (
    response: DocumentWorkerResponse,
    transfer: Transferable[],
  ) => void
}

interface RenderFontBytes {
  regular: Uint8Array
  bold: Uint8Array
  italic: Uint8Array
}

type ImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp'

interface RenderImageAsset {
  bytes: Uint8Array
  mediaType: ImageMediaType
}

class DocumentRenderException extends Error {
  readonly code: DocumentRenderFailureCode

  constructor(code: DocumentRenderFailureCode, detail: string) {
    super(detail)
    this.code = code
  }
}

const IMAGE_MEDIA_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
]

const renderFailureCodes: Record<string, DocumentRenderFailureCode> = {
  invalid_spec: DOCUMENT_ERROR_CODES.specInvalid,
  missing_asset: 'asset_invalid',
  unsupported_image: 'asset_invalid',
  image_too_large: 'asset_invalid',
  assets_too_large: 'asset_invalid',
  page_limit: 'bounds_exceeded',
  validation_failed: DOCUMENT_ERROR_CODES.validationFailed,
  font_missing: DOCUMENT_ERROR_CODES.renderFailed,
  render_failed: DOCUMENT_ERROR_CODES.renderFailed,
}

let fontsPromise: Promise<RenderFontBytes> | null = null

function readOwnOrigin(): string {
  return (globalThis as { location?: { origin: string } }).location?.origin
    ?? ''
}

async function fetchFont(fontUrl: string): Promise<Uint8Array> {
  const ownOrigin = readOwnOrigin()
  const resolved = new URL(fontUrl, `${ownOrigin}/`)

  if (resolved.origin !== ownOrigin) {
    throw new DocumentRenderException('font_unavailable', 'cross-origin-font')
  }

  const response = await fetch(resolved.href, { credentials: 'same-origin' })

  if (!response.ok) {
    throw new DocumentRenderException('font_unavailable', 'font-fetch-failed')
  }

  return new Uint8Array(await response.arrayBuffer())
}

async function fetchFontsSequentially(): Promise<RenderFontBytes> {
  const regular = await fetchFont(regularFontUrl)
  const bold = await fetchFont(boldFontUrl)
  const italic = await fetchFont(italicFontUrl)

  return { regular, bold, italic }
}

function loadFonts(): Promise<RenderFontBytes> {
  if (!fontsPromise) {
    fontsPromise = fetchFontsSequentially().catch((exception: unknown) => {
      fontsPromise = null

      if (exception instanceof DocumentRenderException) {
        throw exception
      }

      throw new DocumentRenderException(
        'font_unavailable',
        'font-fetch-failed',
      )
    })
  }

  return fontsPromise
}

function toRenderAssets(
  assets: DocumentWorkerAsset[],
): Map<string, RenderImageAsset> {
  const renderAssets = new Map<string, RenderImageAsset>()

  for (const asset of assets) {
    if (!IMAGE_MEDIA_TYPES.includes(asset.mediaType)) {
      throw new DocumentRenderException('asset_invalid', 'media-type')
    }

    renderAssets.set(asset.id, {
      bytes: new Uint8Array(asset.bytes),
      mediaType: asset.mediaType as ImageMediaType,
    })
  }

  return renderAssets
}

function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer
  }

  return bytes.slice().buffer
}

function readPackageCode(exception: unknown): string | null {
  const { code } = (exception ?? {}) as { code?: unknown }

  return typeof code === 'string' ? code : null
}

function readFailureCode(exception: unknown): DocumentRenderFailureCode {
  if (exception instanceof DocumentRenderException) {
    return exception.code
  }

  const packageCode = readPackageCode(exception)

  return packageCode && packageCode in renderFailureCodes
    ? renderFailureCodes[packageCode]!
    : DOCUMENT_ERROR_CODES.renderFailed
}

function readFailureDetail(exception: unknown): string {
  if (exception instanceof DocumentRenderException) {
    return exception.message
  }

  return readPackageCode(exception) ?? 'render-failed'
}

export async function handleDocumentWorkerRequest(
  request: DocumentWorkerRequest,
): Promise<DocumentWorkerResponse> {
  try {
    const parsed = parseDocumentSpec(request.spec)

    if (!parsed.ok) {
      throw new DocumentRenderException(
        DOCUMENT_ERROR_CODES.specInvalid,
        'spec-invalid',
      )
    }

    const { spec } = parsed
    const assets = toRenderAssets(request.assets)
    const fonts = spec.format === 'pdf' ? await loadFonts() : undefined
    const { render } = await import('@besidka/doc-renderer/render')
    const rendered = await render(spec, assets, {
      provenance: {
        createdVia: 'chat',
        aiGenerated: true,
        ...(request.modelId ? { model: request.modelId } : {}),
      },
      ...(fonts ? { fonts } : {}),
    })
    const { validate } = await import('@besidka/doc-renderer/validate')
    const validated = validate(
      spec.format,
      rendered.bytes,
      spec.format === 'xlsx' ? { spec } : {},
    )

    if (!validated.ok) {
      throw new DocumentRenderException(
        DOCUMENT_ERROR_CODES.validationFailed,
        validated.code,
      )
    }

    if (validated.provenance !== 'ai') {
      throw new DocumentRenderException(
        DOCUMENT_ERROR_CODES.provenanceMissing,
        validated.provenance,
      )
    }

    return {
      id: request.id,
      ok: true,
      bytes: toTransferableBuffer(rendered.bytes),
      mediaType: rendered.mediaType,
      stats: rendered.stats,
    }
  } catch (exception) {
    return {
      id: request.id,
      ok: false,
      code: readFailureCode(exception),
      detail: readFailureDetail(exception),
    }
  }
}

function isDedicatedWorkerScope(scope: object): boolean {
  const workerScopeConstructor = (globalThis as {
    WorkerGlobalScope?: new () => object
  }).WorkerGlobalScope

  return typeof workerScopeConstructor !== 'undefined'
    && scope instanceof workerScopeConstructor
}

const workerScope = globalThis as unknown as DocumentWorkerScope

if (isDedicatedWorkerScope(workerScope)) {
  workerScope.onmessage = async (event) => {
    const response = await handleDocumentWorkerRequest(event.data)

    workerScope.postMessage(
      response,
      response.ok ? [response.bytes] : [],
    )
  }
}

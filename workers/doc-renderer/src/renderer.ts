import {
  IMAGE_LIMITS,
  MEDIA_TYPES,
  render,
  RenderError,
} from '@besidka/doc-renderer/render'
import type {
  ImageAsset,
  RenderAssets,
  RenderFonts,
  RenderErrorCode,
} from '@besidka/doc-renderer/render'
import {
  documentSpecSchema,
  parseDocumentSpec,
  SPEC_LIMITS,
  SUPPORTED_SPEC_VERSIONS,
} from '@besidka/doc-renderer/spec'
import {
  EXTRACT_FORMATS,
  EXTRACT_LIMITS,
  EXTRACT_VERSION,
  extractOfficeText,
} from '@besidka/doc-renderer/extract'
import type { ExtractFormat } from '@besidka/doc-renderer/extract'
import {
  validate,
  VALIDATED_FORMATS,
  VALIDATION_LIMITS,
} from '@besidka/doc-renderer/validate'
import type { ValidationFailure } from '@besidka/doc-renderer/validate'
import documentRendererPackage from '../../../packages/doc-renderer/package.json'
import workerPackage from '../package.json'
import { CREATED_VIA_VALUES } from './contract'
import type {
  DocumentFormat,
  ExtractRequest,
  ExtractResult,
  RenderAssetInput,
  RenderFailure,
  RenderFailureCode,
  RenderRequest,
  RenderResult,
  RendererCapabilities,
  ValidateRequest,
  ValidateResult,
} from './contract'

export const RENDERER_VERSION
  = `${workerPackage.version}+${documentRendererPackage.version}`

const ASSET_MEDIA_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
]

const RENDER_ERROR_CODES: Record<RenderErrorCode, RenderFailureCode> = {
  invalid_spec: 'spec_invalid',
  missing_asset: 'asset_invalid',
  unsupported_image: 'asset_invalid',
  image_too_large: 'asset_invalid',
  assets_too_large: 'asset_invalid',
  font_missing: 'render_failed',
  page_limit: 'bounds_exceeded',
  render_failed: 'render_failed',
  validation_failed: 'output_invalid',
}

const DETAIL_FREE_CODES: readonly RenderFailureCode[] = ['render_failed']

const UNEXPECTED_DETAIL = 'The renderer failed unexpectedly'

export function getCapabilities(): RendererCapabilities {
  return {
    rendererVersion: RENDERER_VERSION,
    specVersions: [...SUPPORTED_SPEC_VERSIONS],
    formats: [...VALIDATED_FORMATS],
    maxOutputBytes: VALIDATION_LIMITS.fileBytesMax,
    extract: {
      version: EXTRACT_VERSION,
      formats: [...EXTRACT_FORMATS],
      maxInputBytes: EXTRACT_LIMITS.fileBytesMax,
      maxTextBytes: EXTRACT_LIMITS.textBytesMax,
    },
  }
}

function failure(
  code: RenderFailureCode,
  detail?: string,
  issues?: RenderFailure['issues'],
): RenderFailure {
  const result: RenderFailure = { ok: false, code }

  if (detail !== undefined) {
    result.detail = detail
  }

  if (issues !== undefined) {
    result.issues = issues
  }

  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isSupportedSpecVersion(version: unknown): boolean {
  return typeof version === 'number'
    && SUPPORTED_SPEC_VERSIONS.includes(version)
}

function readSpecVersion(spec: unknown): unknown {
  return isRecord(spec) ? spec.specVersion : undefined
}

function isCreatedVia(value: unknown): boolean {
  return typeof value === 'string'
    && (CREATED_VIA_VALUES as readonly string[]).includes(value)
}

function readProvenance(request: RenderRequest): RenderFailure | null {
  const provenance: unknown = request.provenance

  if (!isRecord(provenance) || !isCreatedVia(provenance.createdVia)) {
    return failure('spec_invalid', 'provenance.createdVia is not supported')
  }

  const { model, aiGenerated } = provenance

  if (model !== null && typeof model !== 'string') {
    return failure('spec_invalid', 'provenance.model must be a string or null')
  }

  if (aiGenerated !== undefined && typeof aiGenerated !== 'boolean') {
    return failure('spec_invalid', 'provenance.aiGenerated must be a boolean')
  }

  return null
}

function buildAssets(
  assets: unknown,
): { ok: true, assets: RenderAssets } | { ok: false, failure: RenderFailure } {
  if (!Array.isArray(assets)) {
    return {
      ok: false,
      failure: failure('asset_invalid', 'assets must be an array'),
    }
  }

  if (assets.length > SPEC_LIMITS.imagesMax) {
    return {
      ok: false,
      failure: failure(
        'bounds_exceeded',
        `${assets.length} assets, limit ${SPEC_LIMITS.imagesMax}`,
      ),
    }
  }

  const map: RenderAssets = new Map()
  let totalBytes = 0

  for (const asset of assets as RenderAssetInput[]) {
    if (
      !isRecord(asset)
      || typeof asset.fileId !== 'string'
      || asset.fileId.length === 0
      || asset.fileId.length > SPEC_LIMITS.fileIdMax
      || !(asset.bytes instanceof Uint8Array)
      || typeof asset.mediaType !== 'string'
      || !ASSET_MEDIA_TYPES.includes(asset.mediaType)
    ) {
      return {
        ok: false,
        failure: failure('asset_invalid', 'An asset is malformed'),
      }
    }

    if (map.has(asset.fileId)) {
      return {
        ok: false,
        failure: failure('asset_invalid', 'An asset id is repeated'),
      }
    }

    totalBytes += asset.bytes.length

    if (
      asset.bytes.length > IMAGE_LIMITS.bytesEach
      || totalBytes > IMAGE_LIMITS.bytesTotal
    ) {
      return {
        ok: false,
        failure: failure('bounds_exceeded', 'Assets exceed the size limit'),
      }
    }

    map.set(asset.fileId, {
      bytes: asset.bytes,
      mediaType: asset.mediaType,
    } satisfies ImageAsset)
  }

  return { ok: true, assets: map }
}

function classifySpecFailure(
  spec: unknown,
  issues: NonNullable<RenderFailure['issues']>,
): RenderFailure {
  const [firstIssue] = issues

  if (
    firstIssue?.path === '$.specVersion'
    && firstIssue.message.startsWith('Unsupported specVersion')
  ) {
    return failure('spec_version_unsupported', firstIssue.message, issues)
  }

  if (firstIssue?.path === '$') {
    return failure(
      firstIssue.message.startsWith('Spec is')
        ? 'bounds_exceeded'
        : 'spec_invalid',
      `$: ${firstIssue.message}`,
      issues,
    )
  }

  const schemaAccepted = documentSpecSchema.safeParse(spec).success

  return failure(
    schemaAccepted ? 'bounds_exceeded' : 'spec_invalid',
    firstIssue ? `${firstIssue.path}: ${firstIssue.message}` : undefined,
    issues,
  )
}

function mapRenderError(error: RenderError): RenderFailure {
  const code = RENDER_ERROR_CODES[error.code] ?? 'render_failed'

  return failure(
    code,
    DETAIL_FREE_CODES.includes(code) ? UNEXPECTED_DETAIL : error.message,
  )
}

/**
 * Renders a document from untrusted RPC input. Every failure is returned as
 * a value: thrown errors lose their structure across a service binding, and
 * their messages could carry document text.
 */
export async function renderDocument(
  request: RenderRequest,
  fonts: RenderFonts,
): Promise<RenderResult> {
  try {
    if (!isRecord(request)) {
      return failure('spec_invalid', 'The request must be an object')
    }

    if (!isSupportedSpecVersion(request.specVersion)) {
      return failure(
        'spec_version_unsupported',
        `Supported spec versions: ${SUPPORTED_SPEC_VERSIONS.join(', ')}`,
      )
    }

    const provenanceFailure = readProvenance(request)

    if (provenanceFailure) {
      return provenanceFailure
    }

    const specVersion = readSpecVersion(request.spec)

    if (specVersion !== request.specVersion) {
      return isSupportedSpecVersion(specVersion) || specVersion === undefined
        ? failure('spec_invalid', 'spec.specVersion must match specVersion')
        : failure(
          'spec_version_unsupported',
          `Supported spec versions: ${SUPPORTED_SPEC_VERSIONS.join(', ')}`,
        )
    }

    const parsed = parseDocumentSpec(request.spec)

    if (!parsed.ok) {
      return classifySpecFailure(request.spec, parsed.issues)
    }

    const assetResult = buildAssets(request.assets)

    if (!assetResult.ok) {
      return assetResult.failure
    }

    const { model, createdVia, aiGenerated } = request.provenance
    const rendered = await render(parsed.spec, assetResult.assets, {
      fonts,
      provenance: { model, createdVia, aiGenerated },
    })

    return {
      ok: true,
      bytes: rendered.bytes,
      mediaType: MEDIA_TYPES[parsed.spec.format],
      extension: parsed.spec.format,
      stats: rendered.stats,
      rendererVersion: RENDERER_VERSION,
    }
  } catch (exception) {
    if (exception instanceof RenderError) {
      return mapRenderError(exception)
    }

    return failure('render_failed', UNEXPECTED_DETAIL)
  }
}

function validationFailure(code: string, detail: string): ValidationFailure {
  return { ok: false, code, detail }
}

export function validateDocument(request: ValidateRequest): ValidateResult {
  try {
    if (!isRecord(request)) {
      return validationFailure('bad_request', 'The request must be an object')
    }

    if (!VALIDATED_FORMATS.includes(request.format as DocumentFormat)) {
      return validationFailure('bad_request', 'The format is not supported')
    }

    if (!(request.bytes instanceof Uint8Array)) {
      return validationFailure('bad_request', 'bytes must be a Uint8Array')
    }

    if (request.format !== 'xlsx' || request.spec === undefined) {
      return validate(request.format, request.bytes)
    }

    const parsed = parseDocumentSpec(request.spec)

    if (!parsed.ok || parsed.spec.format !== 'xlsx') {
      return validationFailure('spec_invalid', 'The XLSX spec is not valid')
    }

    return validate('xlsx', request.bytes, { spec: parsed.spec })
  } catch {
    return validationFailure('validation_error', UNEXPECTED_DETAIL)
  }
}

function extractFailure(
  errorCode: string,
  inputBytes: number,
): ExtractResult {
  return {
    status: 'failed',
    text: '',
    truncated: false,
    stats: { inputBytes, entries: 0, textBytes: 0, truncations: [] },
    errorCode,
  }
}

export function extractDocumentText(request: ExtractRequest): ExtractResult {
  try {
    if (!isRecord(request) || !(request.bytes instanceof Uint8Array)) {
      return extractFailure('bad_request', 0)
    }

    if (!EXTRACT_FORMATS.includes(request.format as ExtractFormat)) {
      return extractFailure('unsupported_format', request.bytes.length)
    }

    return extractOfficeText(request.bytes, request.format)
  } catch {
    return extractFailure('extract_error', 0)
  }
}

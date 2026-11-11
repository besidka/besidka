import { checkSpecBounds } from '../spec/bounds.ts'
import type { DocumentSpec } from '../spec/v1.ts'
import { RenderError } from './errors.ts'
import { prepareImages } from './images.ts'
import type { RenderAssets } from './images.ts'
import { renderDocx } from './docx.ts'
import { renderPdf } from './pdf.ts'
import { renderPptx } from './pptx.ts'
import { renderXlsx } from './xlsx.ts'
import type { RenderOptions, RenderResult } from './common.ts'

export { RenderError } from './errors.ts'
export type { RenderErrorCode } from './errors.ts'
export { IMAGE_LIMITS } from './images.ts'
export type { ImageAsset, ImageMediaType, RenderAssets } from './images.ts'
export { MEDIA_TYPES } from './common.ts'
export type {
  RenderFonts,
  RenderOptions,
  RenderResult,
  RenderStats,
} from './common.ts'

/**
 * Renders a validated spec to bytes. The spec must come from
 * `parseDocumentSpec`: bounds are re-checked here because render is the last
 * line before CPU is spent. Nothing is fetched; image bytes arrive through
 * `assets`. Provenance is always written; fonts are required for PDF.
 */
export async function render(
  spec: DocumentSpec,
  assets: RenderAssets,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const issues = checkSpecBounds(spec)

  if (issues.length > 0) {
    throw new RenderError(
      'invalid_spec',
      `${issues[0]?.path}: ${issues[0]?.message}`,
    )
  }

  const images = prepareImages(spec, assets)

  switch (spec.format) {
    case 'docx':
      return renderDocx(spec, images, options)
    case 'pdf':
      return renderPdf(spec, images, options)
    case 'pptx':
      return renderPptx(spec, images, options)
    case 'xlsx':
      return renderXlsx(spec, options)
  }
}

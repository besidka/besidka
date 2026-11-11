import DOMPurify from 'dompurify'

export const DIAGRAM_SVG_SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['foreignObject', 'script'],
  ADD_ATTR: ['role'],
}

/**
 * Cleans a rendered diagram before it reaches `v-html`. The renderer already
 * escapes labels, but the source can come from a model, an artifact or a
 * shared chat, so markup that is not plain SVG (scripts, `foreignObject`,
 * event handlers, `javascript:` links) is dropped as defence in depth.
 * Returns an empty string where no DOM is available.
 */
export function sanitizeDiagramSvg(svg: string): string {
  if (!svg || !DOMPurify.isSupported) {
    return ''
  }

  return DOMPurify.sanitize(svg, DIAGRAM_SVG_SANITIZE_CONFIG)
}

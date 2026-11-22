import { MERMAID_MAX_EDGES, MERMAID_MAX_TEXT_SIZE } from './mermaid-limits.ts'

export const DIAGRAM_FONT_NAME = 'Nunito'

export const DIAGRAM_FONT_MONO_NAME = 'Atkinson Hyperlegible Mono'

const DIAGRAM_OUTPUT_LIMIT = 1_000_000

const DIAGRAM_DIRECTION_BREAKPOINT = 480

/**
 * The Pele options the chat and the artifacts runtime both render with, so a
 * diagram has the same layout, limits and text metrics in either place.
 */
export const DIAGRAM_RENDER_OPTIONS = {
  fontFamily: `'${DIAGRAM_FONT_NAME}', sans-serif`,
  fontFamilyMono: `'${DIAGRAM_FONT_MONO_NAME}', monospace`,
  images: false,
  links: false,
  limit: MERMAID_MAX_TEXT_SIZE,
  outputLimit: DIAGRAM_OUTPUT_LIMIT,
  maxEdges: MERMAID_MAX_EDGES,
  directionBreakpoint: DIAGRAM_DIRECTION_BREAKPOINT,
} as const

export const DIAGRAM_SVG_SANITIZE_CONFIG = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ['foreignObject', 'script'],
  ADD_ATTR: ['role'],
}

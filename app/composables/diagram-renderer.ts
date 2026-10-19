import type {
  DiagramRenderError,
  DiagramRenderOptions,
  DiagramRenderResult,
} from '~/types/diagram.d'

type PeleModule = typeof import('pele/lazy')

const FONT_FAMILY: string = '\'Nunito\', sans-serif'
const FONT_FAMILY_MONO: string = '\'Atkinson Hyperlegible Mono\', monospace'
const SOURCE_LIMIT: number = 20_000
const OUTPUT_LIMIT: number = 1_000_000
const EDGES_LIMIT: number = 500
const RENDER_CACHE_LIMIT: number = 50
const DEFAULT_ID_PREFIX: string = 'pele'
const CACHED_ID_PREFIX: string = 'diagram-render-cache-prefix'

const renderCache = new Map<string, string>()

let peleModulePromise: Promise<PeleModule> | null = null

async function loadPele(): Promise<PeleModule> {
  peleModulePromise ??= import('pele/lazy')

  try {
    return await peleModulePromise
  } catch (exception) {
    peleModulePromise = null

    throw exception
  }
}

async function waitForFonts(): Promise<void> {
  try {
    await globalThis.document?.fonts?.ready
  } catch {
    return
  }
}

function toPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined
}

function toRenderError(exception: unknown): DiagramRenderError {
  if (!(exception instanceof Error)) {
    return { message: 'Unknown rendering error' }
  }

  const position = exception as Error & { line?: unknown, column?: unknown }
  const message = exception.message
    .replace(/\s*\n\s*\^\s*\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    message: message || 'Unknown rendering error',
    line: toPositiveNumber(position.line),
    column: toPositiveNumber(position.column),
  }
}

function getCacheKey(source: string, maxWidth: number | undefined): string {
  return `${source}\u0000${maxWidth ?? ''}`
}

function rememberSvg(cacheKey: string, svg: string): void {
  if (renderCache.size >= RENDER_CACHE_LIMIT) {
    const oldestKey = renderCache.keys().next().value

    if (oldestKey !== undefined) {
      renderCache.delete(oldestKey)
    }
  }

  renderCache.set(cacheKey, svg)
}

function applyIdPrefix(svg: string, idPrefix: string | undefined): string {
  return svg.replaceAll(CACHED_ID_PREFIX, idPrefix ?? DEFAULT_ID_PREFIX)
}

async function renderDiagram(
  source: string,
  options: DiagramRenderOptions = {},
): Promise<DiagramRenderResult> {
  const maxWidth = toPositiveNumber(options.maxWidth)
  const cacheKey = getCacheKey(source, maxWidth)
  const cachedSvg = renderCache.get(cacheKey)

  if (cachedSvg !== undefined) {
    return { svg: applyIdPrefix(cachedSvg, options.idPrefix) }
  }

  try {
    const pele = await loadPele()

    await waitForFonts()

    const { svg } = await pele.renderAsync(source, {
      idPrefix: CACHED_ID_PREFIX,
      maxWidth,
      fontFamily: FONT_FAMILY,
      fontFamilyMono: FONT_FAMILY_MONO,
      images: false,
      links: false,
      limit: SOURCE_LIMIT,
      outputLimit: OUTPUT_LIMIT,
      maxEdges: EDGES_LIMIT,
    })

    rememberSvg(cacheKey, svg)

    return { svg: applyIdPrefix(svg, options.idPrefix) }
  } catch (exception) {
    return { error: toRenderError(exception) }
  }
}

export function useDiagramRenderer() {
  return { renderDiagram }
}

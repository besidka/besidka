import type { DiagramRenderError } from '~/types/diagram.d'

type PeleModule = typeof import('pele/lazy')

export const DIAGRAM_FONT_NAME: string = 'Nunito'
export const DIAGRAM_FONT_MONO_NAME: string = 'Atkinson Hyperlegible Mono'
export const DIAGRAM_CACHED_ID_PREFIX: string = 'diagram-render-cache-prefix'

const FONT_FAMILY: string = `'${DIAGRAM_FONT_NAME}', sans-serif`
const FONT_FAMILY_MONO: string = `'${DIAGRAM_FONT_MONO_NAME}', monospace`
const SOURCE_LIMIT: number = 20_000
const OUTPUT_LIMIT: number = 1_000_000
const EDGES_LIMIT: number = 500
const DIRECTION_BREAKPOINT: number = 480

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

export function toPositiveDiagramNumber(value: unknown): number | undefined {
  return typeof value === 'number' && value > 0 ? value : undefined
}

export function toDiagramRenderError(exception: unknown): DiagramRenderError {
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
    line: toPositiveDiagramNumber(position.line),
    column: toPositiveDiagramNumber(position.column),
  }
}

function detectDiagramType(
  pele: PeleModule,
  source: string,
): ReturnType<PeleModule['detectType']> {
  try {
    return pele.detectType(source)
  } catch {
    return null
  }
}

/**
 * Loads the Pele module and the chunk for the source's diagram type so the
 * render that follows only does synchronous layout work.
 */
export async function prepareDiagramRender(source: string): Promise<void> {
  const pele = await loadPele()

  await pele.load(detectDiagramType(pele, source))
}

/**
 * Renders a diagram to an svg string whose ids use the placeholder
 * `DIAGRAM_CACHED_ID_PREFIX`. Throws on any failure; callers map the
 * exception with `toDiagramRenderError`. Runs unchanged on the main thread
 * and inside the diagram worker.
 */
export async function renderDiagramSvg(
  source: string,
  maxWidth: number | undefined,
): Promise<string> {
  const pele = await loadPele()

  await waitForFonts()

  const { svg } = await pele.renderAsync(source, {
    idPrefix: DIAGRAM_CACHED_ID_PREFIX,
    maxWidth,
    fontFamily: FONT_FAMILY,
    fontFamilyMono: FONT_FAMILY_MONO,
    images: false,
    links: false,
    limit: SOURCE_LIMIT,
    outputLimit: OUTPUT_LIMIT,
    maxEdges: EDGES_LIMIT,
    directionBreakpoint: DIRECTION_BREAKPOINT,
  })

  return svg
}

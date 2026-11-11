import {
  DIAGRAM_FONT_MONO_NAME,
  DIAGRAM_FONT_NAME,
  DIAGRAM_RENDER_OPTIONS,
} from '@besidka/artifacts-protocol/diagram-render'
import type { DiagramRenderError } from '~/types/diagram.d'

type PeleModule = typeof import('pele/lazy')

export { DIAGRAM_FONT_MONO_NAME, DIAGRAM_FONT_NAME }
export const DIAGRAM_CACHED_ID_PREFIX: string = 'diagram-render-cache-prefix'

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
    ...DIAGRAM_RENDER_OPTIONS,
    idPrefix: DIAGRAM_CACHED_ID_PREFIX,
    maxWidth,
  })

  return svg
}

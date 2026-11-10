import {
  DIAGRAM_FONT_NAME,
  DIAGRAM_RENDER_OPTIONS,
  DIAGRAM_SVG_SANITIZE_CONFIG,
  detectMermaidLimit,
} from '@besidka/artifacts-protocol'
import DOMPurify from 'dompurify'
import type { RenderOptions } from 'pele/lazy'
import { NUNITO_FONT_FACES, renderFontFaces } from '../design/fonts.ts'
import { DiagramLimitError } from './diagram-limit.ts'

type PeleModule = typeof import('pele/lazy')

const FONT_STYLE_ID = 'besidka-diagram-fonts'

const FONT_WEIGHTS = [400, 700] as const

const FONT_SAMPLE_SIZE = 16

let peleModulePromise: Promise<PeleModule> | null = null
let diagramCount = 0

async function loadPele(): Promise<PeleModule> {
  peleModulePromise ??= import('pele/lazy')

  try {
    return await peleModulePromise
  } catch (exception) {
    peleModulePromise = null

    throw exception
  }
}

function installFontFaces() {
  if (document.getElementById(FONT_STYLE_ID)) {
    return
  }

  const style = document.createElement('style')

  style.id = FONT_STYLE_ID
  style.textContent = renderFontFaces(NUNITO_FONT_FACES)
  document.head.append(style)
}

/**
 * Pele measures text on a canvas, which falls back to a system font until
 * the face has loaded, so labels would be boxed with the wrong metrics. The
 * faces are declared in the document (a shadow root cannot declare them) and
 * the subsets the source needs are loaded before the layout runs.
 */
async function loadDiagramFonts(source: string) {
  installFontFaces()

  try {
    await Promise.all(FONT_WEIGHTS.map((weight) => {
      return document.fonts?.load(
        `${weight} ${FONT_SAMPLE_SIZE}px '${DIAGRAM_FONT_NAME}'`,
        source,
      )
    }))
  } catch {
    return
  }
}

export function toPeleOptions(maxWidth: number | undefined): RenderOptions {
  diagramCount += 1

  return {
    ...DIAGRAM_RENDER_OPTIONS,
    idPrefix: `besidka-diagram-${diagramCount}`,
    maxWidth,
  }
}

/**
 * The same renderer, options and sanitizer as the chat's diagram blocks, so
 * a diagram has the same layout in a Mermaid artifact and in the chat. Throws
 * the renderer's own error (with `line` and `column` for a syntax error), or a
 * `DiagramLimitError` for a source over the shared limits.
 */
export async function renderDiagramSvg(
  source: string,
  maxWidth: number | undefined,
): Promise<string> {
  const sizeLimit = detectMermaidLimit('', source)

  if (sizeLimit) {
    throw new DiagramLimitError(
      sizeLimit,
      `Diagram source is ${source.length} characters.`,
    )
  }

  const pele = await loadPele()

  await loadDiagramFonts(source)

  try {
    const { svg } = await pele.renderAsync(source, toPeleOptions(maxWidth))

    return DOMPurify.sanitize(svg, DIAGRAM_SVG_SANITIZE_CONFIG)
  } catch (exception) {
    const message = exception instanceof Error
      ? exception.message
      : String(exception)
    const edgeLimit = detectMermaidLimit(message, source)

    if (edgeLimit) {
      throw new DiagramLimitError(edgeLimit, message)
    }

    throw exception
  }
}

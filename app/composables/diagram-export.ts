import type {
  DiagramExportAction,
  DiagramExportInput,
} from '~/types/diagram-export.d'
import {
  createColorContext,
  createColorConverter,
  toOpaqueColor,
} from '~/utils/diagram-export-color'
import {
  buildDrawioClipboardXml,
  buildDrawioFile,
  buildMermaidMarkdown,
} from '~/utils/diagram-export-drawio'
import { buildEmbeddedFontCss } from '~/utils/diagram-export-fonts'
import { svgToPngBlob } from '~/utils/diagram-export-png'
import {
  collectSvgVariableNames,
  finalizeStandaloneSvg,
  flattenSvgVariables,
  parseSvgDocument,
  readSvgDimensions,
} from '~/utils/diagram-export-svg'
import { resolveThemeVariables } from '~/utils/diagram-export-theme'

const PAGE_BACKGROUND_VARIABLE: string = '--color-base-100'
const BACKGROUND_VARIABLES: string[] = [
  '--pele-bg',
  '--_bg',
  PAGE_BACKGROUND_VARIABLE,
]
const LIGHT_PAGE_BACKGROUND: string = '#ffffff'
const DARK_PAGE_BACKGROUND: string = '#292524'
const DARK_COLOR_SCHEME_QUERY: string = '(prefers-color-scheme: dark)'
const FALLBACK_DIMENSIONS = { width: 800, height: 600 }
const SVG_MIME_TYPE: string = 'image/svg+xml'
const DRAWIO_MIME_TYPE: string = 'application/vnd.jgraph.mxfile'
const DOWNLOAD_REVOKE_DELAY_MS: number = 4000
const DOWNLOAD_FILE_NAMES: Partial<Record<DiagramExportAction, string>> = {
  'download-svg': 'diagram.svg',
  'download-png': 'diagram.png',
  'download-drawio': 'diagram.drawio',
}

function isDarkTheme(themeElement: HTMLElement): boolean {
  const themeName = themeElement
    .closest('[data-theme]')
    ?.getAttribute('data-theme')

  if (themeName) {
    return themeName === 'dark'
  }

  return window.matchMedia?.(DARK_COLOR_SCHEME_QUERY)?.matches ?? false
}

/**
 * Picks an always-opaque export background: the resolved diagram background,
 * composited over the resolved page background when it is translucent, which
 * itself falls back to white (light) or the dark base when unresolved.
 */
function resolveOpaqueBackground(
  resolved: Map<string, string>,
  themeElement: HTMLElement,
): string {
  const defaultBackdrop = isDarkTheme(themeElement)
    ? DARK_PAGE_BACKGROUND
    : LIGHT_PAGE_BACKGROUND
  const pageBackground
    = toOpaqueColor(resolved.get(PAGE_BACKGROUND_VARIABLE), defaultBackdrop)
      ?? defaultBackdrop

  return toOpaqueColor(
    resolved.get('--pele-bg') ?? resolved.get('--_bg'),
    pageBackground,
  ) ?? pageBackground
}

/**
 * Flattens every `var()` of the pristine Pele svg against the theme's
 * computed values, so the result renders identically with no stylesheet:
 * copied, downloaded, opened as an `<img>`, rasterized or imported into
 * draw.io. The pristine markup is required because the viewer's zoomed DOM
 * carries transforms and a re-rendered prefix.
 */
async function buildStandaloneSvg(input: DiagramExportInput): Promise<string> {
  const root = parseSvgDocument(input.svg)
  const names = Array.from(new Set([
    ...collectSvgVariableNames(root),
    ...BACKGROUND_VARIABLES,
  ]))
  const resolved = resolveThemeVariables(
    root,
    input.themeElement,
    names,
    createColorConverter(createColorContext()),
  )

  flattenSvgVariables(root, name => resolved.get(name))

  const flattened = new XMLSerializer().serializeToString(root)
  const background = resolveOpaqueBackground(resolved, input.themeElement)
  const fontFaceCss = await buildEmbeddedFontCss(
    flattened,
    document.styleSheets,
    window.location.href,
  )

  return finalizeStandaloneSvg(flattened, { background, fontFaceCss })
}

function createTextBlob(text: string, type: string): Blob {
  return new Blob([text], { type })
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()

  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, DOWNLOAD_REVOKE_DELAY_MS)
}

async function writeTextFallback(
  textPromise: Promise<string>,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(await textPromise)

    return true
  } catch {
    return false
  }
}

function canWriteClipboardItems(): boolean {
  return typeof ClipboardItem !== 'undefined'
    && typeof navigator.clipboard?.write === 'function'
}

/**
 * Starts the clipboard write synchronously: the `ClipboardItem` is built
 * and handed to `clipboard.write` before any `await`, with Promise-valued
 * blobs doing the async work, because Safari only honors the click's user
 * activation for the call itself. Browsers without `ClipboardItem` fall
 * back to `writeText` once the text is built.
 */
function copyText(
  textPromise: Promise<string>,
  svgPromise?: Promise<string>,
): Promise<boolean> {
  if (!canWriteClipboardItems()) {
    return writeTextFallback(textPromise)
  }

  const items: Record<string, Promise<Blob>> = {
    'text/plain': textPromise.then(text => createTextBlob(text, 'text/plain')),
  }

  if (svgPromise && ClipboardItem.supports?.(SVG_MIME_TYPE)) {
    items[SVG_MIME_TYPE] = svgPromise.then((svg) => {
      return createTextBlob(svg, SVG_MIME_TYPE)
    })
  }

  try {
    return navigator.clipboard
      .write([new ClipboardItem(items)])
      .then(() => true, () => writeTextFallback(textPromise))
  } catch {
    return writeTextFallback(textPromise)
  }
}

async function buildDrawioDocument(
  input: DiagramExportInput,
  build: typeof buildDrawioFile,
): Promise<string> {
  const svg = await buildStandaloneSvg(input)
  const { width, height } = readSvgDimensions(svg) ?? FALLBACK_DIMENSIONS

  return build(input.source, svg, width, height)
}

async function download(
  action: DiagramExportAction,
  buildBlob: () => Promise<Blob>,
): Promise<boolean> {
  try {
    triggerDownload(await buildBlob(), DOWNLOAD_FILE_NAMES[action] ?? action)

    return true
  } catch {
    return false
  }
}

function runExportAction(
  action: DiagramExportAction,
  input: DiagramExportInput,
): boolean | Promise<boolean> {
  try {
    switch (action) {
      case 'copy-svg': {
        const svgPromise = buildStandaloneSvg(input)

        return copyText(svgPromise, svgPromise)
      }
      case 'copy-markdown':
        return copyText(Promise.resolve(buildMermaidMarkdown(input.source)))
      case 'copy-drawio':
        return copyText(buildDrawioDocument(input, buildDrawioClipboardXml))
      case 'download-svg':
        return download(action, async () => {
          return createTextBlob(
            await buildStandaloneSvg(input),
            `${SVG_MIME_TYPE};charset=utf-8`,
          )
        })
      case 'download-png':
        return download(action, async () => {
          return svgToPngBlob(await buildStandaloneSvg(input))
        })
      case 'download-drawio':
        return download(action, async () => {
          return createTextBlob(
            await buildDrawioDocument(input, buildDrawioFile),
            DRAWIO_MIME_TYPE,
          )
        })
      default:
        return false
    }
  } catch {
    return false
  }
}

export function useDiagramExport() {
  return {
    buildStandaloneSvg,
    svgToPngBlob,
    buildMarkdown: buildMermaidMarkdown,
    buildDrawioFile,
    buildDrawioClipboardXml,
    runExportAction,
  }
}

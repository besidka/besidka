import type {
  DiagramFontDescriptor,
  DiagramWorkerRequest,
  DiagramWorkerResponse,
} from '~/types/diagram.d'
import {
  prepareDiagramRender,
  renderDiagramSvg,
  toDiagramRenderError,
} from '~/utils/diagram-render-core'
import { selectNeededFonts } from '~/utils/diagram-fonts'

interface DiagramWorkerScope {
  fonts?: FontFaceSet
  postMessage: (response: DiagramWorkerResponse) => void
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<DiagramWorkerRequest>) => void,
  ) => void
}

const scope = self as unknown as DiagramWorkerScope
const loadedFontKeys = new Set<string>()

async function loadFont(descriptor: DiagramFontDescriptor): Promise<void> {
  try {
    const face = new FontFace(descriptor.family, descriptor.src, {
      weight: descriptor.weight,
      style: descriptor.style,
      unicodeRange: descriptor.unicodeRange,
    })

    await face.load()

    scope.fonts?.add(face)
    loadedFontKeys.add(JSON.stringify(descriptor))
  } catch {
    return
  }
}

async function loadFonts(
  fonts: DiagramFontDescriptor[],
  source: string,
): Promise<void> {
  if (!scope.fonts || typeof FontFace === 'undefined') {
    return
  }

  const pendingFonts = selectNeededFonts(fonts, source).filter((descriptor) => {
    return !loadedFontKeys.has(JSON.stringify(descriptor))
  })

  await Promise.all(pendingFonts.map(loadFont))
}

async function handleRequest(request: DiagramWorkerRequest): Promise<void> {
  try {
    await Promise.all([
      prepareDiagramRender(request.source),
      loadFonts(request.fonts, request.source),
    ])

    scope.postMessage({ id: request.id, status: 'ready' })

    const svg = await renderDiagramSvg(
      request.source,
      request.options.maxWidth,
    )

    scope.postMessage({ id: request.id, svg })
  } catch (exception) {
    scope.postMessage({
      id: request.id,
      error: toDiagramRenderError(exception),
    })
  }
}

scope.addEventListener('message', (event) => {
  handleRequest(event.data)
})

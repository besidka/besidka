import type { DiagramPngOptions } from '~/types/diagram-export.d'
import { readSvgDimensions } from '~/utils/diagram-export-svg'

export const DIAGRAM_PNG_MAX_PIXELS: number = 16_000_000
export const DIAGRAM_PNG_MAX_SIDE: number = 16_384
export const DIAGRAM_PNG_DEFAULT_SCALE: number = 2

export function computeRasterScale(
  width: number,
  height: number,
  requestedScale: number,
  maxPixels: number,
  maxSide: number = DIAGRAM_PNG_MAX_SIDE,
): number {
  const pixelBudgetScale = Math.sqrt(maxPixels / (width * height))
  const sideBudgetScale = maxSide / Math.max(width, height)

  return Math.min(requestedScale, pixelBudgetScale, sideBudgetScale)
}

function loadSvgImage(svg: string, url: string): Promise<HTMLImageElement> {
  const image = new Image()

  image.src = url

  return image.decode().then(() => image, () => {
    throw new Error(
      `The browser could not rasterize the diagram svg (${svg.length} bytes)`,
    )
  })
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)

        return
      }

      reject(new Error('The browser could not encode the diagram as PNG'))
    }, 'image/png')
  })
}

export async function svgToPngBlob(
  svg: string,
  options: DiagramPngOptions = {},
): Promise<Blob> {
  const dimensions = readSvgDimensions(svg)

  if (!dimensions) {
    throw new Error('The diagram svg has no usable size')
  }

  const scale = computeRasterScale(
    dimensions.width,
    dimensions.height,
    options.scale ?? DIAGRAM_PNG_DEFAULT_SCALE,
    options.maxPixels ?? DIAGRAM_PNG_MAX_PIXELS,
  )
  const url = URL.createObjectURL(
    new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }),
  )

  try {
    const image = await loadSvgImage(svg, url)
    const canvas = document.createElement('canvas')

    canvas.width = Math.max(1, Math.floor(dimensions.width * scale))
    canvas.height = Math.max(1, Math.floor(dimensions.height * scale))

    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('The browser could not create a canvas for the diagram')
    }

    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    return await canvasToPngBlob(canvas)
  } finally {
    URL.revokeObjectURL(url)
  }
}

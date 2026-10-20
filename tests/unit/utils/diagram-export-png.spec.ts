import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DIAGRAM_PNG_MAX_SIDE,
  computeRasterScale,
  svgToPngBlob,
} from '~/utils/diagram-export-png'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"'
  + ' viewBox="0 0 400 200"></svg>'

interface CanvasState {
  width: number
  height: number
  drawn: unknown[]
}

function stubRasterization(options: {
  decodeFails?: boolean
  blob?: Blob | null
  context?: boolean
} = {}) {
  const state: CanvasState = { width: 0, height: 0, drawn: [] }
  const revoke = vi.fn()
  const imageInstances: { src: string }[] = []

  class FakeImage {
    src = ''

    constructor() {
      imageInstances.push(this)
    }

    async decode() {
      if (options.decodeFails) {
        throw new Error('decode failed')
      }
    }
  }

  const canvas = {
    get width() {
      return state.width
    },
    set width(value: number) {
      state.width = value
    },
    get height() {
      return state.height
    },
    set height(value: number) {
      state.height = value
    },
    getContext: () => options.context === false
      ? null
      : { drawImage: (...args: unknown[]) => state.drawn.push(args) },
    toBlob: (callback: (blob: Blob | null) => void, type: string) => {
      callback(options.blob === undefined
        ? new Blob(['png'], { type })
        : options.blob)
    },
  }
  const originalCreateElement = document.createElement.bind(document)

  vi.stubGlobal('Image', FakeImage)
  vi.spyOn(document, 'createElement').mockImplementation(
    ((tag: string) => tag === 'canvas'
      ? canvas
      : originalCreateElement(tag)) as typeof document.createElement,
  )
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:svg')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revoke)

  return { state, revoke, imageInstances }
}

describe('utils/diagram-export-png', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('keeps the requested scale while under the pixel budget', () => {
    expect(computeRasterScale(400, 200, 2, 16_000_000)).toBe(2)
  })

  it('clamps the scale so width x height x scale^2 stays in budget', () => {
    const scale = computeRasterScale(4000, 4000, 2, 16_000_000)

    expect(scale).toBeCloseTo(1)
    expect(4000 * 4000 * scale * scale).toBeLessThanOrEqual(16_000_001)
  })

  it('clamps the scale so no side exceeds the maximum side length', () => {
    const scale = computeRasterScale(40_000, 100, 2, 16_000_000)

    expect(scale).toBeCloseTo(DIAGRAM_PNG_MAX_SIDE / 40_000)
    expect(40_000 * scale).toBeLessThanOrEqual(DIAGRAM_PNG_MAX_SIDE)
  })

  it('applies the stricter of the pixel and side budgets', () => {
    expect(computeRasterScale(8000, 8000, 2, 16_000_000)).toBeCloseTo(0.5)
    expect(computeRasterScale(20_000, 10, 2, 16_000_000))
      .toBeCloseTo(DIAGRAM_PNG_MAX_SIDE / 20_000)
  })

  it('defaults to a fixed 2x regardless of devicePixelRatio', async () => {
    for (const devicePixelRatio of [1, 3]) {
      vi.stubGlobal('devicePixelRatio', devicePixelRatio)

      const { state } = stubRasterization()

      await svgToPngBlob(SVG)

      expect(state.width).toBe(800)
      expect(state.height).toBe(400)
    }
  })

  it('keeps each canvas side within the maximum for a very wide svg', async () => {
    const { state } = stubRasterization()
    const wideSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="40000"'
      + ' height="100" viewBox="0 0 40000 100"></svg>'

    await svgToPngBlob(wideSvg)

    expect(state.width).toBeLessThanOrEqual(DIAGRAM_PNG_MAX_SIDE)
    expect(state.height).toBeLessThanOrEqual(DIAGRAM_PNG_MAX_SIDE)
  })

  it('rasterizes through a blob url, the decoded image and a canvas', async () => {
    const { state, revoke, imageInstances } = stubRasterization()

    const blob = await svgToPngBlob(SVG, { scale: 2 })

    expect(blob.type).toBe('image/png')
    expect(imageInstances[0]?.src).toBe('blob:svg')
    expect(state.width).toBe(800)
    expect(state.height).toBe(400)
    expect(state.drawn).toHaveLength(1)
    expect(revoke).toHaveBeenCalledWith('blob:svg')
  })

  it('clamps the canvas to maxPixels', async () => {
    const { state } = stubRasterization()

    await svgToPngBlob(SVG, { scale: 4, maxPixels: 80_000 })

    expect(state.width * state.height).toBeLessThanOrEqual(80_000)
  })

  it('rejects with a clear message when decoding fails and still revokes', async () => {
    const { revoke } = stubRasterization({ decodeFails: true })

    await expect(svgToPngBlob(SVG)).rejects.toThrow(/could not rasterize/)
    expect(revoke).toHaveBeenCalledWith('blob:svg')
  })

  it('rejects when the canvas cannot encode a PNG', async () => {
    stubRasterization({ blob: null })

    await expect(svgToPngBlob(SVG)).rejects.toThrow(/encode the diagram/)
  })

  it('rejects when no 2d context is available', async () => {
    stubRasterization({ context: false })

    await expect(svgToPngBlob(SVG)).rejects.toThrow(/canvas/)
  })

  it('rejects an svg without a usable size', async () => {
    stubRasterization()

    await expect(svgToPngBlob('<svg xmlns="http://www.w3.org/2000/svg"/>'))
      .rejects.toThrow(/usable size/)
  })
})

import { Input, UrlSource, MP4, CanvasSink } from 'mediabunny'

/**
 * Generates a timeline hover-preview thumbnail sprite for the demo player.
 *
 * Primary path uses mediabunny: it streams the video from R2 via HTTP range
 * requests (UrlSource) and decodes sparse frames with CanvasSink over
 * WebCodecs — no full download, no FFmpeg. Frames are composited into one
 * sprite canvas exposed as an object URL.
 *
 * The player renders its own hover overlay from this sprite (background-image
 * + background-position) rather than using Plyr's `previewThumbnails`, because
 * Plyr concatenates a path prefix onto non-http(s) image URLs, which breaks
 * `blob:` sprites generated on the client.
 *
 * If mediabunny/WebCodecs is unavailable it falls back to seeking a hidden
 * <video> element; if both fail the player renders without hover previews.
 */

/** A generated sprite plus the geometry needed to map time -> tile. */
export interface ThumbnailSprite {
  /** Object URL of the sprite image. */
  url: string
  /** Tile (single frame) width in pixels. */
  tileWidth: number
  /** Tile height in pixels. */
  tileHeight: number
  /** Number of tile columns in the sprite grid. */
  columns: number
  /** Total number of tiles. */
  count: number
  /** Source duration in seconds. */
  duration: number
  /** Revoke the sprite object URL on teardown. */
  cleanup: () => void
}

interface GenerateOptions {
  count?: number
  width?: number
  height?: number
}

interface SpriteData {
  url: string
  columns: number
  duration: number
}

const DEFAULT_COUNT = 12
const DEFAULT_WIDTH = 160
const DEFAULT_HEIGHT = 90
const JPEG_QUALITY = 0.62
const SPRITE_COLUMNS = 4

function createCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas')

  canvas.width = width
  canvas.height = height

  return { canvas, context: canvas.getContext('2d') }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      return resolve(blob)
    }, 'image/jpeg', JPEG_QUALITY)
  })
}

function spriteColumns(count: number): number {
  return Math.min(count, SPRITE_COLUMNS)
}

/** Build the timestamp at the middle of each evenly sized segment. */
function buildTimestamps(duration: number, count: number): number[] {
  const step = duration / count

  return Array.from({ length: count }, (_value, index) => {
    return Math.min(duration - 0.001, index * step + step / 2)
  })
}

/** Seek a video element to `time` and resolve once the frame is ready. */
function seekVideo(video: HTMLVideoElement, time: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      cleanup()
      resolve(false)
    }, 3000)

    function onSeeked() {
      cleanup()
      resolve(true)
    }

    function onError() {
      cleanup()
      resolve(false)
    }

    function cleanup() {
      clearTimeout(timeout)
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
    }

    video.addEventListener('seeked', onSeeked, { once: true })
    video.addEventListener('error', onError, { once: true })
    video.currentTime = time
  })
}

function tilePosition(
  index: number,
  columns: number,
  width: number,
  height: number,
) {
  return {
    x: (index % columns) * width,
    y: Math.floor(index / columns) * height,
  }
}

async function generateViaMediabunny(
  videoUrl: string,
  count: number,
  width: number,
  height: number,
): Promise<SpriteData | null> {
  const input = new Input({ source: new UrlSource(videoUrl), formats: [MP4] })

  try {
    const videoTrack = await input.getPrimaryVideoTrack()

    if (!videoTrack) {
      return null
    }

    const duration = await input.getDurationFromMetadata()

    if (!duration || duration <= 0) {
      return null
    }

    const columns = spriteColumns(count)
    const rows = Math.ceil(count / columns)
    const { canvas, context } = createCanvas(columns * width, rows * height)

    if (!context) {
      return null
    }

    const sink = new CanvasSink(videoTrack, {
      width,
      height,
      fit: 'cover',
      poolSize: 1,
    })

    let index = 0
    let drawn = 0

    for await (const wrapped of sink.canvasesAtTimestamps(
      buildTimestamps(duration, count),
    )) {
      const current = index

      index += 1

      if (!wrapped) {
        continue
      }

      const { x, y } = tilePosition(current, columns, width, height)

      context.drawImage(wrapped.canvas, x, y, width, height)
      drawn += 1
    }

    if (!drawn) {
      return null
    }

    const blob = await canvasToBlob(canvas)

    if (!blob) {
      return null
    }

    return { url: URL.createObjectURL(blob), columns, duration }
  } finally {
    input.dispose()
  }
}

function generateViaVideoElement(
  videoUrl: string,
  count: number,
  width: number,
  height: number,
): Promise<SpriteData | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video')

    video.preload = 'metadata'
    video.muted = true
    video.crossOrigin = 'anonymous'

    function teardown() {
      video.removeAttribute('src')
      video.load()
    }

    video.addEventListener('error', () => {
      teardown()
      resolve(null)
    }, { once: true })

    video.addEventListener('loadedmetadata', async () => {
      const duration = video.duration
      const columns = spriteColumns(count)
      const rows = Math.ceil(count / columns)
      const { canvas, context } = createCanvas(columns * width, rows * height)

      if (!context || !Number.isFinite(duration) || duration <= 0) {
        teardown()
        resolve(null)

        return
      }

      const step = duration / count
      let drawn = 0

      for (let index = 0; index < count; index += 1) {
        const time = Math.min(duration - 0.05, index * step + step / 2)
        const seeked = await seekVideo(video, time)

        if (!seeked) {
          continue
        }

        const { x, y } = tilePosition(index, columns, width, height)

        context.drawImage(video, x, y, width, height)
        drawn += 1
      }

      teardown()

      if (!drawn) {
        resolve(null)

        return
      }

      const blob = await canvasToBlob(canvas)

      if (!blob) {
        resolve(null)

        return
      }

      resolve({ url: URL.createObjectURL(blob), columns, duration })
    }, { once: true })

    video.src = videoUrl
  })
}

export function useLandingVideoThumbnails() {
  async function generate(
    videoUrl: string,
    options: GenerateOptions = {},
  ): Promise<ThumbnailSprite | null> {
    if (import.meta.server) {
      return null
    }

    const count = options.count ?? DEFAULT_COUNT
    const width = options.width ?? DEFAULT_WIDTH
    const height = options.height ?? DEFAULT_HEIGHT

    // Workers resolve relative URLs against the worker script, not the page,
    // so mediabunny's UrlSource needs an absolute URL.
    const absoluteUrl = new URL(videoUrl, window.location.href).href

    let data: SpriteData | null = null

    try {
      data = await generateViaMediabunny(absoluteUrl, count, width, height)
    } catch {
      data = null
    }

    if (!data) {
      try {
        data = await generateViaVideoElement(absoluteUrl, count, width, height)
      } catch {
        data = null
      }
    }

    if (!data) {
      return null
    }

    const { url, columns, duration } = data

    return {
      url,
      tileWidth: width,
      tileHeight: height,
      columns,
      count,
      duration,
      cleanup: () => {
        return URL.revokeObjectURL(url)
      },
    }
  }

  return { generate }
}

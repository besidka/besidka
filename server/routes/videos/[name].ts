import { useLogger, createError } from 'evlog'
import { parseRangeHeader } from '~~/server/utils/landing/video'

// @ts-ignore
import { env } from 'cloudflare:workers'

const ALLOWED_VIDEOS = new Set(['demo.mp4'])

export default defineEventHandler(async (event) => {
  const { name } = getRouterParams(event) as { name: string }

  if (!ALLOWED_VIDEOS.has(name)) {
    throw createError({
      status: 404,
      message: 'Video not found',
    })
  }

  const { R2_LANDING } = env

  if (!R2_LANDING) {
    throw createError({
      status: 503,
      message: 'Video storage unavailable',
    })
  }

  const ifNoneMatch = getRequestHeader(event, 'if-none-match')
  const rangeHeader = getRequestHeader(event, 'range')
  const method = event.method

  const headObject = await R2_LANDING.head(name)

  if (!headObject) {
    throw createError({
      status: 404,
      message: 'Video not found',
    })
  }

  const etag = headObject.httpEtag
  const size = headObject.size

  if (ifNoneMatch && ifNoneMatch === etag) {
    setResponseStatus(event, 304)

    return null
  }

  const rangeResult = parseRangeHeader(rangeHeader, size)

  if (rangeResult === 'invalid') {
    setResponseHeaders(event, {
      'Content-Range': `bytes */${size}`,
    })
    throw createError({
      status: 416,
      message: 'Range Not Satisfiable',
    })
  }

  const isRangeRequest = rangeResult !== null

  const commonHeaders: Record<string, string> = {
    'Content-Type': 'video/mp4',
    'ETag': etag,
    'Cache-Control': 'public, max-age=86400',
    'Accept-Ranges': 'bytes',
  }

  if (isRangeRequest) {
    const { offset, length, end } = rangeResult

    commonHeaders['Content-Length'] = String(length)
    commonHeaders['Content-Range'] = `bytes ${offset}-${end}/${size}`

    setResponseHeaders(event, commonHeaders)
    setResponseStatus(event, 206)

    if (method === 'HEAD') {
      return null
    }

    const object = await R2_LANDING.get(name, {
      range: { offset, length },
    })

    if (!object) {
      const logger = useLogger(event)

      logger.set({
        video: {
          name,
          error: 'Object disappeared between head and range get',
        },
      })
      throw createError({
        status: 404,
        message: 'Video not found',
      })
    }

    return object.body
  }

  commonHeaders['Content-Length'] = String(size)

  setResponseHeaders(event, commonHeaders)
  setResponseStatus(event, 200)

  if (method === 'HEAD') {
    return null
  }

  const object = await R2_LANDING.get(name)

  if (!object) {
    const logger = useLogger(event)

    logger.set({
      video: {
        name,
        error: 'Object disappeared between head and full get',
      },
    })
    throw createError({
      status: 404,
      message: 'Video not found',
    })
  }

  return object.body
})

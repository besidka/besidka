import { createError } from 'evlog'
import { parseRangeHeader } from '~~/server/utils/landing/video'

// @ts-ignore
import { env } from 'cloudflare:workers'
import {
  defineEventHandler,
  getRequestHeader,
  setResponseStatus,
} from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const ALLOWED_FILES = new Set([
  'demo.mp4',
  'demo-360.mp4',
  'demo-1080.mp4',
  'demo.en.vtt',
])

function resolveContentType(name: string): string {
  if (name.endsWith('.vtt')) {
    return 'text/vtt; charset=utf-8'
  }

  return 'video/mp4'
}

export default defineEventHandler(async (event) => {
  const { name } = getDecodedRouterParams(event) as { name: string }

  if (!ALLOWED_FILES.has(name)) {
    throw createError({
      status: 404,
      message: 'Video not found',
    })
  }

  const { CMS_BUCKET } = env

  if (!CMS_BUCKET) {
    throw createError({
      status: 503,
      message: 'Video storage unavailable',
    })
  }

  const ifNoneMatch = getRequestHeader(event, 'if-none-match')
  const rangeHeader = getRequestHeader(event, 'range')
  const method = event.req.method

  const headObject = await CMS_BUCKET.head(name)

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
    applyResponseHeaders(event, {
      'Content-Range': `bytes */${size}`,
    })
    throw createError({
      status: 416,
      message: 'Range Not Satisfiable',
    })
  }

  const isRangeRequest = rangeResult !== null

  const commonHeaders: Record<string, string> = {
    'Content-Type': resolveContentType(name),
    'ETag': etag,
    'Cache-Control': 'public, max-age=86400',
    'Accept-Ranges': 'bytes',
  }

  if (isRangeRequest) {
    const { offset, length, end } = rangeResult

    commonHeaders['Content-Length'] = String(length)
    commonHeaders['Content-Range'] = `bytes ${offset}-${end}/${size}`

    applyResponseHeaders(event, commonHeaders)
    setResponseStatus(event, 206)

    if (method === 'HEAD') {
      return null
    }

    const object = await CMS_BUCKET.get(name, {
      range: { offset, length },
    })

    if (!object) {
      const logger = useRequestLogger(event)

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

  applyResponseHeaders(event, commonHeaders)
  setResponseStatus(event, 200)

  if (method === 'HEAD') {
    return null
  }

  const object = await CMS_BUCKET.get(name)

  if (!object) {
    const logger = useRequestLogger(event)

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

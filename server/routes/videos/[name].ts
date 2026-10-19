import { createError } from 'evlog'
import {
  parseRangeHeader,
  parseRangeSpec,
} from '~~/server/utils/landing/video'

// @ts-ignore
import { env } from 'cloudflare:workers'
import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

const ALLOWED_FILES = new Set([
  'demo.mp4',
  'demo-360.mp4',
  'demo-1080.mp4',
  'demo.en.vtt',
])

const ALLOWED_METHODS = 'GET, HEAD'
const CACHE_CONTROL = 'public, max-age=86400'
const NO_STORE = 'no-store'
const NOT_MODIFIED_VALIDATORS = ['if-none-match', 'if-modified-since']

function resolveContentType(name: string): string {
  if (name.endsWith('.vtt')) {
    return 'text/vtt; charset=utf-8'
  }

  return 'video/mp4'
}

function isRangeNotSatisfiable(exception: unknown): boolean {
  if (!(exception instanceof Error)) {
    return false
  }

  return /\(10039\)|range is not satisfiable/i.test(exception.message)
}

function isMalformedConditional(exception: unknown): boolean {
  if (!(exception instanceof Error)) {
    return false
  }

  return /\b(if-match|if-none-match|if-modified-since|if-unmodified-since)\b|invalid (etag|date)/i
    .test(exception.message)
}

function hasNotModifiedValidator(headers: Headers): boolean {
  return NOT_MODIFIED_VALIDATORS.some((header) => {
    return headers.has(header)
  })
}

function isIfMatchFailed(headers: Headers, httpEtag: string): boolean {
  const ifMatch = headers.get('if-match')

  if (ifMatch === null) {
    return false
  }

  return !ifMatch.split(',').some((candidate) => {
    const token = candidate.trim()

    return token === '*' || token === httpEtag
  })
}

function isIfUnmodifiedSinceFailed(
  headers: Headers,
  uploaded: Date,
): boolean {
  const ifUnmodifiedSince = headers.get('if-unmodified-since')

  if (ifUnmodifiedSince === null) {
    return false
  }

  const threshold = Date.parse(ifUnmodifiedSince)

  if (Number.isNaN(threshold)) {
    return false
  }

  return Math.floor(uploaded.getTime() / 1000) > Math.floor(threshold / 1000)
}

function toR2Range(rangeHeader: string | null): R2Range | undefined {
  const spec = parseRangeSpec(rangeHeader)

  if (!spec || spec === 'invalid') {
    return undefined
  }

  if (spec.kind === 'suffix') {
    return { suffix: spec.suffix }
  }

  if (spec.end === null) {
    return { offset: spec.start }
  }

  return { offset: spec.start, length: spec.end - spec.start + 1 }
}

function failure(
  event: Parameters<typeof applyResponseHeaders>[0],
  status: number,
  message: string,
  headers: Record<string, string> = {},
) {
  applyResponseHeaders(event, { 'Cache-Control': NO_STORE, ...headers })

  return createError({ status, message })
}

export default defineEventHandler(async (event) => {
  applyResponseHeaders(event, { 'X-Content-Type-Options': 'nosniff' })

  const method = event.req.method

  if (method !== 'GET' && method !== 'HEAD') {
    throw failure(event, 405, 'Method Not Allowed', {
      Allow: ALLOWED_METHODS,
    })
  }

  const { name } = getDecodedRouterParams(event) as { name: string }

  if (!ALLOWED_FILES.has(name)) {
    throw failure(event, 404, 'Video not found')
  }

  const { CMS_BUCKET } = env

  if (!CMS_BUCKET) {
    throw failure(event, 503, 'Video storage unavailable')
  }

  const requestHeaders = event.req.headers
  const rangeHeader = requestHeaders.get('range')
  const ifRange = requestHeaders.get('if-range')

  let isRangeSent = false

  async function readObject(range: R2Range | undefined) {
    try {
      const object = await CMS_BUCKET.get(name, {
        range,
        onlyIf: requestHeaders,
      })

      isRangeSent = range !== undefined

      return object
    } catch (exception) {
      if (isRangeNotSatisfiable(exception)) {
        const metadata = await CMS_BUCKET.head(name)
        const isStaleIfRange = range !== undefined
          && ifRange !== null
          && metadata !== null
          && ifRange !== metadata.httpEtag

        if (isStaleIfRange) {
          return readObject(undefined)
        }

        throw failure(event, 416, 'Range Not Satisfiable', metadata
          ? { 'Content-Range': `bytes */${metadata.size}` }
          : {})
      }

      if (isMalformedConditional(exception)) {
        throw failure(event, 400, 'Malformed conditional request header')
      }

      throw exception
    }
  }

  const firstRead = await readObject(toR2Range(rangeHeader))

  if (!firstRead) {
    throw failure(event, 404, 'Video not found')
  }

  if (!('body' in firstRead)) {
    if (
      isIfMatchFailed(requestHeaders, firstRead.httpEtag)
      || isIfUnmodifiedSinceFailed(requestHeaders, firstRead.uploaded)
      || !hasNotModifiedValidator(requestHeaders)
    ) {
      applyResponseHeaders(event, {
        'ETag': firstRead.httpEtag,
        'Cache-Control': NO_STORE,
      })
      setResponseStatus(event, 412)

      return null
    }

    applyResponseHeaders(event, {
      'ETag': firstRead.httpEtag,
      'Cache-Control': CACHE_CONTROL,
      'Accept-Ranges': 'bytes',
    })
    setResponseStatus(event, 304)

    return null
  }

  let object = firstRead

  const isRangeIgnored = rangeHeader !== null
    && ifRange !== null
    && ifRange !== object.httpEtag

  if (isRangeIgnored && isRangeSent) {
    await object.body.cancel()

    const fullObject = await readObject(undefined)

    if (!fullObject || !('body' in fullObject)) {
      throw failure(event, 404, 'Video not found')
    }

    object = fullObject
  }

  const rangeResult = isRangeIgnored
    ? null
    : parseRangeHeader(rangeHeader, object.size)

  if (rangeResult === 'invalid') {
    await object.body.cancel()

    throw failure(event, 416, 'Range Not Satisfiable', {
      'Content-Range': `bytes */${object.size}`,
    })
  }

  const headers: Record<string, string> = {
    'ETag': object.httpEtag,
    'Cache-Control': CACHE_CONTROL,
    'Accept-Ranges': 'bytes',
    'Content-Type': resolveContentType(name),
  }

  if (rangeResult) {
    headers['Content-Length'] = String(rangeResult.length)
    headers['Content-Range']
      = `bytes ${rangeResult.offset}-${rangeResult.end}/${object.size}`
  } else {
    headers['Content-Length'] = String(object.size)
  }

  const status = rangeResult ? 206 : 200

  applyResponseHeaders(event, headers)
  setResponseStatus(event, status)

  if (method === 'HEAD') {
    await object.body.cancel()

    return new Response(null, { status, headers })
  }

  return object.body
})

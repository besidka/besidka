import { createError, log } from 'evlog'
import { defineEventHandler, sendRedirect } from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import { isSafeSameOriginPath } from '#shared/utils/safe-redirect-path'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'

const STUDIO_ROUTE = '/_studio'
const STUDIO_API_PREFIX = '/__nuxt_studio'
const STUDIO_IPX_PREFIX = '/__nuxt_studio/ipx'
const STUDIO_REDIRECT_PARAM = 'redirect'
const EMPTY_STRING_MD5 = 'd41d8cd98f00b204e9800998ecf8427e'
const SCHEME_PREFIX = /^[\s\w\0+.-]{2,}:/
const PERCENT_ENCODED_BYTE = /%([0-9a-f]{2})/gi
const COLLAPSED_SCHEME_SLASH = /^(https?:\/)([^/])/

const IPX_RESPONSE_HEADERS = {
  'Content-Security-Policy': 'sandbox; default-src \'none\'',
  'X-Content-Type-Options': 'nosniff',
}

interface StudioRuntimeConfig {
  studio?: {
    auth?: {
      sessionSecret?: string
    }
  }
}

interface StudioGuardOptions {
  isDev: boolean
  readSessionSecret: () => unknown
}

let hasLoggedInsecureSecret = false

function isPrefixedPath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

function decodePathLeniently(pathname: string): string {
  return pathname.replace(PERCENT_ENCODED_BYTE, (_match, hex: string) => {
    return String.fromCharCode(Number.parseInt(hex, 16))
  })
}

function isStudioPath(pathname: string): boolean {
  return isPrefixedPath(pathname, STUDIO_ROUTE)
    || isPrefixedPath(pathname, STUDIO_API_PREFIX)
}

function isStudioRoute(pathname: string): boolean {
  return pathname === STUDIO_ROUTE || pathname === `${STUDIO_ROUTE}/`
}

export function isInsecureStudioSessionSecret(secret: unknown): boolean {
  return typeof secret !== 'string'
    || secret === ''
    || secret === EMPTY_STRING_MD5
}

export function extractIpxResourceId(pathname: string): string {
  const relativePath = pathname
    .slice(STUDIO_IPX_PREFIX.length)
    .replace(/^\/+/, '')
  const [, ...idSegments] = relativePath.split('/')

  return decodeURIComponent(idSegments.join('/'))
    .replace(COLLAPSED_SCHEME_SLASH, '$1/$2')
}

export function isRemoteIpxResourceId(id: string): boolean {
  const withoutLeadingSlashes = id.replace(/^[/\\]+/, '')

  return id.startsWith('//')
    || id.startsWith('\\')
    || SCHEME_PREFIX.test(id)
    || SCHEME_PREFIX.test(withoutLeadingSlashes)
}

function isRejectedIpxRequest(pathname: string): boolean {
  try {
    return isRemoteIpxResourceId(extractIpxResourceId(pathname))
  } catch {
    return true
  }
}

function hasUnsafeRedirectParam(event: RequestEvent): boolean {
  const redirects = event.url.searchParams.getAll(STUDIO_REDIRECT_PARAM)

  if (redirects.length === 0) {
    return false
  }

  if (redirects.length > 1) {
    return true
  }

  const [redirect] = redirects

  if (redirect === '') {
    return false
  }

  return !isSafeSameOriginPath(redirect, event.url.origin)
}

function logInsecureSecretOnce(): void {
  if (hasLoggedInsecureSecret) {
    return
  }

  hasLoggedInsecureSecret = true

  log.error({
    message: 'Nuxt Studio is disabled: session secret is the build-time default',
    why: 'runtimeConfig.studio.auth.sessionSecret is the md5 of an empty '
      + 'string because no STUDIO_* auth values were present at build time, '
      + 'so any studio-session cookie could be forged',
    fix: 'Set NUXT_STUDIO_AUTH_SESSION_SECRET to a long random value on the '
      + 'Worker',
    status: 404,
  })
}

function readRuntimeSessionSecret(): unknown {
  const { studio } = useRuntimeConfig() as StudioRuntimeConfig

  return studio?.auth?.sessionSecret
}

function assertSessionSecretIsSecure(readSessionSecret: () => unknown): void {
  if (!isInsecureStudioSessionSecret(readSessionSecret())) {
    return
  }

  logInsecureSecretOnce()

  throw createError({ message: 'Not found', status: 404 })
}

export function createStudioGuard(options: StudioGuardOptions) {
  return defineEventHandler((event) => {
    const candidatePaths = [
      ...new Set([event.url.pathname, decodePathLeniently(event.url.pathname)]),
    ]

    if (!candidatePaths.some(isStudioPath)) {
      return
    }

    if (!options.isDev) {
      assertSessionSecretIsSecure(options.readSessionSecret)
    }

    const ipxPaths = candidatePaths.filter((pathname) => {
      return isPrefixedPath(pathname, STUDIO_IPX_PREFIX)
    })

    if (ipxPaths.length > 0) {
      if (ipxPaths.some(isRejectedIpxRequest)) {
        throw createError({ message: 'Not found', status: 404 })
      }

      applyResponseHeaders(event, IPX_RESPONSE_HEADERS)

      return
    }

    if (candidatePaths.some(isStudioRoute) && hasUnsafeRedirectParam(event)) {
      return sendRedirect(event, STUDIO_ROUTE, 302)
    }
  })
}

export default createStudioGuard({
  isDev: import.meta.dev,
  readSessionSecret: readRuntimeSessionSecret,
})

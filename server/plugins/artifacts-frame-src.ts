import type { H3Event } from 'h3'
import type { RenderContext, RenderResponse } from 'nitropack/types'
import { buildArtifactFrameSrc } from '#shared/utils/artifact-frame-policy'

const CSP_HEADER = 'content-security-policy'
const FRAME_SRC = 'frame-src'
const NONE_SOURCE = '\'none\''
const ARTIFACT_PAGE_PREFIXES = ['/chats/', '/shared/', '/admin/']
const ARTIFACT_PAGE_EXACT_PATHS = ['/a']

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, context) => {
    applyArtifactFrameSrc(response, context, {
      artifactsOrigin: useRuntimeConfig(context.event).public.artifactsOrigin,
      eventPolicy: readEventPolicy(context.event),
    })
  })
})

function readEventPolicy(event: H3Event): string | undefined {
  try {
    const value = getResponseHeader(event, CSP_HEADER)

    return value === undefined ? undefined : String(value)
  } catch {
    return undefined
  }
}

export function isArtifactPagePath(path: string): boolean {
  const pathname = path.split('?')[0] ?? ''

  if (ARTIFACT_PAGE_EXACT_PATHS.includes(pathname)) {
    return true
  }

  return ARTIFACT_PAGE_PREFIXES.some((prefix) => {
    return pathname.startsWith(prefix)
  })
}

/**
 * Limits the frames of the chat and shared-chat documents (`frame-src`) to
 * `'self'`, the artifacts runtime origin and the Turnstile frame host, read
 * from runtime config on every response so previews that override
 * `NUXT_PUBLIC_ARTIFACTS_ORIGIN` get their own host. Without it a
 * self-navigating artifact leaks its URL before the frame tripwire removes it
 * (A-2). The policy stays with the document across client-side navigation,
 * so a shared-chat viewer who follows Sign in still reaches the captcha.
 * Documents loaded on other routes get the same directive as a meta tag
 * before their first artifact frame (`ensureArtifactFramePolicy`). An
 * existing policy is extended, never replaced: the renderer's own header,
 * or else the one a route rule already set on the event (`eventPolicy`,
 * for example `frame-ancestors 'none'` on `/a`), which the renderer
 * would otherwise overwrite.
 */
export function applyArtifactFrameSrc(
  response: Partial<RenderResponse>,
  context: Pick<RenderContext, 'event'>,
  options: { artifactsOrigin: unknown, eventPolicy?: string },
): void {
  if (!isArtifactPagePath(context.event.path)) {
    return
  }

  const directive = buildArtifactFrameSrc(options.artifactsOrigin)

  if (!directive) {
    return
  }

  const headers = response.headers || {}
  const existingName = Object.keys(headers).find((name) => {
    return name.toLowerCase() === CSP_HEADER
  })

  if (!existingName) {
    response.headers = {
      ...headers,
      [CSP_HEADER]: options.eventPolicy
        ? mergeFrameSrc(options.eventPolicy, directive)
        : directive,
    }

    return
  }

  response.headers = {
    ...headers,
    [existingName]: mergeFrameSrc(String(headers[existingName]), directive),
  }
}

/**
 * Adds the sources of `directive` to the `frame-src` of `policy`. Browsers
 * ignore a repeated directive, so an existing `frame-src` is extended in
 * place (dropping `'none'`, which cannot be combined with sources) and a
 * missing one is appended. Every other directive is kept as is.
 */
export function mergeFrameSrc(policy: string, directive: string): string {
  const [directiveName = FRAME_SRC, ...sources] = directive.split(/\s+/)
  const directives = policy
    .split(';')
    .map(entry => entry.trim())
    .filter(Boolean)
  const frameSrcIndex = directives.findIndex((entry) => {
    return entry.split(/\s+/)[0]?.toLowerCase() === directiveName
  })

  if (frameSrcIndex === -1) {
    return [...directives, directive].join('; ')
  }

  const existingSources = directives[frameSrcIndex]!
    .split(/\s+/)
    .slice(1)
    .filter((source) => {
      return source.toLowerCase() !== NONE_SOURCE
    })
  const mergedSources = [...new Set([...existingSources, ...sources])]

  directives[frameSrcIndex] = [directiveName, ...mergedSources].join(' ')

  return directives.join('; ')
}

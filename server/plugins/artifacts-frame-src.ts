import type { RenderContext, RenderResponse } from 'nitropack/types'
import { buildArtifactFrameSrc } from '#shared/utils/artifact-frame-policy'

const CSP_HEADER = 'content-security-policy'
const FRAME_SRC = 'frame-src'
const NONE_SOURCE = '\'none\''
const ARTIFACT_PAGE_PREFIXES = ['/chats/', '/shared/']

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('render:response', (response, context) => {
    applyArtifactFrameSrc(response, context, {
      artifactsOrigin: useRuntimeConfig(context.event).public.artifactsOrigin,
    })
  })
})

export function isArtifactPagePath(path: string): boolean {
  const pathname = path.split('?')[0] ?? ''

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
 * existing policy on the response is extended, never replaced.
 */
export function applyArtifactFrameSrc(
  response: Partial<RenderResponse>,
  context: Pick<RenderContext, 'event'>,
  options: { artifactsOrigin: unknown },
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
    response.headers = { ...headers, [CSP_HEADER]: directive }

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

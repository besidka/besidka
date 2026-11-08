import type { RenderContext, RenderResponse } from 'nitropack/types'
import { buildArtifactFrameSrc } from '#shared/utils/artifact-frame-policy'

const CSP_HEADER = 'content-security-policy'
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

  const existingPolicy = String(headers[existingName]).trim()
  const separator = existingPolicy.endsWith(';') ? ' ' : '; '

  response.headers = {
    ...headers,
    [existingName]: `${existingPolicy}${separator}${directive}`,
  }
}

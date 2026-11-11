const ARTIFACT_FRAME_SELF_SOURCE = '\'self\''
const ARTIFACT_FRAME_TURNSTILE_SOURCE = 'https://challenges.cloudflare.com'
const ARTIFACT_FRAME_PROTOCOLS: ReadonlySet<string> = new Set([
  'http:',
  'https:',
])

export function toArtifactsFrameOrigin(value: unknown): string | null {
  if (typeof value !== 'string' || !value) {
    return null
  }

  try {
    const url = new URL(value)

    return ARTIFACT_FRAME_PROTOCOLS.has(url.protocol) ? url.origin : null
  } catch {
    return null
  }
}

/**
 * The one `frame-src` directive for documents that host artifact frames,
 * shared by the response header (`server/plugins/artifacts-frame-src.ts`)
 * and the client meta tag (`app/utils/artifact-frame-policy.ts`), so both
 * policies allow the same sources. Null when the artifacts origin is not an
 * http(s) URL.
 */
export function buildArtifactFrameSrc(artifactsOrigin: unknown): string | null {
  const origin = toArtifactsFrameOrigin(artifactsOrigin)

  if (!origin) {
    return null
  }

  const sources = [
    ARTIFACT_FRAME_SELF_SOURCE,
    origin,
    ARTIFACT_FRAME_TURNSTILE_SOURCE,
  ]

  return `frame-src ${sources.join(' ')}`
}

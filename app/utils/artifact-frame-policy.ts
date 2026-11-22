import { buildArtifactFrameSrc } from '#shared/utils/artifact-frame-policy'

const FRAME_POLICY_CLASS = 'js-artifact-frame-policy'

/**
 * Adds the artifact `frame-src` policy to the current document as a
 * `<meta http-equiv="Content-Security-Policy">`, once per document. The
 * response header covers only documents loaded at `/chats/**` and
 * `/shared/**`; a client-side navigation from any other page into a chat
 * would otherwise host artifact frames without it. Returns false when the
 * origin is unusable and nothing was added.
 */
export function ensureArtifactFramePolicy(artifactsOrigin: unknown): boolean {
  const policy = buildArtifactFrameSrc(artifactsOrigin)

  if (!policy || typeof document === 'undefined') {
    return false
  }

  if (document.head.querySelector(`meta.${FRAME_POLICY_CLASS}`)) {
    return true
  }

  const meta = document.createElement('meta')

  meta.httpEquiv = 'Content-Security-Policy'
  meta.content = policy
  meta.className = FRAME_POLICY_CLASS
  document.head.appendChild(meta)

  return true
}

/**
 * Silence Cloudflare's local-dev worker probes for /cdn-cgi/ProxyWorker/*.
 * These never reach the worker in production (handled at the edge) but
 * wrangler dev forwards them, producing noisy 404 errors in the logs.
 *
 * In production this route should be unreachable — Cloudflare's edge
 * intercepts all /cdn-cgi/* paths before they hit the Worker. We return
 * 204 only in dev; in production we fall through with a 404 so that any
 * accidental hit is visible rather than silently swallowed.
 */
export default defineEventHandler((event) => {
  if (import.meta.dev) {
    setResponseStatus(event, 204)

    return null
  }

  setResponseStatus(event, 404)

  return null
})

/**
 * Silence Cloudflare's local-dev worker probes for /cdn-cgi/ProxyWorker/*.
 * These never reach the worker in production (handled at the edge) but
 * wrangler dev forwards them, producing noisy 404 errors in the logs.
 */
export default defineEventHandler((event) => {
  setResponseStatus(event, 204)

  return null
})

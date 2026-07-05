/**
 * Vite alias target for the `cloudflare:workers` module specifier.
 *
 * That specifier only resolves inside the workerd runtime (or Nitro's own
 * rollup build for the `cloudflare_module` preset) — Vitest runs server
 * utils through the app's Vite pipeline instead, which has no knowledge of
 * `cloudflare:*` specifiers and fails to resolve them. Aliasing the bare
 * specifier to this file (see vitest.config.mts) gives Vite a real module to
 * resolve, so `vi.mock('cloudflare:workers', ...)` can then intercept it.
 */
export const env: Record<string, unknown> = {}

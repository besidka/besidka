/**
 * Assigns `pathname` instead of using `new URL(path, origin)`, whose two-arg
 * form resolves the path as a relative reference — so a `//host` path silently
 * changes origin. Trailing slashes are stripped so `/x` and `/x/` advertise one
 * canonical, matching the `<loc>` @nuxtjs/sitemap emits.
 */
export function buildCanonicalUrl(origin: string, path: string): string {
  const url = new URL(origin)

  url.pathname = path === '/' ? '/' : path.replace(/\/+$/, '')
  url.search = ''
  url.hash = ''

  return url.href
}

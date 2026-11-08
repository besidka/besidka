/**
 * Accepts only same-origin relative paths (`/files/...`) for the context
 * panel's thumbnails and downloads, so a malformed part can never put a
 * `javascript:` or third-party URL into an `src` or `href`.
 */
export function toSafeLocalUrl(url: string | undefined | null): string | null {
  if (
    !url
    || !url.startsWith('/')
    || url.startsWith('//')
    || url.startsWith('/\\')
  ) {
    return null
  }

  return url
}

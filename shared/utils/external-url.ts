/**
 * True only for an absolute `https:` URL. CMS-authored frontmatter links must
 * never render as clickable `javascript:`, `data:` or plain `http:` targets.
 */
export function isSafeExternalUrl(value: string | null | undefined): boolean {
  if (!value) {
    return false
  }

  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

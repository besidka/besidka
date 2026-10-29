export const DEFAULT_SITE_URL = 'https://besidka.com'

export function resolveSiteUrl(
  environment: Record<string, string | undefined>,
): string {
  const configuredUrl = environment.NUXT_PUBLIC_BASE_URL

  return (configuredUrl || DEFAULT_SITE_URL).replace(/\/+$/, '')
}

export function assertSecureSiteUrl(siteUrl: string): void {
  if (siteUrl.startsWith('https://')) {
    return
  }

  throw new Error(
    `The site URL "${siteUrl}" is baked into llms.txt and the agent `
    + 'discovery documents of a production build and must be an https URL. '
    + 'Unset NUXT_PUBLIC_BASE_URL (for example with '
    + '`env -u NUXT_PUBLIC_BASE_URL`) or set it to https://besidka.com.',
  )
}

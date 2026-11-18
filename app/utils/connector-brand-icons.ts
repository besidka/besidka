import { findConnectorPresetByHost } from '~~/config/connectors-catalog'

const CONNECTOR_BRAND_ICONS: Readonly<Record<string, string>> = {
  github: 'simple-icons:github',
  notion: 'simple-icons:notion',
  linear: 'simple-icons:linear',
  atlassian: 'simple-icons:atlassian',
  stripe: 'simple-icons:stripe',
  vercel: 'simple-icons:vercel',
  supabase: 'simple-icons:supabase',
  sentry: 'simple-icons:sentry',
  square: 'simple-icons:square',
  intercom: 'simple-icons:intercom',
  clickup: 'simple-icons:clickup',
  miro: 'simple-icons:miro',
  todoist: 'simple-icons:todoist',
  webflow: 'simple-icons:webflow',
  wix: 'simple-icons:wix',
  cloudflare: 'simple-icons:cloudflare',
}

function findBundledIcon(presetId: string | null | undefined): string | null {
  return presetId && Object.hasOwn(CONNECTOR_BRAND_ICONS, presetId)
    ? CONNECTOR_BRAND_ICONS[presetId] ?? null
    : null
}

/**
 * The brand mark of a curated preset, drawn from the bundled `simple-icons`
 * collection: no request, no remote image. A connector added by URL has no
 * preset id, so its server host is matched to a preset instead (the exact
 * host, or a subdomain of the preset's registrable domain). Null for
 * anything else, which falls back to a fetched icon or the letter.
 */
export function getConnectorBrandIcon(
  presetId: string | null | undefined,
  host?: string | null,
): string | null {
  return findBundledIcon(presetId)
    ?? (host ? findBundledIcon(findConnectorPresetByHost(host)?.id) : null)
}

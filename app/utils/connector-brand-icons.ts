const CONNECTOR_BRAND_ICONS: Readonly<Record<string, string>> = {
  github: 'simple-icons:github',
  notion: 'simple-icons:notion',
  linear: 'simple-icons:linear',
  atlassian: 'simple-icons:atlassian',
}

/**
 * The brand mark of a curated preset, drawn from the bundled `simple-icons`
 * collection: no request, no remote image. Null for anything else, which
 * falls back to a fetched icon or the letter.
 */
export function getConnectorBrandIcon(
  presetId: string | null | undefined,
): string | null {
  return presetId && Object.hasOwn(CONNECTOR_BRAND_ICONS, presetId)
    ? CONNECTOR_BRAND_ICONS[presetId] ?? null
    : null
}

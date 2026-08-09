/**
 * Everything before a gateway model id's first `/` (e.g.
 * `anthropic/claude-opus-5` -> `anthropic`), or the full id when there is no
 * `/`. A pure split with no vendor-slug normalization — Cloudflare's own ids
 * are prefixed `@cf/...`, so this returns `@cf` for those, not the
 * underlying proxied provider. `app/components/ProviderIcon.vue` owns the
 * small static override table that maps known vendor-slug variants (e.g.
 * OpenRouter's `x-ai`) to this app's icon keys.
 */
export function getGatewayModelProviderPrefix(modelId: string): string {
  const separatorIndex = modelId.indexOf('/')

  return separatorIndex === -1 ? modelId : modelId.slice(0, separatorIndex)
}

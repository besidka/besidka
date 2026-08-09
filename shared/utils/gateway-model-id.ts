const cloudflareModelIdPrefix = '@cf/'

/**
 * Everything before a gateway model id's first `/` (e.g.
 * `anthropic/claude-opus-5` -> `anthropic`), or the full id when there is no
 * `/`. A pure split with no vendor-slug normalization — OpenRouter and Vercel
 * ids are shaped `vendor/model-slug`, so the first segment IS the vendor.
 *
 * Every Cloudflare Workers AI model id is uniformly shaped
 * `@cf/vendor/model-slug` — a literal `@cf` namespace segment followed by the
 * real vendor — so splitting on the first `/` would return `@cf` for every
 * single Cloudflare model regardless of actual vendor. The `@cf/` literal is
 * a self-sufficient, unique-to-Cloudflare signal, so that shape is detected
 * directly and the SECOND segment is returned instead. `app/components/
 * ProviderIcon.vue` owns the small static override table that maps known
 * vendor-slug variants (e.g. OpenRouter's `x-ai`) to this app's icon keys, and
 * consumes `cloudflareVendorIconOverrides` below for Cloudflare's own vendor
 * slugs (e.g. `deepseek-ai`, `mistralai`).
 */
export function getGatewayModelProviderPrefix(modelId: string): string {
  if (modelId.startsWith(cloudflareModelIdPrefix)) {
    const remainder = modelId.slice(cloudflareModelIdPrefix.length)
    const vendorSeparatorIndex = remainder.indexOf('/')
    const vendorSegment = vendorSeparatorIndex === -1
      ? ''
      : remainder.slice(0, vendorSeparatorIndex)

    if (vendorSegment) {
      return vendorSegment
    }
  }

  const separatorIndex = modelId.indexOf('/')

  return separatorIndex === -1 ? modelId : modelId.slice(0, separatorIndex)
}

/**
 * Cloudflare Workers AI vendor slugs (the second segment of an `@cf/vendor/
 * model-slug` id) don't always match this app's own provider/gateway ids
 * even when a matching icon exists — populated by the parallel work package
 * that also adds the corresponding icon assets to `ProviderIcon.vue`. Left
 * empty here on purpose: this file only declares the contract its consumer
 * (`ProviderIcon.vue`) wires against, it does not own the vendor-slug data.
 */
export const cloudflareVendorIconOverrides: Record<string, string> = {}

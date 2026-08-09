/**
 * Everything before a gateway model id's first `/` (e.g.
 * `anthropic/claude-opus-5` -> `anthropic`), or the full id when there is no
 * `/`. A pure split with no vendor-slug normalization — Cloudflare's own ids
 * are prefixed `@cf/...`, so this returns `@cf` for those, not the
 * underlying proxied provider. `app/components/ProviderIcon.vue` owns the
 * small static override table that maps known vendor-slug variants (e.g.
 * OpenRouter's `x-ai`) to this app's icon keys, and folds in
 * `cloudflareVendorIconOverrides` below.
 */
export function getGatewayModelProviderPrefix(modelId: string): string {
  const separatorIndex = modelId.indexOf('/')

  return separatorIndex === -1 ? modelId : modelId.slice(0, separatorIndex)
}

/**
 * Maps the vendor segment of a Cloudflare Workers AI model id
 * (`@cf/<vendor>/<model-slug>`) onto a provider id that
 * `app/components/ProviderIcon.vue` can draw.
 *
 * Only vendors with a verified brand icon appear here; anything absent
 * (`nousresearch`, `thebloke`, `defog`, …) intentionally falls through to that
 * component's two-letter monogram badge rather than borrowing a wrong logo.
 * Keys are raw Cloudflare slugs, so a caller can pass a freshly split prefix
 * straight through without normalizing it first.
 */
export const cloudflareVendorIconOverrides: Record<string, string> = {
  'bytedance': 'bytedance',
  'deepgram': 'deepgram',
  'deepseek-ai': 'deepseek',
  'facebook': 'meta',
  'google': 'google',
  'huggingface': 'huggingface',
  'ibm-granite': 'ibm',
  'meta': 'meta',
  'meta-llama': 'meta',
  'microsoft': 'microsoft',
  'mistral': 'mistral',
  'mistralai': 'mistral',
  'moonshotai': 'moonshotai',
  'nvidia': 'nvidia',
  'openai': 'openai',
  'pipecat-ai': 'pipecat',
  'qwen': 'qwen',
  'zai-org': 'zhipu',
}

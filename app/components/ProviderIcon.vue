<template>
  <Icon
    v-if="iconName"
    :name="iconName"
  />
  <span
    v-else
    class="inline-flex aspect-square items-center justify-center rounded-[0.25em] bg-current/10 text-[0.5rem] font-semibold uppercase leading-none tracking-tight"
  >
    {{ badgeText }}
  </span>
</template>

<script setup lang="ts">
import { cloudflareVendorIconOverrides } from '#shared/utils/gateway-model-id'
import { providerMeta } from '#shared/utils/provider-meta'

/**
 * Iconify names per provider, resolved at runtime through
 * `icon.serverBundle.remote` — no local asset ships for these.
 *
 * `simple-icons` is the default collection because this app renders every
 * provider icon through `@nuxt/icon`'s `css` mode, which masks the glyph and
 * paints it with `currentColor`. `simple-icons` marks are single-path and
 * survive that intact; `logos` marks are multi-color artwork whose knocked-out
 * details disappear when flattened (`logos:qwen-icon` masks to a solid blob).
 * `xai` is the deliberate exception: `simple-icons` ships no Grok/xAI entry,
 * and `logos:grok-icon` is itself a single uncolored path, so masking it is
 * lossless.
 */
const providerIconNames: Record<string, string> = {
  anthropic: 'simple-icons:anthropic',
  bytedance: 'simple-icons:bytedance',
  cloudflare: 'simple-icons:cloudflare',
  deepgram: 'simple-icons:deepgram',
  deepseek: 'simple-icons:deepseek',
  google: 'simple-icons:googlegemini',
  huggingface: 'simple-icons:huggingface',
  ibm: 'simple-icons:ibm',
  meta: 'simple-icons:meta',
  microsoft: 'simple-icons:microsoft',
  mistral: 'simple-icons:mistralai',
  moonshotai: 'simple-icons:moonshotai',
  nvidia: 'simple-icons:nvidia',
  openai: 'simple-icons:openai',
  openrouter: 'simple-icons:openrouter',
  pipecat: 'simple-icons:pipecat',
  qwen: 'simple-icons:qwen',
  vercel: 'simple-icons:vercel',
  xai: 'logos:grok-icon',
  zhipu: 'thesvg:zhipu',
}

/**
 * Gateway model ids are vendor-prefixed (`shared/utils/gateway-model-id.ts`
 * splits `anthropic/claude-opus-5` down to `anthropic`), but some real
 * vendor slugs don't match this app's own provider/gateway ids even though a
 * matching icon exists — OpenRouter's `x-ai` and its `~`-prefixed "latest"
 * aliases being the confirmed cases. Cloudflare's `@cf/<vendor>/...` slugs are
 * folded in from the shared table so a raw slug resolves here too, whether or
 * not the caller normalized it first.
 */
const gatewayProviderPrefixIconOverrides: Record<string, string> = {
  ...cloudflareVendorIconOverrides,
  'x-ai': 'xai',
  '~anthropic': 'anthropic',
  '~deepseek': 'deepseek',
  '~google': 'google',
  '~moonshotai': 'moonshotai',
  '~openai': 'openai',
  '~x-ai': 'xai',
}

const props = defineProps<{
  providerId: string
  label?: string
}>()

const resolvedProviderId = computed<string>(() => {
  return gatewayProviderPrefixIconOverrides[props.providerId]
    ?? props.providerId
})

const iconName = computed<string | undefined>(() => {
  return providerIconNames[resolvedProviderId.value]
})

const badgeText = computed<string>(() => {
  const label = props.label
    ?? providerMeta[props.providerId]?.label
    ?? props.providerId

  return label.slice(0, 2)
})
</script>

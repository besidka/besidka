<template>
  <SvgoGeminiShort v-if="resolvedProviderId === 'google'" />
  <SvgoOpenai v-else-if="resolvedProviderId === 'openai'" />
  <SvgoAnthropic v-else-if="resolvedProviderId === 'anthropic'" />
  <SvgoXai v-else-if="resolvedProviderId === 'xai'" />
  <SvgoDeepseek v-else-if="resolvedProviderId === 'deepseek'" />
  <SvgoMoonshot v-else-if="resolvedProviderId === 'moonshotai'" />
  <SvgoVercel v-else-if="resolvedProviderId === 'vercel'" />
  <SvgoOpenrouter v-else-if="resolvedProviderId === 'openrouter'" />
  <SvgoCloudflare v-else-if="resolvedProviderId === 'cloudflare'" />
  <span
    v-else
    class="text-xs font-semibold uppercase"
  >
    {{ badgeText }}
  </span>
</template>

<script setup lang="ts">
import { providerMeta } from '#shared/utils/provider-meta'

/**
 * Gateway model ids are vendor-prefixed (`shared/utils/gateway-model-id.ts`
 * splits `anthropic/claude-opus-5` down to `anthropic`), but some real
 * vendor slugs don't match this app's own provider/gateway ids even though a
 * matching icon exists — OpenRouter's `x-ai` and its `~`-prefixed "latest"
 * aliases being the confirmed cases. Every other unmatched prefix
 * (`mistralai`, `qwen`, `meta-llama`, …) falls through to the badge below;
 * no new icon assets are invented here.
 */
const gatewayProviderPrefixIconOverrides: Record<string, string> = {
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

const badgeText = computed<string>(() => {
  const label = props.label
    ?? providerMeta[props.providerId]?.label
    ?? props.providerId

  return label.slice(0, 2)
})
</script>

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
  deepseek: 'simple-icons:deepseek',
  google: 'simple-icons:googlegemini',
  moonshotai: 'simple-icons:moonshotai',
  openai: 'simple-icons:openai',
  qwen: 'simple-icons:qwen',
  xai: 'logos:grok-icon',
}

const props = defineProps<{
  providerId: string
  label?: string
}>()

const iconName = computed<string | undefined>(() => {
  return providerIconNames[props.providerId]
})

const badgeText = computed<string>(() => {
  const label = props.label
    ?? providerMeta[props.providerId]?.label
    ?? props.providerId

  return label.slice(0, 2)
})
</script>

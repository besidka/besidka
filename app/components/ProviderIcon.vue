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
 * `simple-icons` is the default collection because every icon body in it
 * ships with an explicit `fill="currentColor"`. `@nuxt/icon`'s `css` mode
 * (via `@iconify/utils`'s `getIconCSS`) only renders an icon as a `mask` —
 * theme-aware, painted with `currentColor` — when its body string contains
 * the literal text `currentColor`; otherwise it falls back to `background`
 * mode, embedding the icon as a static image with whatever fill it shipped
 * with (usually none, which SVG defaults to solid black). `xai` is the
 * deliberate exception: `simple-icons` ships no Grok/xAI entry, and
 * `logos:grok-icon` has no `currentColor` in its body, so it rendered as a
 * black blob in every theme. `bxl:grok` is the same mark with
 * `fill="currentColor"` baked in, so it mask-renders correctly.
 */
const providerIconNames: Record<string, string> = {
  anthropic: 'simple-icons:anthropic',
  deepseek: 'simple-icons:deepseek',
  google: 'simple-icons:googlegemini',
  moonshotai: 'simple-icons:moonshotai',
  openai: 'simple-icons:openai',
  qwen: 'simple-icons:qwen',
  xai: 'bxl:grok',
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

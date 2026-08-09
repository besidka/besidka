<template>
  <SvgoGeminiShort v-if="providerId === 'google'" />
  <SvgoOpenai v-else-if="providerId === 'openai'" />
  <SvgoAnthropic v-else-if="providerId === 'anthropic'" />
  <SvgoXai v-else-if="providerId === 'xai'" />
  <SvgoDeepseek v-else-if="providerId === 'deepseek'" />
  <SvgoMoonshot v-else-if="providerId === 'moonshotai'" />
  <span
    v-else
    class="text-xs font-semibold uppercase"
  >
    {{ badgeText }}
  </span>
</template>

<script setup lang="ts">
import { providerMeta } from '#shared/utils/provider-meta'

const props = defineProps<{
  providerId: string
  label?: string
}>()

const badgeText = computed<string>(() => {
  const label = props.label
    ?? providerMeta[props.providerId]?.label
    ?? props.providerId

  return label.slice(0, 2)
})
</script>

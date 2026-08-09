<template>
  <div
    data-testid="models-picker-gateway-provider-strip"
    class="shrink-0 flex items-center gap-2 px-2 py-1.5 border-b border-base-content/10"
  >
    <span
      class="shrink-0 px-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-50"
    >
      Providers
    </span>
    <div
      class="grow min-w-0 flex items-center gap-1 overflow-x-auto no-scrollbar"
    >
      <button
        v-for="provider in providers"
        :key="provider.prefix"
        type="button"
        :data-testid="`models-picker-gateway-provider-${provider.prefix}`"
        class="btn btn-xs shrink-0 gap-1.5 rounded-full"
        :class="activeProviderPrefix === provider.prefix
          ? 'btn-accent'
          : 'btn-ghost'
        "
        :aria-pressed="activeProviderPrefix === provider.prefix"
        :aria-label="getProviderLabel(provider)"
        @click="emit('toggleProvider', provider.prefix)"
      >
        <ProviderIcon
          :provider-id="provider.prefix"
          :label="provider.prefix"
          class="!size-3.5 shrink-0"
        />
        <span class="truncate">
          {{ provider.prefix }}
        </span>
        <span class="shrink-0 tabular-nums opacity-60">
          {{ provider.count }}
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GatewayProviderGroup } from '~/types/models-picker'

const props = defineProps<{
  providers: GatewayProviderGroup[]
  activeProviderPrefix: string | null
}>()

const emit = defineEmits<{
  toggleProvider: [prefix: string]
}>()

function getProviderLabel(provider: GatewayProviderGroup): string {
  if (props.activeProviderPrefix === provider.prefix) {
    return `Stop filtering by ${provider.prefix}`
  }

  return `Show ${provider.prefix} models only — ${provider.count} models`
}
</script>

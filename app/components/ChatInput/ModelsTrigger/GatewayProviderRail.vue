<template>
  <div
    data-testid="models-picker-gateway-provider-rail"
    class="shrink-0 flex flex-col items-center gap-1 p-1.5 min-h-0 overflow-y-auto no-scrollbar border-r border-base-content/10"
  >
    <template v-if="hasFavorites">
      <button
        type="button"
        data-testid="models-picker-rail-favorites"
        class="btn btn-ghost btn-sm btn-circle"
        :class="{ 'btn-active text-warning': isFavoritesOnly }"
        title="Favorites"
        aria-label="Show favorite models only"
        :aria-pressed="isFavoritesOnly"
        @click="emit('toggleFavorites')"
      >
        <Icon
          name="lucide:star"
          mode="svg"
          size="16"
          :class="{ '[&_path]:fill-current': isFavoritesOnly }"
        />
      </button>
      <div
        class="divider shrink-0 my-0.5 h-px w-full before:h-px after:h-px"
      />
    </template>
    <button
      v-for="provider in providers"
      :key="provider.prefix"
      type="button"
      :data-testid="`models-picker-gateway-provider-${provider.prefix}`"
      class="btn btn-ghost btn-sm btn-circle"
      :class="{
        'btn-active text-accent': activeProviderPrefix === provider.prefix
      }"
      :title="getProviderTitle(provider)"
      :aria-label="getProviderLabel(provider)"
      :aria-pressed="activeProviderPrefix === provider.prefix"
      @click="emit('toggleProvider', provider.prefix)"
    >
      <span class="indicator">
        <ProviderIcon
          :provider-id="provider.prefix"
          :label="provider.prefix"
          class="!size-4"
        />
        <span
          :data-testid="getCountTestId(provider)"
          class="badge badge-xs indicator-item indicator-end indicator-bottom px-1 tabular-nums pointer-events-none"
        >
          {{ formatRailCount(provider.count) }}
        </span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { GatewayProviderGroup } from '~/types/models-picker'

const props = defineProps<{
  providers: GatewayProviderGroup[]
  activeProviderPrefix: string | null
  isFavoritesOnly: boolean
  hasFavorites: boolean
}>()

const emit = defineEmits<{
  toggleProvider: [prefix: string]
  toggleFavorites: []
}>()

function getCountTestId(provider: GatewayProviderGroup): string {
  return `models-picker-gateway-provider-${provider.prefix}-count`
}

/**
 * A native `title` rather than the daisyUI tooltip the direct-provider rail
 * uses: this rail scrolls, and a scroll container force-computes `overflow-x`
 * to `auto`, which clips the tooltip's `::before` bubble as it reaches past
 * the rail's right edge. Browser chrome escapes the container instead.
 */
function getProviderTitle(provider: GatewayProviderGroup): string {
  return `${provider.prefix} — ${formatModelCount(provider.count)}`
}

function getProviderLabel(provider: GatewayProviderGroup): string {
  if (props.activeProviderPrefix === provider.prefix) {
    return `Stop filtering by ${provider.prefix}`
  }

  return `Show ${provider.prefix} models only`
    + ` — ${formatModelCount(provider.count)}`
}
</script>

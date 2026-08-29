<template>
  <div
    data-testid="models-picker-rail"
    class="shrink-0 flex flex-col items-center gap-1 p-1.5 border-r border-base-content/10"
  >
    <template v-if="hasFavorites">
      <button
        type="button"
        data-testid="models-picker-rail-favorites"
        class="btn btn-ghost btn-sm btn-circle"
        :class="{
          'btn-active text-warning': isFavoritesOnly,
          'tooltip tooltip-soft tooltip-right': $device.isDesktop
        }"
        data-tip="Favorites"
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
      <div class="divider my-0.5 h-px w-full before:h-px after:h-px" />
    </template>
    <button
      v-for="provider in providers"
      :key="provider.id"
      type="button"
      :data-testid="`models-picker-rail-${provider.id}`"
      class="btn btn-ghost btn-sm btn-circle"
      :class="{
        'btn-active text-accent': activeProviderId === provider.id,
        'tooltip tooltip-soft tooltip-right': $device.isDesktop
      }"
      :data-tip="getProviderTip(provider)"
      :aria-label="getProviderLabel(provider)"
      :aria-pressed="activeProviderId === provider.id"
      @click="emit('toggleProvider', provider.id)"
    >
      <span class="indicator">
        <ProviderIcon
          :provider-id="provider.id"
          :label="provider.name"
          class="!size-4"
        />
        <span
          v-if="isKeyless(provider.id)"
          :data-testid="`models-picker-rail-${provider.id}-keyless`"
          class="indicator-item indicator-end indicator-bottom size-2 rounded-full bg-accent pointer-events-none"
        />
        <span
          v-else-if="getModelCount(provider)"
          :data-testid="`models-picker-rail-${provider.id}-count`"
          class="badge badge-xs indicator-item indicator-end indicator-bottom px-1 tabular-nums pointer-events-none"
        >
          {{ formatRailCount(getModelCount(provider)) }}
        </span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { Provider, Providers } from '#shared/types/providers.d'

const props = withDefaults(
  defineProps<{
    providers: Providers
    activeProviderId: string | null
    isFavoritesOnly: boolean
    hasFavorites: boolean
    keylessProviderIds?: string[]
  }>(),
  {
    keylessProviderIds: () => [],
  },
)

const emit = defineEmits<{
  toggleProvider: [providerId: string]
  toggleFavorites: []
}>()

function isKeyless(providerId: string): boolean {
  return props.keylessProviderIds.includes(providerId)
}

function getModelCount(provider: Provider): number {
  return countSelectableModels(provider.models)
}

function getProviderTip(provider: Provider): string {
  if (isKeyless(provider.id)) {
    return `${provider.name} — API key required`
  }

  const count = getModelCount(provider)

  if (!count) {
    return provider.name
  }

  return `${provider.name} — ${formatModelCount(count)}`
}

function getProviderLabel(provider: Provider): string {
  if (isKeyless(provider.id)) {
    return `Show ${provider.name} models only — API key required`
  }

  const count = getModelCount(provider)

  if (!count) {
    return `Show ${provider.name} models only`
  }

  return `Show ${provider.name} models only — ${formatModelCount(count)}`
}
</script>

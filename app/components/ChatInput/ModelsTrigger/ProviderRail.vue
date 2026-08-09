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
      :data-tip="provider.name"
      :aria-label="`Show ${provider.name} models only`"
      :aria-pressed="activeProviderId === provider.id"
      @click="emit('toggleProvider', provider.id)"
    >
      <ProviderIcon
        :provider-id="provider.id"
        :label="provider.name"
        class="w-4 fill-current"
      />
    </button>
  </div>
</template>

<script setup lang="ts">
import type { Providers } from '#shared/types/providers.d'

defineProps<{
  providers: Providers
  activeProviderId: string | null
  isFavoritesOnly: boolean
  hasFavorites: boolean
}>()

const emit = defineEmits<{
  toggleProvider: [providerId: string]
  toggleFavorites: []
}>()
</script>

<template>
  <div
    ref="rail"
    data-testid="models-picker-rail"
    class="shrink-0 flex items-center border-base-content/10"
    :class="isSheet
      ? 'gap-1.5 px-2 py-1.5 overflow-x-auto no-scrollbar border-b'
      : 'flex-col gap-1 p-1.5 border-r'
    "
    :style="isSheet ? railFadeStyle : undefined"
  >
    <template v-if="hasFavorites">
      <button
        type="button"
        data-testid="models-picker-rail-favorites"
        :class="[buttonClass, {
          'btn-active text-warning': isFavoritesOnly,
          'tooltip tooltip-soft tooltip-right': hasTooltip
        }]"
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
      <div
        v-if="isSheet"
        class="shrink-0 w-px h-5 bg-base-content/10"
      />
      <div
        v-else
        class="divider my-0.5 h-px w-full before:h-px after:h-px"
      />
    </template>
    <button
      v-for="provider in providers"
      :key="provider.id"
      type="button"
      :data-testid="`models-picker-rail-${provider.id}`"
      :class="[buttonClass, {
        'btn-active text-accent': activeProviderId === provider.id,
        'tooltip tooltip-soft tooltip-right': hasTooltip
      }]"
      :data-tip="getProviderTip(provider)"
      :aria-label="getProviderLabel(provider)"
      :aria-pressed="activeProviderId === provider.id"
      @click="emit('toggleProvider', provider.id)"
    >
      <span
        :class="isSheet ? 'inline-flex items-center gap-1.5' : 'indicator'"
      >
        <ProviderIcon
          :provider-id="provider.id"
          :label="provider.name"
          class="!size-4"
        />
        <span
          v-if="isKeyless(provider.id)"
          :data-testid="`models-picker-rail-${provider.id}-keyless`"
          class="rounded-full bg-accent pointer-events-none"
          :class="isSheet
            ? 'size-1.5'
            : 'indicator-item indicator-end indicator-bottom size-2'
          "
        />
        <span
          v-else-if="getModelCount(provider)"
          :data-testid="`models-picker-rail-${provider.id}-count`"
          class="tabular-nums pointer-events-none"
          :class="isSheet ? SHEET_COUNT_CLASS : POPOVER_COUNT_CLASS"
        >
          {{ formatRailCount(getModelCount(provider)) }}
        </span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type { Provider, Providers } from '#shared/types/providers.d'
import type { PickerLayout } from '~/types/models-picker'

const SHEET_COUNT_CLASS = 'text-xs font-semibold opacity-60'
const POPOVER_COUNT_CLASS = 'badge badge-xs indicator-item indicator-end indicator-bottom px-1 scale-[0.8]'

const props = withDefaults(
  defineProps<{
    providers: Providers
    activeProviderId: string | null
    isFavoritesOnly: boolean
    hasFavorites: boolean
    keylessProviderIds?: string[]
    layout?: PickerLayout
  }>(),
  {
    keylessProviderIds: () => [],
    layout: 'popover',
  },
)

const emit = defineEmits<{
  toggleProvider: [providerId: string]
  toggleFavorites: []
}>()

const { isDesktop } = useDevice()
const isSheet = computed<boolean>(() => {
  return props.layout === 'sheet'
})
const rail = useTemplateRef<HTMLDivElement>('rail')
const { fadeStyle: railFadeStyle } = useScrollEdgeFade(() => {
  return isSheet.value ? rail.value : null
}, 'x')

const hasTooltip = computed<boolean>(() => {
  return isDesktop && !isSheet.value
})

const buttonClass = computed<string>(() => {
  return isSheet.value
    ? 'btn btn-ghost btn-sm shrink-0 rounded-full px-2.5'
    : 'btn btn-ghost btn-circle [--size:1.8rem]'
})

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

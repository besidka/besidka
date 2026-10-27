<template>
  <div
    ref="rail"
    data-testid="models-picker-gateway-provider-rail"
    class="shrink-0 flex items-center no-scrollbar border-base-content/10"
    :class="isSheet
      ? 'gap-1.5 px-2 py-1.5 overflow-x-auto border-b'
      : 'flex-col gap-1 p-1.5 min-h-0 overflow-y-auto border-r'
    "
    :style="isSheet ? railFadeStyle : undefined"
  >
    <template v-if="hasFavorites">
      <button
        type="button"
        data-testid="models-picker-rail-favorites"
        :class="[buttonClass, { 'btn-active text-warning': isFavoritesOnly }]"
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
        v-if="isSheet"
        class="shrink-0 w-px h-5 bg-base-content/10"
      />
      <div
        v-else
        class="divider shrink-0 my-0.5 h-px w-full before:h-px after:h-px"
      />
    </template>
    <button
      v-for="provider in providers"
      :key="provider.prefix"
      type="button"
      :data-testid="`models-picker-gateway-provider-${provider.prefix}`"
      :class="[buttonClass, {
        'btn-active text-accent': activeProviderPrefix === provider.prefix
      }]"
      :title="getProviderTitle(provider)"
      :aria-label="getProviderLabel(provider)"
      :aria-pressed="activeProviderPrefix === provider.prefix"
      @click="emit('toggleProvider', provider.prefix)"
    >
      <span
        :class="isSheet ? 'inline-flex items-center gap-1.5' : 'indicator'"
      >
        <ProviderIcon
          :provider-id="provider.prefix"
          :label="provider.prefix"
          class="!size-4"
        />
        <span
          :data-testid="getCountTestId(provider)"
          class="tabular-nums pointer-events-none"
          :class="isSheet ? SHEET_COUNT_CLASS : POPOVER_COUNT_CLASS"
        >
          {{ formatRailCount(provider.count) }}
        </span>
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
import type {
  GatewayProviderGroup,
  PickerLayout,
} from '~/types/models-picker'

const SHEET_COUNT_CLASS = 'text-xs font-semibold opacity-60'
const POPOVER_COUNT_CLASS = 'badge badge-xs indicator-item indicator-end indicator-bottom px-1 scale-[0.8]'

const props = withDefaults(defineProps<{
  providers: GatewayProviderGroup[]
  activeProviderPrefix: string | null
  isFavoritesOnly: boolean
  hasFavorites: boolean
  layout?: PickerLayout
}>(), {
  layout: 'popover',
})

const emit = defineEmits<{
  toggleProvider: [prefix: string]
  toggleFavorites: []
}>()

const rail = useTemplateRef<HTMLDivElement>('rail')
const { fadeStyle: railFadeStyle } = useScrollEdgeFade(rail, 'x')

const isSheet = computed<boolean>(() => {
  return props.layout === 'sheet'
})

const buttonClass = computed<string>(() => {
  return isSheet.value
    ? 'btn btn-ghost btn-sm shrink-0 rounded-full px-2.5'
    : 'btn btn-ghost btn-circle [--size:1.8rem]'
})

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

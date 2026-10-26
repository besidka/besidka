<template>
  <li class="menu-title text-xs">
    Web search
  </li>
  <li>
    <button
      type="button"
      class="flex items-center gap-2"
      :class="{
        'bg-accent text-accent-content pointer-events-none':
          selected === 'off',
      }"
      @click="emit('select-provider', 'off')"
    >
      <Icon name="lucide:circle-slash-2" class="!size-4 text-current" />
      <span>Off</span>
    </button>
  </li>
  <li v-if="nativeOption">
    <button
      type="button"
      class="flex items-center gap-2"
      :class="{
        'bg-accent text-accent-content pointer-events-none':
          selected === nativeOption.value,
        'opacity-50': !nativeOption.enabled,
      }"
      :disabled="!nativeOption.enabled"
      :title="nativeOption.disabledReason"
      @click="onSelect(nativeOption)"
    >
      <Icon name="lucide:globe" class="!size-4 text-current" />
      <span class="grow text-left">{{ nativeOption.label }}</span>
    </button>
  </li>
  <li v-if="!isToolCallingSupported">
    <span
      class="flex items-center gap-2 px-2 py-1.5 text-2xs opacity-60"
    >
      <Icon name="lucide:circle-off" size="16" class="shrink-0" />
      This model does not support tool calling, so Brave Search and Exa
      are unavailable.
    </span>
  </li>
  <template v-else>
    <li
      v-for="option in externalOptions"
      :key="option.value"
      :class="{
        'mt-1 pt-1 border-t border-base-content/10':
          option.value === firstKeylessOptionValue,
      }"
    >
      <NuxtLink
        v-if="option.addKeyHref"
        :to="option.addKeyHref"
        class="flex w-full items-center gap-2 text-warning"
      >
        <ProviderIcon
          :provider-id="option.providerId ?? ''"
          class="!size-4"
        />
        <span class="grow text-left">{{ option.label }}</span>
        <Icon
          name="lucide:arrow-right"
          size="14"
          class="shrink-0 opacity-50"
        />
      </NuxtLink>
      <button
        v-else
        type="button"
        class="flex items-center gap-2"
        :class="{
          'bg-accent text-accent-content pointer-events-none':
            selected === option.value,
          'opacity-50': !option.enabled,
        }"
        :disabled="!option.enabled"
        :title="option.disabledReason"
        @click="onSelect(option)"
      >
        <ProviderIcon
          :provider-id="option.providerId ?? ''"
          class="!size-4"
        />
        <span class="grow text-left">{{ option.label }}</span>
      </button>
    </li>
  </template>
  <template v-if="isAutoAvailable">
    <li
      class="menu-title text-xs mt-1 pt-2 border-t border-base-content/10"
      data-testid="web-search-auto-section"
    >
      <span class="flex items-center gap-1">
        <span>Auto</span>
        <button
          type="button"
          class="tooltip tooltip-left inline-flex cursor-help"
          :data-tip="AUTO_WEB_SEARCH_EXPLANATION"
          :aria-label="AUTO_WEB_SEARCH_EXPLANATION"
          data-testid="web-search-auto-info"
        >
          <Icon name="lucide:info" size="12" />
        </button>
      </span>
    </li>
    <li :class="{ 'menu-disabled': !canUseAuto }">
      <label
        class="flex items-center gap-2"
        :class="{ 'cursor-pointer': canUseAuto }"
      >
        <Icon name="lucide:sparkles" class="!size-4 shrink-0 text-current" />
        <span class="grid grow gap-0.5 text-left">
          <span>Decide per message</span>
          <span
            class="text-2xs opacity-60"
            data-testid="web-search-auto-hint"
          >
            {{ canUseAuto
              ? AUTO_WEB_SEARCH_HINT
              : AUTO_WEB_SEARCH_PICK_PROVIDER_HINT }}
          </span>
        </span>
        <input
          type="checkbox"
          class="toggle toggle-xs toggle-accent shrink-0"
          data-testid="web-search-auto-toggle"
          aria-label="Auto web search"
          :checked="canUseAuto && isAutoPreferred"
          :disabled="!canUseAuto"
          @change="onToggleAuto"
        >
      </label>
    </li>
  </template>
  <template v-if="isExaSelected">
    <li class="menu-title text-xs mt-1 pt-2 border-t border-base-content/10">
      Depth
    </li>
    <li
      v-for="level in EXA_SEARCH_LEVELS"
      :key="level"
    >
      <button
        type="button"
        class="flex items-center gap-2"
        :class="{
          'bg-accent text-accent-content pointer-events-none':
            exaSearchLevel === level,
        }"
        :data-testid="`exa-search-level-${level}`"
        :title="exaSearchLevelHints[level]"
        @click="emit('select-exa-search-level', level)"
      >
        <span class="grow text-left">
          {{ EXA_SEARCH_LEVEL_LABELS[level] }}
        </span>
        <span
          v-if="levelPrices[level]"
          class="badge badge-xs shrink-0 badge-soft"
        >
          {{ levelPrices[level] }}
        </span>
      </button>
    </li>
  </template>
</template>

<script setup lang="ts">
import type { ExaSearchLevel } from '#shared/utils/exa-search-level'
import {
  AUTO_WEB_SEARCH_EXPLANATION,
  AUTO_WEB_SEARCH_HINT,
  AUTO_WEB_SEARCH_PICK_PROVIDER_HINT,
} from '#shared/utils/auto-web-search'
import type {
  WebSearchOption,
  WebSearchSelection,
} from '~/types/web-search'

const props = withDefaults(defineProps<{
  selected: WebSearchSelection
  options: WebSearchOption[]
  isToolCallingSupported: boolean
  exaSearchLevel?: ExaSearchLevel
  isAutoAvailable?: boolean
  isAutoPreferred?: boolean
}>(), {
  exaSearchLevel: 'auto',
  isAutoAvailable: false,
  isAutoPreferred: false,
})

const emit = defineEmits<{
  'select-provider': [value: WebSearchSelection]
  'select-exa-search-level': [level: ExaSearchLevel]
  'toggle-auto': [isOn: boolean]
}>()

const canUseAuto = computed<boolean>(() => {
  return props.selected !== 'off'
})

function onToggleAuto(event: Event) {
  if (!canUseAuto.value) {
    return
  }

  emit('toggle-auto', (event.target as HTMLInputElement).checked)
}

const exaSearchLevelHints: Record<ExaSearchLevel, string> = {
  lite: 'Fastest and cheapest',
  auto: 'Balanced default',
  deep: 'Multi-step research, slower',
}

const runtimeConfigPublic = useRuntimeConfig().public

const isExaSelected = computed<boolean>(() => {
  return props.selected === 'web_search_exa'
    && props.isToolCallingSupported
})

function formatLevelPrice(level: ExaSearchLevel): string {
  const rate = parseRatePerThousandUsd(
    runtimeConfigPublic[EXA_SEARCH_LEVEL_RATE_CONFIG_KEYS[level]],
  )

  return rate === undefined ? '' : `$${rate}/1k`
}

const levelPrices = computed<Record<ExaSearchLevel, string>>(() => {
  return {
    lite: formatLevelPrice('lite'),
    auto: formatLevelPrice('auto'),
    deep: formatLevelPrice('deep'),
  }
})

const nativeOption = computed<WebSearchOption | undefined>(() => {
  return props.options.find((option) => {
    return option.value === 'web_search'
  })
})

const externalOptions = computed<WebSearchOption[]>(() => {
  const options = props.options.filter((option) => {
    return option.value !== 'web_search'
  })

  const keyedOptions = options.filter((option) => {
    return !option.addKeyHref
  })
  const keylessOptions = options.filter((option) => {
    return !!option.addKeyHref
  })

  return [...keyedOptions, ...keylessOptions]
})

const firstKeylessOptionValue = computed<WebSearchSelection | undefined>(
  () => {
    return externalOptions.value.find((option) => {
      return !!option.addKeyHref
    })?.value
  },
)

function onSelect(option: WebSearchOption) {
  if (!option.enabled) {
    return
  }

  emit('select-provider', option.value)
}
</script>

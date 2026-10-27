<template>
  <div class="px-2 pt-1 pb-1.5">
    <ChatInputToolsMenuSegmented
      :name="`${groupId}-provider`"
      legend="Web search"
      :options="providerSegments"
      :model-value="selected"
      @update:model-value="onSelectProvider"
    />
  </div>
  <div class="px-2 pb-1.5">
    <p
      class="flex items-start gap-2 min-h-8 text-xs leading-4 text-base-content/60"
      data-testid="web-search-caption"
    >
      <ProviderIcon
        v-if="captionProviderId"
        :provider-id="captionProviderId"
        class="shrink-0 mt-px !size-3.5"
        aria-hidden="true"
      />
      <Icon
        v-else
        :name="captionIcon"
        size="14"
        class="shrink-0 mt-px"
        aria-hidden="true"
      />
      <span data-testid="web-search-caption-text">{{ caption }}</span>
    </p>
  </div>
  <p
    v-if="!isToolCallingSupported"
    class="flex items-start gap-2 px-2 pb-1.5 text-xs text-base-content/60"
    data-testid="web-search-no-tool-calling"
  >
    <Icon
      name="lucide:circle-off"
      size="14"
      class="shrink-0 mt-px"
    />
    This model can't call tools, so Brave and Exa aren't available.
  </p>
  <NuxtLink
    v-for="option in keylessOptions"
    :key="option.value"
    :to="option.addKeyHref"
    class="flex items-center gap-2 px-2 pb-1.5 text-xs text-warning hover:underline"
    :data-testid="`web-search-add-key-${option.providerId}`"
  >
    <ProviderIcon
      :provider-id="option.providerId ?? ''"
      class="!size-3.5"
    />
    <span class="grow">
      Add {{ option.value === 'web_search_brave' ? 'a Brave' : 'an Exa' }} key
    </span>
    <Icon
      name="lucide:arrow-right"
      size="14"
      class="shrink-0"
    />
  </NuxtLink>
  <div
    v-if="hasExaOption"
    class="px-2 pb-1.5"
  >
    <div
      class="flex items-baseline justify-between gap-2 mb-1 text-xs font-semibold text-base-content/60"
    >
      <span :id="`${groupId}-depth-label`">Exa depth</span>
      <span class="font-normal">
        {{ isExaSelected ? 'Price per 1,000 searches' : 'Only for Exa' }}
      </span>
    </div>
    <ChatInputToolsMenuSegmented
      :name="`${groupId}-exa-depth`"
      legend="Exa depth"
      :labelledby="`${groupId}-depth-label`"
      :options="exaDepthSegments"
      :model-value="exaSearchLevel"
      :disabled="!isExaSelected"
      @update:model-value="emit('select-exa-search-level', $event)"
    />
  </div>
  <div
    v-if="isAutoAvailable"
    data-testid="web-search-auto-section"
  >
    <ChatInputToolsMenuToggleRow
      label="Auto"
      icon="lucide:sparkles"
      aria-label="Auto web search"
      test-id="web-search-auto-toggle"
      hint-test-id="web-search-auto-hint"
      :hint="canUseAuto
        ? AUTO_WEB_SEARCH_HINT
        : AUTO_WEB_SEARCH_PICK_PROVIDER_HINT"
      :model-value="canUseAuto && isAutoPreferred"
      :disabled="!canUseAuto"
      :extra-described-by="isExplanationOpen ? explanationId : undefined"
      @update:model-value="onToggleAuto"
    >
      <template #label-extra>
        <button
          type="button"
          class="inline-grid place-items-center size-5 rounded-full text-base-content/60 hover:text-accent cursor-pointer"
          aria-label="How Auto works"
          :aria-expanded="isExplanationOpen"
          :aria-controls="explanationId"
          data-testid="web-search-auto-info"
          @click.prevent="isExplanationOpen = !isExplanationOpen"
        >
          <Icon
            name="lucide:info"
            size="14"
          />
        </button>
      </template>
    </ChatInputToolsMenuToggleRow>
    <p
      v-show="isExplanationOpen"
      :id="explanationId"
      class="mx-2 mb-1.5 ml-8.5 px-2 py-1.5 rounded-box bg-base-200 text-xs"
    >
      {{ AUTO_WEB_SEARCH_EXPLANATION }}
    </p>
  </div>
</template>

<script setup lang="ts">
import {
  EXA_SEARCH_LEVELS,
  type ExaSearchLevel,
} from '#shared/utils/exa-search-level'
import {
  AUTO_WEB_SEARCH_EXPLANATION,
  AUTO_WEB_SEARCH_HINT,
  AUTO_WEB_SEARCH_PICK_PROVIDER_HINT,
} from '#shared/utils/auto-web-search'
import { providerMeta } from '#shared/utils/provider-meta'
import type { SegmentedOption } from '~/types/chat-input-tools'
import type { BuiltInSearchPrice } from '~/utils/web-search-price'
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
  modelId?: string
  billingProviderId?: string | null
}>(), {
  exaSearchLevel: 'auto',
  isAutoAvailable: false,
  isAutoPreferred: false,
  modelId: '',
  billingProviderId: null,
})

const emit = defineEmits<{
  'select-provider': [value: WebSearchSelection]
  'select-exa-search-level': [level: ExaSearchLevel]
  'toggle-auto': [isOn: boolean]
}>()

const groupId = useId()
const explanationId = useId()
const isExplanationOpen = shallowRef<boolean>(false)
const runtimeConfigPublic = useRuntimeConfig().public

const exaSearchLevelHints: Record<ExaSearchLevel, string> = {
  lite: 'Fastest and cheapest',
  auto: 'Balanced default',
  deep: 'Multi-step research, slower',
}

const offeredOptions = computed<WebSearchOption[]>(() => {
  return props.options.filter((option) => {
    return option.value === 'web_search' || props.isToolCallingSupported
  })
})

const keylessOptions = computed<WebSearchOption[]>(() => {
  return offeredOptions.value.filter((option) => {
    return !!option.addKeyHref
  })
})

const builtInPrice = computed<BuiltInSearchPrice | undefined>(() => {
  return resolveBuiltInSearchPrice(
    props.billingProviderId,
    props.modelId,
    runtimeConfigPublic,
  )
})

const builtInBillingName = computed<string | undefined>(() => {
  const meta = props.billingProviderId
    ? providerMeta[props.billingProviderId]
    : undefined

  return meta ? meta.shortLabel ?? meta.label : undefined
})

const builtInDescription = computed<string>(() => {
  const name = builtInBillingName.value

  if (!name) {
    return 'The model\'s own search.'
  }

  const price = builtInPrice.value

  if (!price) {
    return `The model's own search from ${name}, billed by ${name}.`
  }

  return `The model's own search from ${name}. Your ${name} key pays `
    + `$${price.perThousandUsd} per 1,000 ${price.unit}.`
})

const braveRate = computed<number | undefined>(() => {
  return parseRatePerThousandUsd(
    runtimeConfigPublic.braveSearchCostPerThousandRequestsUsd,
  )
})

const exaRate = computed<number | undefined>(() => {
  const configKey = EXA_SEARCH_LEVEL_RATE_CONFIG_KEYS[props.exaSearchLevel]

  return parseRatePerThousandUsd(runtimeConfigPublic[configKey])
})

function describePerThousand(rate: number | undefined): string {
  return rate === undefined ? '' : ` $${rate} per 1,000 searches.`
}

const braveDescription = computed<string>(() => {
  return `Brave Search on your Brave key.${describePerThousand(
    braveRate.value,
  )}`
})

const exaDescription = computed<string>(() => {
  const depth = EXA_SEARCH_LEVEL_LABELS[props.exaSearchLevel]

  return `Exa on your Exa key, ${depth} depth.${describePerThousand(
    exaRate.value,
  )}`
})

const caption = computed<string>(() => {
  if (props.selected === 'web_search') {
    return builtInDescription.value
  }

  if (props.selected === 'web_search_brave') {
    return braveDescription.value
  }

  if (props.selected === 'web_search_exa') {
    return exaDescription.value
  }

  return 'Pick a search to let the model look things up on the web.'
})

const captionProviderId = computed<string | undefined>(() => {
  if (props.selected === 'web_search_brave') {
    return 'brave'
  }

  if (props.selected === 'web_search_exa') {
    return 'exa'
  }

  return undefined
})

const captionIcon = computed<string>(() => {
  return props.selected === 'web_search' ? 'lucide:globe' : 'lucide:search'
})

function getSegmentTooltip(option: WebSearchOption): string | undefined {
  if (!option.enabled) {
    return undefined
  }

  if (option.value === 'web_search') {
    return builtInDescription.value
  }

  if (option.value === 'web_search_brave') {
    return braveDescription.value
  }

  return exaDescription.value
}

const providerSegments = computed<SegmentedOption<WebSearchSelection>[]>(
  () => {
    return [
      {
        value: 'off',
        label: 'Off',
        title: 'Off',
        testId: 'web-search-option-off',
      },
      ...offeredOptions.value.map((option) => {
        const isBuiltIn = option.value === 'web_search'
        const title = option.disabledReason
          ? `${WEB_SEARCH_FULL_LABELS[option.value]}: `
          + option.disabledReason
          : WEB_SEARCH_FULL_LABELS[option.value]

        return {
          value: option.value,
          label: WEB_SEARCH_SHORT_LABELS[option.value],
          title,
          tooltip: getSegmentTooltip(option),
          icon: isBuiltIn ? 'lucide:globe' : undefined,
          providerId: option.providerId,
          disabled: !option.enabled,
          testId: `web-search-option-${option.value}`,
        }
      }),
    ]
  },
)

const hasExaOption = computed<boolean>(() => {
  return offeredOptions.value.some((option) => {
    return option.value === 'web_search_exa'
  })
})

const isExaSelected = computed<boolean>(() => {
  return props.selected === 'web_search_exa' && hasExaOption.value
})

function formatPerThousandPrice(
  value: string | number | undefined,
): string | undefined {
  const rate = parseRatePerThousandUsd(value)

  return rate === undefined ? undefined : `$${rate}/1k`
}

function formatLevelPrice(level: ExaSearchLevel): string | undefined {
  return formatPerThousandPrice(
    runtimeConfigPublic[EXA_SEARCH_LEVEL_RATE_CONFIG_KEYS[level]],
  )
}

const exaDepthSegments = computed<SegmentedOption<ExaSearchLevel>[]>(() => {
  return EXA_SEARCH_LEVELS.map((level) => {
    return {
      value: level,
      label: EXA_SEARCH_LEVEL_LABELS[level],
      title: exaSearchLevelHints[level],
      sub: formatLevelPrice(level),
      testId: `exa-search-level-${level}`,
    }
  })
})

const canUseAuto = computed<boolean>(() => {
  return props.selected !== 'off'
})

function onSelectProvider(value: WebSearchSelection) {
  if (value === props.selected) {
    return
  }

  emit('select-provider', value)
}

function onToggleAuto(isOn: boolean) {
  if (!canUseAuto.value) {
    return
  }

  emit('toggle-auto', isOn)
}
</script>

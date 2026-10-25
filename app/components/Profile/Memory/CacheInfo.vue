<template>
  <div
    role="alert"
    class="alert alert-soft alert-info rounded-box block p-4 text-sm"
    data-testid="memory-cache-info"
  >
    <details
      class="group"
      :open="isExpanded"
    >
      <summary
        class="
          flex cursor-pointer list-none items-center gap-2 font-semibold
          [&::-webkit-details-marker]:hidden
        "
        data-testid="memory-cache-info-toggle"
        @click.prevent="isExpanded = !isExpanded"
      >
        <Icon
          name="lucide:info"
          size="16"
          class="shrink-0"
        />
        <span class="min-w-0 flex-1">
          Repeated context is much cheaper with prompt caching
        </span>
        <Icon
          name="lucide:chevron-right"
          class="
            size-4 shrink-0 text-base-content/60 transition-transform
            group-open:rotate-90
          "
        />
      </summary>
      <div class="mt-3 grid gap-2">
        <p>
          Memory and project knowledge are sent with every message. Providers
          cache a repeated prompt start, so the next messages pay a fraction
          of the price.
        </p>
        <div
          v-if="!isMounted"
          class="skeleton skeleton--default h-4 w-full"
          data-testid="memory-cache-info-skeleton"
        />
        <template v-else>
          <p
            v-if="estimate"
            data-testid="memory-cache-info-example"
          >
            With <strong>{{ modelName }}</strong>,
            {{ TURNS }} messages with
            <span data-testid="memory-cache-info-tokens">{{
              formatApproxTokens(knowledgeTokens)
            }}</span>
            tokens of project knowledge cost
            {{ amountLeads.uncached }}
            <strong data-testid="memory-cache-info-uncached">{{
              formatCostUsd(estimate.uncached)
            }}</strong>
            <template v-if="isCachingPriced">
              without caching and
              {{ amountLeads.cached }}
              <strong data-testid="memory-cache-info-cached">{{
                formatCostUsd(estimate.cached)
              }}</strong>
              with it. Each change to the knowledge makes the next message in
              every chat of the project pay
              {{ amountLeads.perChange }}
              <strong data-testid="memory-cache-info-per-change">{{
                formatCostUsd(estimate.perChange)
              }}</strong>
              once, to cache it again.
            </template>
            <template v-else-if="isCachingUnavailable">
              because caching isn't available for it.
            </template>
            <template v-else>. {{ NO_CACHE_PRICE_LINE }}</template>
          </p>
          <p
            v-else
            data-testid="memory-cache-info-no-example"
          >
            No price is published for this model, so there is no cost
            example.
          </p>
          <p
            v-for="statusLine in statusLines"
            :key="statusLine"
            data-testid="memory-cache-info-status"
          >
            {{ statusLine }}
          </p>
          <p
            v-if="memoryIndexTokens > 0"
            data-testid="memory-cache-info-memory-index"
          >
            Your memory index ({{ formatApproxTokens(memoryIndexTokens) }}
            tokens) is cached the same way. Very short prompts can be below a
            provider's minimum cacheable size (Claude: 512 to 4,096 tokens
            depending on the model) and are then sent at full price.
          </p>
        </template>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import type { MemoryEntriesResponse } from '#shared/types/memory-api.d'
import { parsePerTokenPrice } from '#shared/utils/gateway-pricing'
import { estimateMemoryIndexTokens } from '#shared/utils/memory-index-estimate'
import type { PromptCacheCostEstimate } from '#shared/utils/prompt-cache-estimate'
import {
  estimatePromptCacheCost,
  formatCostUsd,
  formatApproxTokens,
  parseUsdPrice,
  toPricePerMillion,
} from '#shared/utils/prompt-cache-estimate'

type CacheRoute
  = | 'anthropic'
    | 'direct'
    | 'vercel'
    | 'openrouter-anthropic'
    | 'openrouter'
    | 'cloudflare'

interface CacheModel {
  route: CacheRoute
  providerName: string | null
  inputPrice: number | null
  cacheReadPrice: number | null
  cacheWritePrice: number | null
  contextLength: number
}

const TURNS = 20
const KNOWLEDGE_TOKEN_CAP = 64_000
const KNOWLEDGE_BUDGET_SHARE = 0.07
const UNKNOWN_CONTEXT_LENGTH = 128_000
const TOKENS_PER_MILLION = 1_000_000
const DESKTOP_QUERY = '(min-width: 640px)'
const MEMORY_ENTRIES_KEY = 'memory-entries:all'
const ANTHROPIC_PROVIDER_ID = 'anthropic'
const ANTHROPIC_MODEL_PREFIX = 'anthropic/'

const { selection, gatewayModel, name: modelName } = useSelectedModelInfo()
const { data: entriesData } = useNuxtData<MemoryEntriesResponse>(
  MEMORY_ENTRIES_KEY,
)

const isExpanded = shallowRef<boolean>(true)
const isMounted = shallowRef<boolean>(false)

onMounted(() => {
  isExpanded.value = window.matchMedia(DESKTOP_QUERY).matches
  isMounted.value = true
})

watchPostEffect(() => {
  const current = selection.value

  if (!isMounted.value || current.source !== 'gateway') {
    return
  }

  hydrateGatewayCatalog(current.gatewayId)
})

function toAmountLead(amount: number): string {
  return formatCostUsd(amount).startsWith('<') ? '' : 'about'
}

function toOptionalPerMillion(
  amount: number | undefined,
  unitTokens: number,
): number | null {
  const parsed = parseUsdPrice(amount)

  return parsed === null ? null : toPricePerMillion(parsed, unitTokens)
}

function resolveDirectCacheModel(modelId: string): CacheModel | null {
  const { model, provider } = getModel(modelId)

  if (!model) {
    return null
  }

  const unitTokens = model.price.tokens
  const inputAmount = parseUsdPrice(model.price.input)

  return {
    route: provider?.id === ANTHROPIC_PROVIDER_ID ? 'anthropic' : 'direct',
    providerName: provider?.name ?? null,
    inputPrice: inputAmount === null
      ? null
      : toPricePerMillion(inputAmount, unitTokens),
    cacheReadPrice: toOptionalPerMillion(model.price.cacheRead, unitTokens),
    cacheWritePrice: toOptionalPerMillion(model.price.cacheWrite, unitTokens),
    contextLength: model.contextLength,
  }
}

function resolveGatewayRoute(
  gatewayId: string,
  modelId: string,
): CacheRoute {
  if (gatewayId === 'cloudflare') {
    return 'cloudflare'
  }

  if (gatewayId === 'vercel') {
    return 'vercel'
  }

  return modelId.startsWith(ANTHROPIC_MODEL_PREFIX)
    ? 'openrouter-anthropic'
    : 'openrouter'
}

function resolveGatewayCacheModel(
  gatewayId: string,
  modelId: string,
): CacheModel {
  const pricePerToken = parsePerTokenPrice(gatewayModel.value?.pricing?.input)

  return {
    route: resolveGatewayRoute(gatewayId, modelId),
    providerName: null,
    inputPrice: pricePerToken === null
      ? null
      : pricePerToken * TOKENS_PER_MILLION,
    cacheReadPrice: null,
    cacheWritePrice: null,
    contextLength: gatewayModel.value?.contextLength ?? UNKNOWN_CONTEXT_LENGTH,
  }
}

const cacheModel = computed<CacheModel | null>(() => {
  const current = selection.value

  if (current.source === 'provider') {
    return resolveDirectCacheModel(current.modelId)
  }

  return resolveGatewayCacheModel(current.gatewayId, current.modelId)
})

const knowledgeTokens = computed<number>(() => {
  const contextLength = cacheModel.value?.contextLength ?? 0

  return Math.min(
    KNOWLEDGE_TOKEN_CAP,
    Math.floor(KNOWLEDGE_BUDGET_SHARE * contextLength),
  )
})

const isCachingPriced = computed<boolean>(() => {
  const current = cacheModel.value

  if (!current || current.route === 'cloudflare') {
    return false
  }

  return current.cacheReadPrice !== null || current.cacheWritePrice !== null
})

const isCachingUnavailable = computed<boolean>(() => {
  return cacheModel.value?.route === 'cloudflare'
})

const estimate = computed<PromptCacheCostEstimate | null>(() => {
  const current = cacheModel.value

  if (!current || current.inputPrice === null) {
    return null
  }

  return estimatePromptCacheCost({
    tokens: knowledgeTokens.value,
    turns: TURNS,
    inputPrice: current.inputPrice,
    cacheReadPrice: current.cacheReadPrice,
    cacheWritePrice: current.cacheWritePrice,
  })
})

const ROUTE_LINES: Record<Exclude<CacheRoute, 'direct'>, string> = {
  'anthropic': 'Besidka turns on caching for Claude. Cached context expires '
    + 'after 5 minutes without a message.',
  'vercel': 'Caching is requested from the gateway (best effort).',
  'openrouter-anthropic': 'Caching is on for this model.',
  'openrouter': 'Depends on the upstream provider.',
  'cloudflare': 'Caching is not available through this gateway: every '
    + 'message pays the full price.',
}

const NO_CACHE_PRICE_LINE = 'No cache price is published for this model, so '
  + 'the example assumes full price.'

function describeRoute(current: CacheModel): string {
  if (current.route === 'direct') {
    return `${current.providerName ?? 'The provider'} caches repeated `
      + 'context automatically. It is best effort: the provider decides.'
  }

  return ROUTE_LINES[current.route]
}

const amountLeads = computed(() => {
  return {
    uncached: toAmountLead(estimate.value?.uncached ?? 0),
    cached: toAmountLead(estimate.value?.cached ?? 0),
    perChange: toAmountLead(estimate.value?.perChange ?? 0),
  }
})

const statusLines = computed<string[]>(() => {
  const current = cacheModel.value

  if (!current) {
    return []
  }

  return [describeRoute(current)]
})

const memoryIndexTokens = computed<number>(() => {
  const groups = entriesData.value?.groups

  if (!groups) {
    return 0
  }

  return estimateMemoryIndexTokens(
    groups.flatMap(group => group.entries),
  )
})
</script>

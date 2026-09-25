<template>
  <div
    role="alert"
    class="alert alert-soft alert-info !items-start mb-6"
    data-testid="search-providers-info"
  >
    <Icon
      name="lucide:info"
      size="20"
      class="mt-0.5 shrink-0"
    />
    <div class="grid gap-2 text-sm">
      <p>
        Models without built-in web search can search through Besidka
        with a Brave or Exa key if they support tool calling — models
        with native search keep using their own. One search provider
        runs per message, and you're billed by the provider on your
        own key.
      </p>
      <p class="font-semibold">
        Pricing per 1,000 searches
      </p>
      <div class="overflow-x-auto">
        <table class="table table-xs">
          <thead>
            <tr>
              <th>Search</th>
              <th>Price</th>
              <th>Free allowance</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in byokPricingRows"
              :key="row.name"
            >
              <td>{{ row.name }}</td>
              <td>{{ row.price }}</td>
              <td>{{ row.freeAllowance }}</td>
            </tr>
          </tbody>
          <tbody class="border-t border-base-300">
            <tr
              v-for="row in builtInPricingRows"
              :key="row.name"
            >
              <td>{{ row.name }}</td>
              <td>{{ row.price }}</td>
              <td class="whitespace-normal">{{ row.freeAllowance }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs opacity-75">
        List prices as of September 2026 and may change. Besidka's cost
        estimates use list prices before any free allowance.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface SearchPricingRow {
  name: string
  price: string
  freeAllowance: string
}

function formatRatePerThousandUsd(
  value: string | number | undefined,
): string {
  const parsed = Number(value)

  return Number.isFinite(parsed) && parsed > 0 ? `$${parsed}` : '—'
}

const {
  braveSearchCostPerThousandRequestsUsd,
  exaSearchCostPerThousandRequestsUsd,
  anthropicWebSearchCostPerThousandSearchesUsd,
  openaiWebSearchCostPerThousandCallsUsd,
  googleSearchCostPerThousandQueriesUsd,
  googleSearchCostPerThousandGroundedPromptsUsd,
} = useRuntimeConfig().public

const geminiFreeAllowanceCopy = {
  gemini3: 'First 5,000 queries / month free on paid billing (shared '
    + 'across Gemini 3.x; one prompt can run several queries)',
  geminiOlder: '1,500 prompts / day free on paid billing (Flash: 500 / '
    + 'day on the free tier)',
}

const byokPricingRows: SearchPricingRow[] = [
  {
    name: 'Brave Search',
    price: formatRatePerThousandUsd(braveSearchCostPerThousandRequestsUsd),
    freeAllowance: '$5 credit / month (card required)',
  },
  {
    name: 'Exa',
    price: formatRatePerThousandUsd(exaSearchCostPerThousandRequestsUsd),
    freeAllowance: '$10 credit / month (no card)',
  },
]

const builtInPricingRows: SearchPricingRow[] = [
  {
    name: 'Gemini 3.x built-in',
    price: formatRatePerThousandUsd(googleSearchCostPerThousandQueriesUsd),
    freeAllowance: geminiFreeAllowanceCopy.gemini3,
  },
  {
    name: 'Gemini 2.5 built-in',
    price: formatRatePerThousandUsd(
      googleSearchCostPerThousandGroundedPromptsUsd,
    ),
    freeAllowance: geminiFreeAllowanceCopy.geminiOlder,
  },
  {
    name: 'Anthropic built-in',
    price: formatRatePerThousandUsd(
      anthropicWebSearchCostPerThousandSearchesUsd,
    ),
    freeAllowance: '—',
  },
  {
    name: 'OpenAI built-in',
    price: formatRatePerThousandUsd(openaiWebSearchCostPerThousandCallsUsd),
    freeAllowance: '—',
  },
]
</script>

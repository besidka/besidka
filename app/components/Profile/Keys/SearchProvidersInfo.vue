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
              <td>${{ row.ratePerThousandUsd }}</td>
              <td>{{ row.freeAllowance }}</td>
            </tr>
          </tbody>
          <tbody class="border-t border-base-300">
            <tr
              v-for="row in builtInPricingRows"
              :key="row.name"
            >
              <td>{{ row.name }}</td>
              <td>${{ row.ratePerThousandUsd }}</td>
              <td>{{ row.freeAllowance }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs opacity-75">
        List prices as of September 2026 and may change.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
interface SearchPricingRow {
  name: string
  ratePerThousandUsd: number
  freeAllowance: string
}

const braveRatePerThousandUsd = 5
const exaRatePerThousandUsd = 7
const anthropicRatePerThousandUsd = 10
const openaiRatePerThousandUsd = 10
const googleGemini3RatePerThousandUsd = 14
const googleGeminiOlderRatePerThousandUsd = 35

const byokPricingRows: SearchPricingRow[] = [
  {
    name: 'Brave Search',
    ratePerThousandUsd: braveRatePerThousandUsd,
    freeAllowance: '$5 credit / month (card required)',
  },
  {
    name: 'Exa',
    ratePerThousandUsd: exaRatePerThousandUsd,
    freeAllowance: '$10 credit / month (no card)',
  },
]

const builtInPricingRows: SearchPricingRow[] = [
  {
    name: 'Gemini 3.x built-in',
    ratePerThousandUsd: googleGemini3RatePerThousandUsd,
    freeAllowance: '5,000 / month (billing required)',
  },
  {
    name: 'Gemini 2.5 built-in',
    ratePerThousandUsd: googleGeminiOlderRatePerThousandUsd,
    freeAllowance: '1,500 / day with billing (Flash: 500 / day without)',
  },
  {
    name: 'Anthropic built-in',
    ratePerThousandUsd: anthropicRatePerThousandUsd,
    freeAllowance: '—',
  },
  {
    name: 'OpenAI built-in',
    ratePerThousandUsd: openaiRatePerThousandUsd,
    freeAllowance: '—',
  },
]
</script>

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
        Some models have no built-in web search — many gateway models,
        DeepSeek on some routes, and open-weight Workers AI models. Add a
        Brave or Exa key and any tool-calling model can search the web
        through Besidka. Models with native search keep using their own.
      </p>
      <ul class="list-disc pl-4">
        <li>One search provider runs per message.</li>
        <li>
          Billed by the search provider straight to your key — Besidka
          never sees the charge.
        </li>
      </ul>
      <ul class="list-disc pl-4">
        <li>
          Brave ≈ ${{ braveRatePerThousandUsd }} / 1,000 searches
        </li>
        <li>
          Exa ≈ ${{ exaRatePerThousandUsd }} / 1,000 searches
        </li>
        <li>
          Built-in — Anthropic ≈ ${{ anthropicRatePerThousandUsd }} / 1,000,
          OpenAI ≈ ${{ openaiRatePerThousandUsd }} / 1,000
        </li>
        <li>
          Built-in — Google ≈ ${{ googleGemini3RatePerThousandUsd }} / 1,000
          (Gemini 3.x), ${{ googleGeminiOlderRatePerThousandUsd }} / 1,000
          grounded prompts on older Gemini models
        </li>
      </ul>
      <p class="text-xs opacity-75">
        Published list prices, may change — you pay the search provider
        directly with your own key.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
const braveRatePerThousandUsd = 5
const exaRatePerThousandUsd = 7
const anthropicRatePerThousandUsd = 10
const openaiRatePerThousandUsd = 10
const googleGemini3RatePerThousandUsd = 14
const googleGeminiOlderRatePerThousandUsd = 35
</script>

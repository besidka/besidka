<template>
  <div
    data-testid="reasoning-search-step"
    class="my-2.5 min-w-0 flex-1"
  >
    <button
      :id="`${idPrefix}-trigger`"
      type="button"
      :aria-expanded="isExpanded"
      :aria-controls="`${idPrefix}-content`"
      :disabled="!isExpandable"
      data-testid="reasoning-search-step-trigger"
      class="
        flex w-full min-w-0 items-center gap-1.5 text-left text-xs
        disabled:cursor-default
      "
      :class="isExpandable ? 'cursor-pointer' : undefined"
      @click="toggle"
    >
      <span
        data-testid="reasoning-search-step-title"
        class="shrink-0"
        :class="
          props.pending
            ? 'skeleton skeleton-text reasoning-main-title-skeleton'
            : undefined
        "
      >
        {{ title }}{{ props.pending ? '…' : '' }}
      </span>
      <span
        v-if="data.query.length > 0"
        :title="data.query"
        data-testid="reasoning-search-step-query"
        class="min-w-0 truncate text-base-content/60"
      >
        “{{ data.query }}”
      </span>
      <span
        v-if="data.freshness"
        data-testid="reasoning-search-step-freshness"
        class="badge badge-soft badge-xs shrink-0"
      >
        {{ getSearchFreshnessLabel(data.freshness) }}
      </span>
      <span
        v-if="countLabel.length > 0"
        data-testid="reasoning-search-step-count"
        class="shrink-0 text-base-content/60"
      >
        {{ countLabel }}
      </span>
      <Icon
        v-if="isExpandable"
        name="lucide:chevron-right"
        class="size-4 shrink-0 transition-transform"
        :class="isExpanded ? 'rotate-90' : undefined"
      />
    </button>
    <div
      v-if="isExpanded"
      :id="`${idPrefix}-content`"
      role="region"
      :aria-labelledby="`${idPrefix}-trigger`"
      class="mt-2 min-w-0"
    >
      <p
        v-if="data.state === 'failed'"
        data-testid="reasoning-search-step-error"
        class="text-xs text-error/80 break-words"
      >
        {{ data.errorReason }}
      </p>
      <ul
        v-else
        data-testid="reasoning-search-step-results"
        class="flex flex-col gap-1.5"
      >
        <li
          v-for="(result, resultIndex) in visibleResults"
          :key="`${resultIndex}-${result.url}`"
          class="flex min-w-0 items-baseline gap-2 text-xs"
        >
          <span
            data-testid="reasoning-search-step-host"
            class="max-w-28 shrink-0 truncate text-base-content/60"
          >
            {{ formatResearchLinkLabel(result.url) }}
          </span>
          <button
            v-if="isHttpUrl(result.url)"
            type="button"
            data-testid="reasoning-search-step-link"
            class="link link-hover min-w-0 truncate text-left"
            :title="getResultTitle(result)"
            @click="openResearchLink(result.url)"
          >
            {{ getResultTitle(result) }}
          </button>
          <span
            v-else
            data-testid="reasoning-search-step-text"
            class="min-w-0 truncate"
            :title="getResultTitle(result)"
          >
            {{ getResultTitle(result) }}
          </span>
          <span
            v-if="formatSearchResultDate(result.publishedDate ?? '')"
            data-testid="reasoning-search-step-date"
            class="ml-auto shrink-0 text-base-content/60"
          >
            {{ formatSearchResultDate(result.publishedDate ?? '') }}
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { isHttpUrl } from '#shared/utils/http-url'
import type { SearchStepData, SearchStepResult } from '~/types/search-step.d'

const props = defineProps<{
  data: SearchStepData
  title: string
  pending: boolean
  idPrefix: string
}>()

const { openResearchLink } = useResearchLink()

const isExpanded = shallowRef<boolean>(false)

const visibleResults = computed<SearchStepResult[]>(() => {
  return props.data.results.slice(0, SEARCH_STEP_MAX_RESULTS)
})

const isExpandable = computed<boolean>(() => {
  if (props.data.state === 'failed') {
    return true
  }

  return props.data.hasOutput && visibleResults.value.length > 0
})

const countLabel = computed<string>(() => {
  if (props.data.state === 'failed' || !props.data.hasOutput) {
    return ''
  }

  return formatSearchResultCount(props.data.results.length)
})

watch(isExpandable, (expandable) => {
  if (!expandable) {
    isExpanded.value = false
  }
})

function toggle() {
  if (!isExpandable.value) {
    return
  }

  isExpanded.value = !isExpanded.value
}

function getResultTitle(result: SearchStepResult): string {
  return result.title.trim() || formatResearchLinkLabel(result.url)
}
</script>

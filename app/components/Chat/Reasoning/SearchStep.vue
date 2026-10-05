<template>
  <div
    data-testid="reasoning-search-step"
    class="my-2.5 min-w-0 flex-1"
  >
    <button
      type="button"
      :aria-expanded="isExpandable ? isExpanded : undefined"
      :aria-controls="isExpandable && isExpanded ? contentId : undefined"
      :disabled="!isExpandable"
      data-testid="reasoning-search-step-trigger"
      class="
        flex w-full min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5
        text-left text-xs disabled:cursor-default
      "
      :class="isExpandable ? 'cursor-pointer' : undefined"
      @click="toggle"
    >
      <span
        data-testid="reasoning-search-step-title"
        class="order-1 min-w-0"
        :class="
          props.pending
            ? 'skeleton skeleton-text reasoning-main-title-skeleton'
            : undefined
        "
      >
        {{ title }}{{ props.pending ? '…' : '' }}
      </span>
      <Icon
        v-if="isExpandable"
        name="lucide:chevron-right"
        class="
          order-2 size-4 shrink-0 transition-transform sm:order-3
        "
        :class="isExpanded ? 'rotate-90' : undefined"
      />
      <span
        v-if="hasMeta"
        data-testid="reasoning-search-step-meta"
        class="
          order-3 flex min-w-0 basis-full items-center gap-1.5
          sm:order-2 sm:basis-auto
        "
      >
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
      </span>
    </button>
    <div
      v-if="isExpanded"
      :id="contentId"
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
            {{ result.host }}
          </span>
          <button
            v-if="result.isLink"
            type="button"
            data-testid="reasoning-search-step-link"
            class="link link-hover min-w-0 truncate text-left"
            :title="result.title"
            @click="openResearchLink(result.url)"
          >
            {{ result.title }}
          </button>
          <span
            v-else
            data-testid="reasoning-search-step-text"
            class="min-w-0 truncate"
            :title="result.title"
          >
            {{ result.title }}
          </span>
          <span
            v-if="result.date.length > 0"
            data-testid="reasoning-search-step-date"
            class="ml-auto shrink-0 text-base-content/60"
          >
            {{ result.date }}
          </span>
        </li>
        <li
          v-if="hiddenResultsCount > 0"
          data-testid="reasoning-search-step-more"
          class="text-xs text-base-content/60"
        >
          +{{ hiddenResultsCount }} more
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
}>()

interface SearchStepResultRow {
  url: string
  title: string
  host: string
  date: string
  isLink: boolean
}

const { openResearchLink } = useResearchLink()

const contentId = useId()

const isExpanded = shallowRef<boolean>(false)

const visibleResults = computed<SearchStepResultRow[]>(() => {
  return props.data.results
    .slice(0, SEARCH_STEP_MAX_RESULTS)
    .map((result) => {
      return {
        url: result.url,
        title: getResultTitle(result),
        host: formatResearchLinkLabel(result.url),
        date: formatSearchResultDate(result.publishedDate ?? ''),
        isLink: isHttpUrl(result.url),
      }
    })
})

const hiddenResultsCount = computed<number>(() => {
  return Math.max(props.data.results.length - SEARCH_STEP_MAX_RESULTS, 0)
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

const hasMeta = computed<boolean>(() => {
  return props.data.query.length > 0
    || !!props.data.freshness
    || countLabel.value.length > 0
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

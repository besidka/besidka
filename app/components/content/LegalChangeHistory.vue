<template>
  <div data-testid="legal-change-history">
    <p
      v-if="items.length === 0"
      data-testid="legal-change-history-empty"
    >
      {{ LEGAL_CHANGE_HISTORY_EMPTY_TEXT }}
    </p>
    <template v-else>
      <section
        v-for="item in items"
        :key="item.id"
        :data-testid="`legal-change-history-${item.id}`"
      >
        <p>
          <strong>
            Announced
            <time :datetime="item.publishedAt">{{ item.publishedLabel }}</time>,
            in effect from
            <time :datetime="item.effectiveAt">{{ item.effectiveLabel }}</time>
          </strong>
        </p>
        <ul>
          <li v-for="(line, lineIndex) in item.summary" :key="lineIndex">
            {{ line }}
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import {
  LEGAL_CHANGE_HISTORY_EMPTY_TEXT,
  buildLegalChangeHistoryItems,
} from '#shared/utils/legal-change-history'
import type { LegalDocumentId } from '#shared/utils/legal-notices'

const props = defineProps<{
  document?: LegalDocumentId
}>()

const items = computed(() => {
  return buildLegalChangeHistoryItems(props.document)
})
</script>

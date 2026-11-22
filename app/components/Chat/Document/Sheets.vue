<template>
  <div class="grid grid-cols-[minmax(0,1fr)] gap-3">
    <div
      role="tablist"
      aria-label="Sheets"
      class="tabs tabs-box max-w-full overflow-x-auto"
      data-testid="document-sheet-tabs"
      @keydown="onTabKeydown"
    >
      <button
        v-for="(sheet, sheetIndex) in sheets"
        :id="`${tabsId}-tab-${sheetIndex}`"
        :key="`sheet-tab-${sheetIndex}`"
        type="button"
        role="tab"
        class="tab shrink-0"
        :class="[
          `js-document-sheet-tab-${sheetIndex}`,
          { 'tab-active': activeIndex === sheetIndex },
        ]"
        :aria-selected="activeIndex === sheetIndex"
        :aria-controls="`${tabsId}-panel`"
        :tabindex="activeIndex === sheetIndex ? 0 : -1"
        :data-testid="`document-sheet-tab-${sheetIndex}`"
        @click="selectedIndex = sheetIndex"
      >
        {{ sheet.name }}
      </button>
    </div>
    <div
      v-if="activeSheet"
      :id="`${tabsId}-panel`"
      role="tabpanel"
      :aria-labelledby="`${tabsId}-tab-${activeIndex}`"
      class="grid grid-cols-[minmax(0,1fr)] gap-2"
    >
      <div
        class="max-w-full overflow-auto rounded-box border border-base-300"
        :class="{ 'max-h-[60vh]': activeSheet.freezeHeader !== false }"
        tabindex="0"
        role="region"
        :aria-label="`${activeSheet.name} data`"
        data-testid="document-sheet-table"
      >
        <table class="table table-zebra table-pin-rows table-sm">
          <thead>
            <tr>
              <th
                v-for="(column, columnIndex) in activeSheet.columns"
                :key="`column-${columnIndex}`"
                scope="col"
                :class="isNumericColumn(column.type) ? 'text-right' : ''"
              >
                {{ column.header }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in visibleRows"
              :key="`row-${rowIndex}`"
              data-testid="document-sheet-row"
            >
              <td
                v-for="(column, columnIndex) in activeSheet.columns"
                :key="`cell-${rowIndex}-${columnIndex}`"
                :class="isNumericColumn(column.type) ? 'text-right' : ''"
              >
                {{ formatDocumentCell(row[columnIndex]) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p
        v-if="isRowLimited"
        class="text-xs text-base-content/60"
        data-testid="document-sheet-row-limit"
      >
        Showing {{ DOCUMENT_PREVIEW_ROW_LIMIT.toLocaleString('en-US') }} of
        {{ activeSheet.rows.length.toLocaleString('en-US') }} rows
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Cell, Sheet } from '@besidka/doc-renderer/spec'
import { DOCUMENT_PREVIEW_ROW_LIMIT } from '#shared/utils/documents'

const props = defineProps<{
  sheets: Sheet[]
}>()

const NUMERIC_COLUMN_TYPES = ['number', 'integer', 'currency', 'percent']

const tabsId = useId()
const selectedIndex = shallowRef<number>(0)

const activeIndex = computed<number>(() => {
  return Math.min(selectedIndex.value, Math.max(props.sheets.length - 1, 0))
})

const activeSheet = computed<Sheet | null>(() => {
  return props.sheets[activeIndex.value] ?? null
})

const visibleRows = computed<Cell[][]>(() => {
  return (activeSheet.value?.rows ?? []).slice(0, DOCUMENT_PREVIEW_ROW_LIMIT)
})

const isRowLimited = computed<boolean>(() => {
  return (activeSheet.value?.rows.length ?? 0) > DOCUMENT_PREVIEW_ROW_LIMIT
})

function isNumericColumn(type: string): boolean {
  return NUMERIC_COLUMN_TYPES.includes(type)
}

async function onTabKeydown(event: KeyboardEvent) {
  const lastIndex = props.sheets.length - 1
  let nextIndex: number

  if (event.key === 'ArrowRight') {
    nextIndex = activeIndex.value >= lastIndex ? 0 : activeIndex.value + 1
  } else if (event.key === 'ArrowLeft') {
    nextIndex = activeIndex.value <= 0 ? lastIndex : activeIndex.value - 1
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = lastIndex
  } else {
    return
  }

  event.preventDefault()
  selectedIndex.value = nextIndex

  const tabList = event.currentTarget as HTMLElement

  await nextTick()

  tabList
    .querySelector<HTMLElement>(`.js-document-sheet-tab-${nextIndex}`)
    ?.focus()
}
</script>

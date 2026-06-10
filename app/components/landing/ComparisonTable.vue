<template>
  <div class="overflow-x-auto w-full rounded-box focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
    <table
      class="table table-sm table-pin-rows table-pin-cols w-full table-fixed
        min-w-[56rem]"
      aria-labelledby="comparison-caption-id"
    >
      <caption id="comparison-caption-id" class="sr-only">
        {{ caption || 'Feature comparison between Besidka and alternatives' }}
      </caption>

      <thead>
        <tr class="z-20 bg-transparent border-b border-base-content/10">
          <th
            scope="col"
            class="z-30 bg-base-100/80 backdrop-blur-lg backdrop-saturate-150
              text-left font-medium text-base-content/60 py-2 pr-4
              w-[7rem] sm:w-[9.5rem]"
          />
          <th
            v-for="(col, colIndex) in columns"
            :key="colIndex"
            scope="col"
            class="text-center font-semibold py-2 px-3 min-w-[7rem]"
            :class="colIndex === 0
              ? 'static sm:sticky sm:left-[9.5rem] z-20 text-accent '
                + 'sm:bg-base-100/80 sm:backdrop-blur-lg '
                + 'sm:backdrop-saturate-150'
              : 'static text-base-content/80'"
          >
            {{ col }}
          </th>
        </tr>
      </thead>

      <tbody>
        <tr
          v-for="(row, rowIndex) in rows"
          :key="rowIndex"
          class="border-b border-base-content/10 last:border-0"
        >
          <th
            scope="row"
            class="z-10 bg-base-100/80 backdrop-blur-lg backdrop-saturate-150
              text-left font-medium text-base-content/70 py-3 pr-4
              text-xs sm:text-sm w-[7rem] sm:w-[9.5rem]"
          >
            {{ row.label }}
          </th>
          <td
            v-for="(value, colIndex) in row.values"
            :key="colIndex"
            class="text-center py-3 px-3 min-w-[7rem]"
            :class="colIndex === 0
              ? 'static sm:sticky sm:left-[9.5rem] z-10 '
                + 'sm:bg-base-100/80 sm:backdrop-blur-lg '
                + 'sm:backdrop-saturate-150 text-accent font-medium'
              : 'bg-transparent text-base-content/70'"
          >
            <span v-if="value === 'yes'" aria-label="Yes">
              <Icon
                name="lucide:check"
                class="w-4 h-4 mx-auto"
                aria-hidden="true"
              />
              <span class="sr-only">Yes</span>
            </span>
            <span v-else-if="value === 'no'" aria-label="No">
              <Icon
                name="lucide:x"
                class="w-4 h-4 mx-auto text-base-content/30"
                aria-hidden="true"
              />
              <span class="sr-only">No</span>
            </span>
            <span v-else class="text-xs sm:text-sm leading-snug">
              {{ value }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
type ComparisonRow = {
  label: string
  values: string[]
}

withDefaults(defineProps<{
  caption?: string
  columns?: string[]
  rows?: ComparisonRow[]
}>(), {
  caption: undefined,
  columns: () => [],
  rows: () => [],
})
</script>

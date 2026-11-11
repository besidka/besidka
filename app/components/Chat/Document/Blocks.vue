<template>
  <div class="grid grid-cols-[minmax(0,1fr)] gap-3">
    <template
      v-for="(block, blockIndex) in blocks"
      :key="`block-${blockIndex}`"
    >
      <component
        :is="HEADING_TAGS[block.level]"
        v-if="block.type === 'heading'"
        class="font-semibold leading-snug break-words"
        :class="HEADING_CLASSES[block.level]"
        data-testid="document-block-heading"
      >
        {{ block.text }}
      </component>
      <p
        v-else-if="block.type === 'paragraph'"
        class="break-words"
        :class="block.align ? ALIGN_CLASSES[block.align] : ''"
        data-testid="document-block-paragraph"
      >
        <ChatDocumentRuns :runs="block.runs" />
      </p>
      <ChatDocumentList
        v-else-if="block.type === 'list'"
        :items="block.items"
        :ordered="block.ordered"
        data-testid="document-block-list"
      />
      <div
        v-else-if="block.type === 'table'"
        class="max-w-full overflow-x-auto rounded-box border border-base-300"
        tabindex="0"
        role="region"
        aria-label="Table"
        data-testid="document-block-table"
      >
        <table class="table table-zebra table-sm">
          <thead v-if="block.header">
            <tr>
              <th
                v-for="(column, columnIndex) in block.columns"
                :key="`column-${columnIndex}`"
                scope="col"
                :class="column.align ? ALIGN_CLASSES[column.align] : ''"
              >
                {{ column.text }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, rowIndex) in block.rows"
              :key="`row-${rowIndex}`"
            >
              <td
                v-for="(cell, cellIndex) in row"
                :key="`cell-${rowIndex}-${cellIndex}`"
                :class="block.columns[cellIndex]?.align
                  ? ALIGN_CLASSES[block.columns[cellIndex].align]
                  : ''"
              >
                <ChatDocumentRuns :runs="cell" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <blockquote
        v-else-if="block.type === 'quote'"
        class="border-s-4 border-base-300 ps-3 italic text-base-content/80"
        data-testid="document-block-quote"
      >
        <ChatDocumentRuns :runs="block.runs" />
      </blockquote>
      <pre
        v-else-if="block.type === 'code'"
        class="m-0 max-w-full overflow-x-auto rounded-field border border-base-300 bg-base-100 p-2 font-mono text-xs whitespace-pre"
        tabindex="0"
        aria-label="Code"
        data-testid="document-block-code"
      ><code>{{ block.text }}</code></pre>
      <p
        v-else-if="block.type === 'image'"
        class="flex items-center gap-2 rounded-field border border-dashed border-base-300 bg-base-100 p-3 text-xs text-base-content/70"
        data-testid="document-block-image"
      >
        <Icon
          name="lucide:image"
          size="16"
          class="shrink-0"
          aria-hidden="true"
        />
        <span class="break-words">Image: {{ block.alt }}</span>
      </p>
      <hr
        v-else-if="block.type === 'pageBreak'"
        class="border-base-300"
        data-testid="document-block-page-break"
      >
    </template>
  </div>
</template>

<script setup lang="ts">
import type { Block } from '@besidka/doc-renderer/spec'

defineProps<{
  blocks: Block[]
}>()

const HEADING_TAGS: Record<number, string> = {
  1: 'h4',
  2: 'h5',
  3: 'h6',
  4: 'h6',
}

const HEADING_CLASSES: Record<number, string> = {
  1: 'text-xl',
  2: 'text-lg',
  3: 'text-base',
  4: 'text-sm',
}

const ALIGN_CLASSES: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
}
</script>

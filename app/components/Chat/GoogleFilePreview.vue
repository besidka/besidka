<template>
  <article
    class="grid grid-cols-[minmax(0,1fr)] gap-4 py-4 text-sm"
    :data-kind="kind"
    data-testid="google-file-preview"
  >
    <header class="grid gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="inline-flex items-center gap-1.5 text-xs text-base-content/70">
          <Icon
            :name="GOOGLE_FILE_KIND_ICONS[kind]"
            size="16"
            aria-hidden="true"
            data-testid="google-file-preview-icon"
          />
          <span data-testid="google-file-preview-product">
            {{ GOOGLE_FILE_KIND_LABELS[kind] }}
          </span>
        </span>
        <h3
          class="min-w-0 grow text-base font-semibold leading-snug break-words"
          data-testid="google-file-preview-title"
        >
          {{ title }}
        </h3>
      </div>
      <p
        class="text-xs text-base-content/60"
        data-testid="google-file-preview-note"
      >
        As created by Besidka. Later edits in Google are not shown here.
      </p>
    </header>
    <div
      v-if="kind === 'document'"
      class="max-w-full overflow-auto rounded-box border border-base-300 p-3"
      tabindex="0"
      role="region"
      aria-label="File content"
      data-testid="google-file-preview-content"
    >
      <MDCCached
        :value="content"
        :cache-key="`google-file:${toolCallId}`"
        :components="messageComponents"
        :parser-options="getParserOptions('user')"
        class="chat-markdown"
      />
    </div>
    <div
      v-else-if="tableRows"
      class="max-w-full overflow-auto rounded-box border border-base-300 max-h-[60vh]"
      tabindex="0"
      role="region"
      aria-label="File content"
      data-testid="google-file-preview-content"
    >
      <table
        class="table table-zebra table-pin-rows table-sm"
        data-testid="google-file-preview-table"
      >
        <thead>
          <tr>
            <th
              v-for="(cell, columnIndex) in tableRows.header"
              :key="`column-${columnIndex}`"
              scope="col"
            >
              {{ cell }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, rowIndex) in tableRows.body"
            :key="`row-${rowIndex}`"
            data-testid="google-file-preview-row"
          >
            <td
              v-for="(cell, columnIndex) in row"
              :key="`cell-${rowIndex}-${columnIndex}`"
            >
              {{ cell }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <div
      v-else
      class="max-w-full overflow-auto rounded-box border border-base-300 p-3"
      tabindex="0"
      role="region"
      aria-label="File content"
      data-testid="google-file-preview-content"
    >
      <pre
        class="whitespace-pre-wrap break-words font-mono text-xs"
        data-testid="google-file-preview-text"
      >{{ content }}</pre>
    </div>
  </article>
</template>

<script setup lang="ts">
import {
  GOOGLE_FILE_KIND_ICONS,
  GOOGLE_FILE_KIND_LABELS,
} from '#shared/utils/google-created-file'
import type { GoogleCreatedFileKind } from '#shared/utils/google-created-file'
import { parseStrictCsv } from '#shared/utils/google-drive-write'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  toolCallId: string
  title: string
  kind: GoogleCreatedFileKind
  content: string
}>()

const { messageComponents, getParserOptions } = useChatFormat()

const tableRows = computed<{ header: string[], body: string[][] } | null>(
  () => {
    if (props.kind !== 'spreadsheet') {
      return null
    }

    const table = parseStrictCsv(props.content)

    if (!table.ok || table.value.length === 0) {
      return null
    }

    const [header = [], ...body] = table.value

    return { header, body }
  },
)
</script>

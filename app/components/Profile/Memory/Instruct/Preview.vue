<template>
  <ul
    class="grid gap-2"
    data-testid="memory-instruct-operations"
  >
    <li
      v-for="operation in operations"
      :key="operation.key"
      class="flex items-start gap-3 rounded-box bg-base-content/5 p-3"
      :class="{ 'opacity-70': operation.status === 'rejected' }"
      :data-testid="`memory-instruct-operation-${operation.key}`"
      :data-kind="operation.kind"
      :data-status="operation.status"
    >
      <span class="flex w-5 shrink-0 justify-center pt-0.5">
        <input
          v-if="operation.status === 'ready'"
          type="checkbox"
          class="checkbox checkbox-sm"
          :checked="selected.includes(operation.key)"
          :aria-label="describeToggle(operation)"
          :data-testid="`memory-instruct-toggle-${operation.key}`"
          @change="toggle(operation.key, $event)"
        >
        <Icon
          v-else
          name="lucide:ban"
          size="16"
          class="text-warning"
          aria-hidden="true"
        />
      </span>
      <div class="grid min-w-0 flex-1 gap-1">
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="badge badge-sm badge-soft"
            :class="kindBadgeClass(operation)"
            :data-testid="`memory-instruct-kind-${operation.key}`"
          >
            {{ kindLabel(operation) }}
          </span>
          <span class="badge badge-sm badge-ghost">
            {{ memoryCategoryLabels[operation.category] }}
          </span>
          <span class="min-w-0 break-words text-sm font-semibold">
            {{ operationTitle(operation) }}
          </span>
        </div>
        <template v-if="operation.status === 'rejected'">
          <p
            class="break-words text-sm"
            :data-testid="`memory-instruct-rejection-${operation.key}`"
          >
            {{ operation.rejection?.message }}
          </p>
          <p
            v-if="operation.rejection?.why"
            class="break-words text-xs text-base-content/70"
          >
            {{ operation.rejection.why }}
          </p>
        </template>
        <template v-else-if="operation.kind === 'create' && operation.after">
          <p class="break-words text-xs text-base-content/70">
            {{ operation.after.description }}
          </p>
          <p class="whitespace-pre-wrap break-words text-sm">
            {{ operation.after.body }}
          </p>
        </template>
        <template v-else-if="operation.kind === 'update'">
          <p
            v-if="hasTitleChange(operation)"
            class="break-words text-xs text-base-content/70"
          >
            Renamed from “{{ operation.before?.title }}”
          </p>
          <p
            v-if="hasDescriptionChange(operation)"
            class="break-words text-xs text-base-content/70"
          >
            {{ operation.after?.description }}
          </p>
          <ul
            class="grid gap-0.5 text-sm"
            :data-testid="`memory-instruct-diff-${operation.key}`"
          >
            <li
              v-for="(line, lineIndex) in diffLines(operation)"
              :key="lineIndex"
              class="flex min-w-0 gap-2 rounded px-1"
              :class="diffLineClass(line.type)"
              :data-diff="line.type"
            >
              <span
                class="w-3 shrink-0 text-center font-mono"
                aria-hidden="true"
              >{{ diffMarker(line.type) }}</span>
              <span class="sr-only">{{ diffLabel(line.type) }}</span>
              <span class="min-w-0 whitespace-pre-wrap break-words">{{ line.text }}</span>
            </li>
          </ul>
        </template>
        <p
          v-else-if="operation.kind === 'delete'"
          class="break-words text-sm text-base-content/70"
        >
          {{ operation.reason }}
        </p>
      </div>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { MemoryInstructPreviewOperation } from '#shared/types/memory-instruct.d'
import type { MemoryInstructDiffLineType } from '~/utils/memory-instruct-diff'

defineProps<{
  operations: MemoryInstructPreviewOperation[]
}>()

const selected = defineModel<string[]>('selected', { default: () => [] })

const kindLabels: Record<MemoryInstructPreviewOperation['kind'], string> = {
  create: 'New',
  update: 'Update',
  delete: 'Delete',
}

const kindBadgeClasses: Record<MemoryInstructPreviewOperation['kind'], string> = {
  create: 'badge-success',
  update: 'badge-info',
  delete: 'badge-error',
}

const diffMarkers: Record<MemoryInstructDiffLineType, string> = {
  same: '',
  added: '+',
  removed: '−',
}

const diffLabels: Record<MemoryInstructDiffLineType, string> = {
  same: 'Unchanged:',
  added: 'Added:',
  removed: 'Removed:',
}

const diffLineClasses: Record<MemoryInstructDiffLineType, string> = {
  same: 'text-base-content/60',
  added: 'bg-success/10',
  removed: 'bg-error/10 line-through decoration-error/60',
}

function kindLabel(operation: MemoryInstructPreviewOperation): string {
  return operation.status === 'rejected'
    ? 'Rejected'
    : kindLabels[operation.kind]
}

function kindBadgeClass(operation: MemoryInstructPreviewOperation): string {
  return operation.status === 'rejected'
    ? 'badge-warning'
    : kindBadgeClasses[operation.kind]
}

function operationTitle(operation: MemoryInstructPreviewOperation): string {
  return operation.after?.title || operation.before?.title || 'Untitled'
}

function describeToggle(operation: MemoryInstructPreviewOperation): string {
  return `${kindLabels[operation.kind]}: ${operationTitle(operation)}`
}

function hasTitleChange(operation: MemoryInstructPreviewOperation): boolean {
  return !!operation.before
    && !!operation.after
    && operation.before.title !== operation.after.title
}

function hasDescriptionChange(
  operation: MemoryInstructPreviewOperation,
): boolean {
  return !!operation.before
    && !!operation.after
    && operation.before.description !== operation.after.description
}

function diffLines(operation: MemoryInstructPreviewOperation) {
  return diffMemoryInstructLines(
    operation.before?.body ?? '',
    operation.after?.body ?? '',
  )
}

function diffMarker(type: MemoryInstructDiffLineType): string {
  return diffMarkers[type]
}

function diffLabel(type: MemoryInstructDiffLineType): string {
  return diffLabels[type]
}

function diffLineClass(type: MemoryInstructDiffLineType): string {
  return diffLineClasses[type]
}

function toggle(key: string, event: Event) {
  const isChecked = (event.target as HTMLInputElement).checked
  const others = selected.value.filter(selectedKey => selectedKey !== key)

  selected.value = isChecked ? [...others, key] : others
}
</script>

<template>
  <div class="grid gap-2">
    <p
      class="text-xs text-base-content/70"
      data-testid="connector-tools-counter"
    >
      {{ enabledCount }} of {{ tools.length }} on. A message can use up to
      {{ perMessageLimit }} tools from all connectors; read-only tools go
      first. Labels are as reported by the server.
    </p>
    <ul
      v-if="tools.length"
      class="list"
      data-testid="connector-tools"
    >
      <li
        v-for="tool in tools"
        :key="tool.name"
        class="list-row items-start gap-3 px-0 py-3"
        data-testid="connector-tool"
        :data-tool-name="tool.name"
      >
        <div class="list-col-grow min-w-0">
          <p class="break-words font-medium">
            {{ tool.title || tool.name }}
          </p>
          <p
            v-if="tool.title && tool.title !== tool.name"
            class="break-all font-mono text-xs text-base-content/70"
          >
            {{ tool.name }}
          </p>
          <p
            v-if="tool.description"
            class="mt-1 whitespace-pre-line break-words text-sm text-base-content/80"
            :class="{ 'line-clamp-2': !expanded.has(tool.name) }"
            data-testid="connector-tool-description"
          >
            {{ tool.description }}
          </p>
          <button
            v-if="tool.description.length > DESCRIPTION_PREVIEW_LENGTH"
            type="button"
            class="link link-hover text-xs"
            :aria-expanded="expanded.has(tool.name)"
            @click="toggleExpanded(tool.name)"
          >
            {{ expanded.has(tool.name) ? 'Show less' : 'Show more' }}
          </button>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <ProfileConnectorsToolBadges :tool="tool" />
            <span
              v-if="tool.alwaysAllowed"
              class="badge badge-soft badge-info badge-sm"
              data-testid="connector-tool-always"
            >
              Always allowed
            </span>
            <button
              v-if="tool.alwaysAllowed"
              type="button"
              class="btn btn-ghost btn-xs min-h-6"
              :disabled="isBusy"
              :aria-label="`Remove Always allow for ${tool.title || tool.name}`"
              data-testid="connector-tool-always-remove"
              @click="emit('removeAlways', tool.name)"
            >
              Remove
            </button>
          </div>
        </div>
        <label class="flex min-h-11 items-center sm:min-h-8">
          <span class="sr-only">Use {{ tool.title || tool.name }}</span>
          <input
            type="checkbox"
            class="toggle toggle-sm"
            :checked="tool.enabled"
            :disabled="isBusy"
            data-testid="connector-tool-toggle"
            @change="onToggle(tool, $event)"
          >
        </label>
      </li>
    </ul>
    <p
      v-else
      class="text-sm text-base-content/70"
      data-testid="connector-tools-empty"
    >
      This server lists no tools.
    </p>
  </div>
</template>

<script setup lang="ts">
import type { ConnectorReviewTool } from '#shared/types/connectors.d'

const DESCRIPTION_PREVIEW_LENGTH = 140

const props = withDefaults(defineProps<{
  tools: ConnectorReviewTool[]
  perMessageLimit: number
  isBusy?: boolean
}>(), {
  isBusy: false,
})

const emit = defineEmits<{
  toggle: [toolName: string, enabled: boolean]
  removeAlways: [toolName: string]
}>()

const expanded = shallowRef<Set<string>>(new Set())

const enabledCount = computed<number>(() => {
  return props.tools.filter(tool => tool.enabled).length
})

function toggleExpanded(toolName: string) {
  const next = new Set(expanded.value)

  if (next.has(toolName)) {
    next.delete(toolName)
  } else {
    next.add(toolName)
  }

  expanded.value = next
}

function onToggle(tool: ConnectorReviewTool, event: Event) {
  const target = event.target as HTMLInputElement

  emit('toggle', tool.name, target.checked)
  target.checked = tool.enabled
}
</script>

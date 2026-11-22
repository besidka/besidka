<template>
  <div class="grid gap-3">
    <p
      class="text-xs text-base-content/70"
      data-testid="connector-tools-counter"
    >
      {{ enabledCount }} of {{ tools.length }} on. A message can use up to
      {{ perMessageLimit }} tools from all connectors; read-only tools go
      first. Labels are as reported by the server. Needs approval asks before
      each use; Always allow runs without asking, also after content from
      another source. A tool that changes asks again.
    </p>
    <UiToolPermissions
      v-if="tools.length"
      :groups="groups"
      :is-busy="isBusy"
      data-testid="connector-tools"
      @set-tools="emit('setModes', $event)"
      @set-group="onSetGroup"
    >
      <template #tool="{ tool }">
        <p class="break-words text-sm font-medium">
          {{ tool.title }}
        </p>
        <p
          v-if="toolsByName.get(tool.name)?.title
            && toolsByName.get(tool.name)?.title !== tool.name"
          class="break-all font-mono text-xs text-base-content/70"
        >
          {{ tool.name }}
        </p>
        <p
          v-if="toolsByName.get(tool.name)?.description"
          class="whitespace-pre-line break-words text-xs text-base-content/80"
          :class="{ 'line-clamp-2': !expanded.has(tool.name) }"
          data-testid="connector-tool-description"
        >
          {{ toolsByName.get(tool.name)?.description }}
        </p>
        <button
          v-if="(toolsByName.get(tool.name)?.description.length ?? 0)
            > DESCRIPTION_PREVIEW_LENGTH"
          type="button"
          class="link link-hover justify-self-start text-xs"
          :aria-expanded="expanded.has(tool.name)"
          @click="toggleExpanded(tool.name)"
        >
          {{ expanded.has(tool.name) ? 'Show less' : 'Show more' }}
        </button>
        <div
          v-if="toolsByName.get(tool.name)"
          class="flex flex-wrap items-center gap-2"
        >
          <ProfileConnectorsToolBadges :tool="toolsByName.get(tool.name)!" />
        </div>
      </template>
    </UiToolPermissions>
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
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'
import type {
  ToolPermissionChange,
  ToolPermissionGroup,
} from '~/utils/tool-permissions'

type ConnectorToolGroupId = 'read' | 'write' | 'delete-share'

const DESCRIPTION_PREVIEW_LENGTH = 140

const ALL_MODES: readonly ToolPermissionMode[] = ['blocked', 'ask', 'allow']

const UNREVIEWED_MODES: readonly ToolPermissionMode[] = ['blocked', 'ask']

const UNREVIEWED_HINT = 'this tool changed, so review it before you '
  + 'allow it'

const GROUPS: ReadonlyArray<{
  id: ConnectorToolGroupId
  label: string
  description: string
  warning?: string
}> = [
  {
    id: 'read',
    label: 'Read-only',
    description: 'Look things up. A plain read is Always allow by default.',
  },
  {
    id: 'write',
    label: 'Write',
    description: 'Create or change data. They ask until you choose Always '
      + 'allow.',
  },
  {
    id: 'delete-share',
    label: 'Delete and share',
    description: 'Delete or share data, by the server\'s label or the tool\'s '
      + 'name. They ask until you choose Always allow.',
    warning: 'Always allow lets the model delete or share data without '
      + 'asking you.',
  },
]

const props = withDefaults(defineProps<{
  tools: ConnectorReviewTool[]
  perMessageLimit: number
  isBusy?: boolean
}>(), {
  isBusy: false,
})

const emit = defineEmits<{
  setModes: [changes: ToolPermissionChange[]]
}>()

const expanded = shallowRef<Set<string>>(new Set())

const enabledCount = computed<number>(() => {
  return props.tools.filter(tool => tool.enabled).length
})

const toolsByName = computed<Map<string, ConnectorReviewTool>>(() => {
  return new Map(props.tools.map(tool => [tool.name, tool]))
})

function groupOf(tool: ConnectorReviewTool): ConnectorToolGroupId {
  if (tool.alwaysAsk) {
    return 'delete-share'
  }

  return tool.readOnly ? 'read' : 'write'
}

const groups = computed<ToolPermissionGroup[]>(() => {
  return GROUPS.map((group) => {
    return {
      ...group,
      tools: props.tools
        .filter(tool => groupOf(tool) === group.id)
        .map((tool) => {
          return {
            name: tool.name,
            title: tool.title || tool.name,
            mode: tool.mode,
            modes: tool.canAlwaysAllow ? ALL_MODES : UNREVIEWED_MODES,
            ...(tool.canAlwaysAllow
              ? {}
              : { unavailableHint: UNREVIEWED_HINT }),
          }
        }),
    }
  })
})

function onSetGroup(
  _groupId: string,
  _mode: ToolPermissionMode,
  changes: ToolPermissionChange[],
) {
  emit('setModes', changes)
}

function toggleExpanded(toolName: string) {
  const next = new Set(expanded.value)

  if (next.has(toolName)) {
    next.delete(toolName)
  } else {
    next.add(toolName)
  }

  expanded.value = next
}
</script>

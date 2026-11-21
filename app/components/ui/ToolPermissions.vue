<template>
  <div
    class="grid grid-cols-1 gap-3"
    data-testid="tool-permissions"
  >
    <section
      v-for="group in viewGroups"
      :key="group.id"
      class="rounded-box border border-base-content/10"
      :aria-labelledby="`${idPrefix}-${group.id}-label`"
      :data-testid="`tool-permissions-group-${group.id}`"
    >
      <header class="flex flex-wrap items-center justify-between gap-2 p-2">
        <button
          type="button"
          class="btn btn-ghost btn-sm min-h-11 min-w-0 justify-start gap-2 px-2 sm:min-h-8"
          :aria-expanded="group.isOpen"
          :aria-controls="`${idPrefix}-${group.id}-tools`"
          :data-testid="`tool-permissions-group-toggle-${group.id}`"
          @click="toggleGroup(group.id)"
        >
          <Icon
            name="lucide:chevron-right"
            size="16"
            class="shrink-0 transition-transform motion-reduce:transition-none"
            :class="{ 'rotate-90': group.isOpen }"
            aria-hidden="true"
          />
          <span
            :id="`${idPrefix}-${group.id}-label`"
            class="truncate font-bold"
          >
            {{ group.label }}
          </span>
          <span
            class="badge badge-soft badge-sm"
            :aria-label="`${group.tools.length} tools`"
          >
            {{ group.tools.length }}
          </span>
        </button>
        <select
          class="select select-sm w-full sm:w-44"
          :aria-label="`Permission for all ${group.label} tools`"
          :value="group.mode"
          :disabled="isBusy"
          :data-testid="`tool-permissions-group-select-${group.id}`"
          @change="onGroupChange(group, $event)"
        >
          <option
            v-if="group.mode === 'custom'"
            value="custom"
            disabled
          >
            Custom
          </option>
          <option
            v-for="mode in group.selectableModes"
            :key="mode"
            :value="mode"
          >
            {{ TOOL_PERMISSION_MODE_LABELS[mode] }}
          </option>
        </select>
      </header>
      <p
        v-if="group.description"
        class="-mt-1 px-4 pb-3 text-xs text-base-content/60"
      >
        {{ group.description }}
      </p>
      <p
        v-if="group.warning"
        class="-mt-2 flex items-start gap-1.5 px-4 pb-3 text-xs text-base-content/80"
        :data-testid="`tool-permissions-group-warning-${group.id}`"
      >
        <Icon
          name="lucide:triangle-alert"
          size="14"
          class="mt-px shrink-0 text-warning"
          aria-hidden="true"
        />
        <span>{{ group.warning }}</span>
      </p>
      <ul
        v-show="group.isOpen"
        :id="`${idPrefix}-${group.id}-tools`"
        class="grid grid-cols-1"
        :data-testid="`tool-permissions-group-tools-${group.id}`"
      >
        <li
          v-for="tool in group.tools"
          :key="tool.name"
          class="flex items-start justify-between gap-3 border-t border-base-content/10 px-4 py-3"
          data-testid="tool-permissions-row"
          :data-tool-name="tool.name"
        >
          <div class="grid min-w-0 gap-1">
            <slot
              name="tool"
              :tool="tool"
            >
              <span class="break-words text-sm leading-snug">
                {{ tool.title }}
              </span>
            </slot>
          </div>
          <UiToolPermissionsModeControl
            :label="tool.title"
            :mode="tool.mode"
            :modes="tool.modes"
            :unavailable-hint="tool.unavailableHint"
            :is-busy="isBusy"
            @select="emit('setTools', [{ name: tool.name, mode: $event }])"
          />
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { TOOL_PERMISSION_MODES } from '#shared/utils/tool-approval-policy'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'
import {
  TOOL_PERMISSION_GROUP_COLLAPSE_AFTER,
  TOOL_PERMISSION_MODE_LABELS,
  getGroupModeChanges,
  getGroupSelectableModes,
  getToolGroupMode,
} from '~/utils/tool-permissions'
import type {
  ToolPermissionChange,
  ToolPermissionGroup,
  ToolPermissionGroupMode,
} from '~/utils/tool-permissions'

interface ToolPermissionGroupView extends ToolPermissionGroup {
  isOpen: boolean
  mode: ToolPermissionGroupMode
  selectableModes: ToolPermissionMode[]
}

const props = withDefaults(defineProps<{
  groups: ToolPermissionGroup[]
  isBusy?: boolean
  collapseAfter?: number
}>(), {
  isBusy: false,
  collapseAfter: TOOL_PERMISSION_GROUP_COLLAPSE_AFTER,
})

const emit = defineEmits<{
  setTools: [changes: ToolPermissionChange[]]
  setGroup: [
    groupId: string,
    mode: ToolPermissionMode,
    changes: ToolPermissionChange[],
  ]
}>()

const idPrefix = useId()
const toggledGroups = shallowRef<Set<string>>(new Set())

const viewGroups = computed<ToolPermissionGroupView[]>(() => {
  return props.groups
    .filter(group => group.tools.length > 0)
    .map((group) => {
      const isOpenByDefault = group.tools.length <= props.collapseAfter

      return {
        ...group,
        isOpen: toggledGroups.value.has(group.id)
          ? !isOpenByDefault
          : isOpenByDefault,
        mode: getToolGroupMode(group.tools.map(tool => tool.mode)),
        selectableModes: getGroupSelectableModes(group.tools),
      }
    })
})

function toggleGroup(groupId: string) {
  const next = new Set(toggledGroups.value)

  if (next.has(groupId)) {
    next.delete(groupId)
  } else {
    next.add(groupId)
  }

  toggledGroups.value = next
}

function readMode(event: Event): ToolPermissionMode | null {
  const value = event.target instanceof HTMLSelectElement
    ? event.target.value
    : ''

  return (TOOL_PERMISSION_MODES as readonly string[]).includes(value)
    ? value as ToolPermissionMode
    : null
}

function onGroupChange(group: ToolPermissionGroupView, event: Event) {
  const mode = readMode(event)

  if (event.target instanceof HTMLSelectElement) {
    event.target.value = group.mode
  }

  if (!mode) {
    return
  }

  const changes = getGroupModeChanges(group.tools, mode)

  if (changes.length > 0) {
    emit('setGroup', group.id, mode, changes)
  }
}
</script>

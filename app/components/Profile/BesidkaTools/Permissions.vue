<template>
  <div
    class="grid gap-6 py-4"
    data-testid="besidka-tool-permissions"
  >
    <UiSidePanelSkeleton
      v-if="status === 'pending' && !tools.length"
      :lines="4"
    />
    <div
      v-else-if="error && !tools.length"
      class="alert alert-error alert-soft"
      role="alert"
      data-testid="besidka-tool-permissions-error"
    >
      <Icon
        name="lucide:circle-alert"
        size="16"
        class="shrink-0"
        aria-hidden="true"
      />
      <span>{{ errorMessage }}</span>
      <button
        type="button"
        class="btn btn-sm"
        data-testid="besidka-tool-permissions-retry"
        @click="refresh()"
      >
        Retry
      </button>
    </div>
    <template v-else>
      <p class="text-sm text-base-content/70">
        Choose what the model may do with your Besidka data in a chat.
        Needs approval asks you before each use.
      </p>
      <section
        v-for="group in groups"
        :key="group.tier"
        class="grid gap-3"
        :data-testid="`besidka-tool-group-${group.tier}`"
      >
        <header class="flex items-start justify-between gap-3">
          <div class="grid min-w-0 gap-1">
            <h3
              :id="`${idPrefix}-${group.tier}`"
              class="font-bold"
            >
              {{ group.label }}
            </h3>
            <p class="text-xs text-base-content/60">
              {{ group.description }}
            </p>
          </div>
          <select
            class="select select-sm w-40 shrink-0"
            :aria-labelledby="`${idPrefix}-${group.tier}`"
            :value="group.mode"
            :data-testid="`besidka-tool-group-select-${group.tier}`"
            @change="onGroupChange(group.tier, $event)"
          >
            <option
              v-if="group.mode === 'custom'"
              value="custom"
              disabled
            >
              Custom
            </option>
            <option
              v-for="mode in group.modes"
              :key="mode"
              :value="mode"
            >
              {{ BESIDKA_TOOL_MODE_LABELS[mode] }}
            </option>
          </select>
        </header>
        <ul class="grid gap-2">
          <li
            v-for="tool in group.tools"
            :key="tool.name"
            class="flex items-center justify-between gap-3 border-t border-base-content/10 pt-2"
            :data-testid="`besidka-tool-row-${tool.name}`"
          >
            <label
              :for="`${idPrefix}-tool-${tool.name}`"
              class="min-w-0 truncate text-sm"
            >
              {{ tool.title }}
            </label>
            <select
              :id="`${idPrefix}-tool-${tool.name}`"
              class="select select-sm w-40 shrink-0"
              :value="tool.mode"
              :data-testid="`besidka-tool-select-${tool.name}`"
              @change="onToolChange(tool.name, $event)"
            >
              <option
                v-for="mode in group.modes"
                :key="mode"
                :value="mode"
              >
                {{ BESIDKA_TOOL_MODE_LABELS[mode] }}
              </option>
            </select>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  BESIDKA_TOOL_MODE_LABELS,
  BESIDKA_TOOL_TIERS,
  BESIDKA_TOOL_TIER_DESCRIPTIONS,
  BESIDKA_TOOL_TIER_LABELS,
  getAllowedBesidkaToolModes,
  isBesidkaToolModeAllowed,
} from '#shared/utils/besidka-tool-permissions'
import type { BesidkaToolPermissionTier } from '#shared/utils/besidka-tool-permissions'
import {
  TOOL_PERMISSION_MODES,
} from '#shared/utils/tool-approval-policy'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'
import { getBesidkaToolGroupMode } from '~/utils/besidka-tool-permissions'

const idPrefix = useId()
const { tools, status, error, refresh, save } = useBesidkaToolPermissions()

const groups = computed(() => {
  return BESIDKA_TOOL_TIERS
    .map((tier) => {
      const groupTools = tools.value.filter(tool => tool.tier === tier)

      return {
        tier,
        label: BESIDKA_TOOL_TIER_LABELS[tier],
        description: BESIDKA_TOOL_TIER_DESCRIPTIONS[tier],
        modes: getAllowedBesidkaToolModes(tier),
        tools: groupTools,
        mode: getBesidkaToolGroupMode(groupTools.map(tool => tool.mode)),
      }
    })
    .filter(group => group.tools.length > 0)
})

const errorMessage = computed<string>(() => {
  return error.value
    ? parseError(error.value).message || 'The permissions did not load.'
    : ''
})

function readMode(event: Event): ToolPermissionMode | null {
  const value = event.target instanceof HTMLSelectElement
    ? event.target.value
    : ''

  return (TOOL_PERMISSION_MODES as readonly string[]).includes(value)
    ? value as ToolPermissionMode
    : null
}

async function onGroupChange(tier: BesidkaToolPermissionTier, event: Event) {
  const mode = readMode(event)

  if (!mode || !isBesidkaToolModeAllowed(tier, mode)) {
    return
  }

  await save({ tier }, mode)
}

async function onToolChange(name: string, event: Event) {
  const mode = readMode(event)
  const tool = tools.value.find(candidate => candidate.name === name)

  if (!mode || !tool || !isBesidkaToolModeAllowed(tool.tier, mode)) {
    return
  }

  await save({ tool: name }, mode)
}
</script>

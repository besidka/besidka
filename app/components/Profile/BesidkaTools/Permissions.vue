<template>
  <div
    class="grid grid-cols-1 gap-6 py-4"
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
      <UiToolPermissions
        :groups="groups"
        @set-tools="onSetTools"
        @set-group="onSetGroup"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  BESIDKA_TOOL_TIERS,
  BESIDKA_TOOL_TIER_DESCRIPTIONS,
  BESIDKA_TOOL_TIER_LABELS,
  getAllowedBesidkaToolModes,
  isBesidkaToolModeAllowed,
} from '#shared/utils/besidka-tool-permissions'
import type { BesidkaToolPermissionTier } from '#shared/utils/besidka-tool-permissions'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'
import type {
  ToolPermissionChange,
  ToolPermissionGroup,
} from '~/utils/tool-permissions'

const ASK_EVERY_TIME_HINT = 'this tool deletes, shares or rewrites '
  + 'instructions, so it always asks'

const { tools, status, error, refresh, save } = useBesidkaToolPermissions()

const groups = computed<ToolPermissionGroup[]>(() => {
  return BESIDKA_TOOL_TIERS.map((tier) => {
    const modes = getAllowedBesidkaToolModes(tier)
    const isAskEveryTime = tier === 'ask-every-time'

    return {
      id: tier,
      label: BESIDKA_TOOL_TIER_LABELS[tier],
      description: BESIDKA_TOOL_TIER_DESCRIPTIONS[tier],
      isLocked: isAskEveryTime,
      tools: tools.value
        .filter(tool => tool.tier === tier)
        .map((tool) => {
          return {
            name: tool.name,
            title: tool.title,
            mode: tool.mode,
            modes,
            ...(isAskEveryTime
              ? { unavailableHint: ASK_EVERY_TIME_HINT }
              : {}),
          }
        }),
    }
  })
})

const errorMessage = computed<string>(() => {
  return error.value
    ? parseError(error.value).message || 'The permissions did not load.'
    : ''
})

function isTier(value: string): value is BesidkaToolPermissionTier {
  return (BESIDKA_TOOL_TIERS as readonly string[]).includes(value)
}

async function onSetGroup(groupId: string, mode: ToolPermissionMode) {
  if (!isTier(groupId) || !isBesidkaToolModeAllowed(groupId, mode)) {
    return
  }

  await save({ tier: groupId }, mode)
}

async function onSetTools(changes: ToolPermissionChange[]) {
  for (const change of changes) {
    const tool = tools.value.find(candidate => candidate.name === change.name)

    if (!tool || !isBesidkaToolModeAllowed(tool.tier, change.mode)) {
      continue
    }

    await save({ tool: change.name }, change.mode)
  }
}
</script>

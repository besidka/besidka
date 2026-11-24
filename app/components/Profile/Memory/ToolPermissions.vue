<template>
  <ProfileSecuritySectionCard
    heading="Saving to memory"
    :description="SECTION_DESCRIPTION"
  >
    <div
      class="grid gap-4"
      data-testid="memory-tool-permissions"
    >
      <UiSidePanelSkeleton
        v-if="status === 'pending' && !tools.length"
        :lines="2"
      />
      <div
        v-else-if="error && !tools.length"
        class="alert alert-error alert-soft"
        role="alert"
        data-testid="memory-tool-permissions-error"
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
          data-testid="memory-tool-permissions-retry"
          @click="refresh()"
        >
          Retry
        </button>
      </div>
      <template v-else>
        <ul class="grid">
          <li
            v-for="tool in tools"
            :key="tool.name"
            class="flex items-start justify-between gap-3 border-t border-base-content/10 py-3 first:border-t-0 first:pt-0"
            data-testid="memory-tool-permissions-row"
            :data-tool-name="tool.name"
          >
            <div class="grid min-w-0 gap-1">
              <span class="break-words text-sm font-bold leading-snug">
                {{ tool.title }}
              </span>
              <span class="text-xs text-base-content/60">
                {{ MEMORY_TOOL_PERMISSION_DESCRIPTIONS[tool.name] }}
              </span>
            </div>
            <UiToolPermissionsModeControl
              :label="tool.title"
              :mode="tool.mode"
              :modes="TOOL_PERMISSION_MODES"
              @select="save(tool.name, $event)"
            />
          </li>
        </ul>
        <p
          class="text-xs text-base-content/60"
          data-testid="memory-tool-permissions-read-note"
        >
          {{ MEMORY_TOOL_PERMISSION_READ_NOTE }}
        </p>
        <p
          v-if="isAlwaysAllowed"
          class="flex items-start gap-1.5 text-xs text-base-content/80"
          data-testid="memory-tool-permissions-warning"
        >
          <Icon
            name="lucide:triangle-alert"
            size="14"
            class="mt-px shrink-0 text-warning"
            aria-hidden="true"
          />
          <span>{{ MEMORY_TOOL_ALWAYS_ALLOW_WARNING }}</span>
        </p>
      </template>
    </div>
  </ProfileSecuritySectionCard>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  MEMORY_TOOL_ALWAYS_ALLOW_WARNING,
  MEMORY_TOOL_PERMISSION_DESCRIPTIONS,
  MEMORY_TOOL_PERMISSION_READ_NOTE,
} from '#shared/utils/memory-tool-permissions'
import { TOOL_PERMISSION_MODES } from '#shared/utils/tool-approval-policy'

const SECTION_DESCRIPTION = 'Choose what the model may do with your memory '
  + 'when you ask it to remember or forget something. One setting covers '
  + 'your account memory and every project.'

const { tools, status, error, refresh, save } = useMemoryToolPermissions()

const isAlwaysAllowed = computed<boolean>(() => {
  return tools.value.some(tool => tool.mode === 'allow')
})

const errorMessage = computed<string>(() => {
  return error.value
    ? parseError(error.value).message || 'The permissions did not load.'
    : ''
})
</script>

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
            class="border-t border-base-content/10 py-3 first:border-t-0 first:pt-0"
            data-testid="memory-tool-permissions-row"
            :data-tool-name="tool.name"
          >
            <div class="flex items-start justify-between gap-3">
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
                :modes="getAllowedMemoryToolModes(tool.name)"
                :is-busy="isSaving"
                is-unavailable-hidden
                @select="save(tool.name, $event)"
              />
            </div>
            <div
              v-if="tool.name === MEMORY_ALWAYS_ALLOW_TOOL_NAME
                && tool.mode === 'allow'"
              class="alert alert-warning alert-soft mt-3 w-full items-start gap-2 text-xs"
              role="status"
              data-testid="memory-tool-permissions-warning"
            >
              <Icon
                name="lucide:triangle-alert"
                size="16"
                class="mt-px shrink-0"
                aria-hidden="true"
              />
              <span class="min-w-0 break-words">
                {{ MEMORY_TOOL_ALWAYS_ALLOW_WARNING }}
              </span>
            </div>
            <p
              v-else-if="tool.name !== MEMORY_ALWAYS_ALLOW_TOOL_NAME"
              class="mt-2 text-xs text-base-content/60"
              data-testid="memory-tool-permissions-forget-note"
            >
              {{ MEMORY_FORGET_ALWAYS_ASKS_NOTE }}
            </p>
          </li>
        </ul>
        <p
          class="text-xs text-base-content/60"
          data-testid="memory-tool-permissions-read-note"
        >
          {{ MEMORY_TOOL_PERMISSION_READ_NOTE }}
        </p>
      </template>
    </div>
  </ProfileSecuritySectionCard>
</template>

<script setup lang="ts">
import { parseError } from 'evlog'
import {
  MEMORY_ALWAYS_ALLOW_TOOL_NAME,
  MEMORY_FORGET_ALWAYS_ASKS_NOTE,
  MEMORY_TOOL_ALWAYS_ALLOW_WARNING,
  MEMORY_TOOL_PERMISSION_DESCRIPTIONS,
  MEMORY_TOOL_PERMISSION_READ_NOTE,
  getAllowedMemoryToolModes,
} from '#shared/utils/memory-tool-permissions'

const SECTION_DESCRIPTION = 'Choose what the model may do with your memory '
  + 'when you ask it to remember or forget something. One setting covers '
  + 'your account memory and every project.'

const { tools, status, error, refresh, isSaving, save }
  = useMemoryToolPermissions()

const errorMessage = computed<string>(() => {
  return error.value
    ? parseError(error.value).message || 'The permissions did not load.'
    : ''
})
</script>

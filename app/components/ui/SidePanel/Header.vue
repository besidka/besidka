<template>
  <div class="flex items-center gap-1 min-h-10">
    <button
      v-if="canGoBack"
      type="button"
      class="btn btn-sm btn-circle btn-ghost btn-ghost-legacy shrink-0"
      aria-label="Back"
      title="Back"
      data-testid="side-panel-back"
      @click="emit('back')"
    >
      <Icon
        name="lucide:arrow-left"
        size="18"
      />
    </button>
    <div class="min-w-0 flex-1 px-1">
      <slot name="header">
        <h2
          :id="headingId"
          class="truncate text-base font-bold"
          data-testid="side-panel-title"
        >
          {{ title }}
        </h2>
      </slot>
    </div>
    <div class="flex shrink-0 items-center gap-1">
      <slot name="header-actions" />
      <UiButton
        v-if="canResize"
        ghost
        circle
        size="sm"
        :icon-only="true"
        icon-name="lucide:move-horizontal"
        :icon-size="18"
        :title="widthPresetLabel"
        tooltip-position="bottom"
        data-testid="side-panel-width-preset"
        @click="emit('cycle-width')"
      />
      <UiButton
        v-if="canExpand"
        ghost
        circle
        size="sm"
        :icon-only="true"
        :icon-name="isFullWidth ? 'lucide:minimize-2' : 'lucide:maximize-2'"
        :icon-size="18"
        :title="isFullWidth ? 'Collapse panel' : 'Expand panel'"
        tooltip-position="bottom"
        data-testid="side-panel-full-width"
        @click="emit('toggle-full-width')"
      />
      <UiButton
        ghost
        circle
        size="sm"
        :icon-only="true"
        icon-name="lucide:x"
        :icon-size="18"
        title="Close panel"
        tooltip-position="left"
        data-testid="side-panel-close"
        @click="emit('close')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  headingId: string
  canGoBack: boolean
  canResize: boolean
  canExpand: boolean
  isFullWidth: boolean
  widthPresetLabel: string
}>()

const emit = defineEmits<{
  'back': []
  'cycle-width': []
  'toggle-full-width': []
  'close': []
}>()
</script>

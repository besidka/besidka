<template>
  <Teleport
    v-if="target"
    :to="target"
  >
    <div
      v-if="visible"
      class="landing-player__preview pointer-events-none absolute z-20
        flex flex-col gap-1 p-1.5 rounded-2xl bubble w-fit"
      :style="overlayStyle"
      aria-hidden="true"
    >
      <div
        class="rounded-xl overflow-hidden ring-1 ring-accent/40"
        :style="thumbStyle"
      />
      <div class="flex items-center justify-between gap-2 px-1 pb-0.5">
        <span
          v-if="label"
          class="text-xs font-medium text-base-content truncate max-w-[7rem]"
        >
          {{ label }}
        </span>
        <span class="text-xs tabular-nums text-base-content/70 ml-auto">
          {{ timeLabel }}
        </span>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { StyleValue } from 'vue'

defineProps<{
  target: HTMLElement | null
  visible: boolean
  label: string
  timeLabel: string
  overlayStyle: StyleValue
  thumbStyle: StyleValue
}>()
</script>

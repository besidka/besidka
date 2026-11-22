<template>
  <div
    data-testid="reasoning-google-step"
    class="my-2.5 min-w-0 flex-1"
  >
    <div class="flex min-w-0 items-center gap-1.5 text-xs">
      <ChatReasoningStepIcon
        :icon="icon ?? null"
        class="shrink-0"
      />
      <span
        data-testid="reasoning-google-step-title"
        class="min-w-0 break-words"
        :class="
          pending
            ? 'skeleton skeleton-text reasoning-main-title-skeleton'
            : undefined
        "
      >
        {{ title }}{{ pending ? '…' : '' }}
      </span>
    </div>
    <ul
      v-if="data.state === 'done' && data.references.length > 0"
      data-testid="reasoning-google-step-references"
      class="mt-1.5 flex flex-col gap-1 pl-5"
    >
      <li
        v-for="reference in data.references"
        :key="reference.id"
        class="flex min-w-0 items-baseline gap-2 text-xs"
        data-testid="reasoning-google-step-reference"
      >
        <span
          :title="reference.title"
          class="min-w-0 truncate text-base-content/70"
        >
          {{ reference.title || 'Google Drive file' }}
        </span>
        <a
          v-if="reference.link"
          :href="reference.link"
          target="_blank"
          rel="noopener noreferrer"
          class="link link-hover shrink-0"
          :aria-label="`Open ${reference.title || 'file'} in Google Drive`"
          data-testid="reasoning-google-step-link"
        >
          Open in Google Drive
        </a>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import type { GoogleStepData } from '~/types/google-step.d'
import type { ReasoningStepIcon } from '~/utils/reasoning-step-icons'

defineProps<{
  data: GoogleStepData
  title: string
  pending: boolean
  icon?: ReasoningStepIcon | null
}>()
</script>

<template>
  <div
    v-if="isOpen"
    class="absolute bottom-full left-0 right-0 z-10 mb-2 px-2 md:right-auto md:w-md"
    data-testid="command-picker"
  >
    <ul
      :id="listId"
      role="listbox"
      aria-label="Skill commands"
      class="max-h-72 overflow-y-auto overscroll-contain rounded-box border border-base-300 bg-base-100 p-1 shadow-lg"
    >
      <li
        v-for="(command, index) in matches"
        :id="getOptionId(index)"
        :key="command.skillId"
        role="option"
        :aria-selected="index === activeIndex"
      >
        <button
          type="button"
          tabindex="-1"
          class="flex w-full items-center gap-3 rounded-box px-3 py-2 text-left cursor-pointer max-sm:min-h-11"
          :class="index === activeIndex ? 'bg-base-200' : 'hover:bg-base-200'"
          :data-testid="`command-picker-item-${command.command}`"
          @mousedown.prevent
          @click="emit('pick', command)"
        >
          <span class="shrink-0 font-semibold">/{{ command.command }}</span>
          <span class="min-w-0 grow">
            <span class="block truncate text-sm">{{ command.name }}</span>
            <span class="block truncate text-xs text-base-content/70">
              {{ command.description }}
            </span>
          </span>
          <span class="badge badge-soft badge-xs shrink-0">
            {{ SKILL_MODE_LABELS[command.mode] }}
          </span>
        </button>
      </li>
      <li
        v-if="hasNoCommands"
        role="presentation"
        class="px-3 py-3 text-sm text-base-content/70"
        data-testid="command-picker-empty"
      >
        No commands.
        <NuxtLink
          to="/chats/skills"
          class="link link-accent"
          data-testid="command-picker-manage"
        >
          Add one on the Skills page
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { SKILL_MODE_LABELS } from '#shared/utils/skills/mode'
import type { ComposerCommand } from '~/utils/composer-command'

const props = defineProps<{
  isOpen: boolean
  matches: ComposerCommand[]
  activeIndex: number
  hasNoCommands: boolean
}>()

const emit = defineEmits<{
  pick: [command: ComposerCommand]
}>()

const listId = useId()

const activeOptionId = computed<string | undefined>(() => {
  return props.isOpen && props.matches.length > 0
    ? getOptionId(props.activeIndex)
    : undefined
})

function getOptionId(index: number): string {
  return `${listId}-option-${index}`
}

defineExpose({ listId, activeOptionId })
</script>

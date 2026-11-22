<template>
  <div
    v-if="invocation"
    class="mb-1.5 flex"
    data-testid="skill-invocation"
  >
    <button
      type="button"
      class="inline-flex h-8 max-w-full items-center gap-2 rounded-box border border-accent/25 bg-accent/10 px-2 text-xs font-semibold text-(--color-accent-text) cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:bg-(--color-accent-bg)/60 dark:text-accent"
      :aria-label="`Skill ${invocation.name}. Open to read it.`"
      data-testid="skill-invocation-chip"
      @click="preview.open(invocation.skillId)"
    >
      <Icon
        name="lucide:sparkles"
        size="14"
        aria-hidden="true"
      />
      <span class="opacity-75">Skill</span>
      <span class="truncate">{{ invocation.name }}</span>
    </button>
  </div>
  <div
    v-else-if="builtinCommand"
    class="mb-1.5 flex"
    data-testid="builtin-command-invocation"
  >
    <span
      class="inline-flex h-8 max-w-full items-center gap-2 rounded-box border border-accent/25 bg-accent/10 px-2 text-xs font-semibold text-(--color-accent-text) dark:bg-(--color-accent-bg)/60 dark:text-accent"
      :title="builtinCommand.description"
      data-testid="builtin-command-chip"
    >
      <Icon
        name="lucide:square-terminal"
        size="14"
        aria-hidden="true"
      />
      <span class="opacity-75">Built-in</span>
      <span class="truncate">/{{ builtinCommand.name }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import type { UIMessage } from 'ai'
import {
  findBuiltinCommandInvocation,
  getBuiltinCommand,
} from '#shared/utils/builtin-commands'
import type { RegisteredBuiltinCommand } from '#shared/utils/builtin-commands'
import { findSkillInvocation } from '#shared/utils/skills/runtime'
import type { SkillInvocationPartData } from '#shared/utils/skills/runtime'

const props = defineProps<{
  message: Pick<UIMessage, 'parts'>
}>()

const preview = useSkillPreview()

const invocation = computed<SkillInvocationPartData | null>(() => {
  return findSkillInvocation(props.message.parts)
})

const builtinCommand = computed<RegisteredBuiltinCommand | null>(() => {
  const found = findBuiltinCommandInvocation(props.message.parts)

  return found ? getBuiltinCommand(found.command) : null
})
</script>

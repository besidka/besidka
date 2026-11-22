<template>
  <section
    v-if="commands.length"
    :aria-labelledby="headingId"
    data-testid="skills-builtin"
  >
    <div class="mb-2 px-1">
      <h2
        :id="headingId"
        class="flex items-center gap-2 text-sm font-semibold"
      >
        <Icon
          name="lucide:square-terminal"
          size="16"
          aria-hidden="true"
        />
        Built-in
      </h2>
      <p
        class="mt-1 text-xs text-base-content/70"
        data-testid="skills-builtin-note"
      >
        Besidka runs these commands itself, without a model, so they cost
        nothing. They cannot be edited, renamed, turned off or deleted.
      </p>
    </div>

    <ul
      class="list"
      data-testid="skills-builtin-list"
    >
      <li
        v-for="command in commands"
        :key="command.name"
        class="list-row items-start gap-3 py-3 sm:py-2 max-sm:grid-cols-[minmax(0,1fr)_auto]"
        data-testid="skill-builtin-row"
        :data-command="command.name"
      >
        <div class="list-col-grow min-w-0">
          <p class="py-1 font-medium">
            {{ command.title }}
          </p>
          <p class="text-sm text-base-content/70">
            {{ command.description }}
          </p>
          <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <code
              class="badge badge-soft badge-sm font-mono"
              :data-testid="`skill-builtin-command-${command.name}`"
            >{{ formatCommand(command) }}</code>
            <span class="badge badge-soft badge-accent badge-sm">
              Built-in
            </span>
            <span class="text-base-content/70">
              No model, free
            </span>
          </div>
          <p
            class="mt-1 text-xs text-base-content/70"
            :data-testid="`skill-builtin-howto-${command.name}`"
          >
            <span class="font-medium">How to use:</span>
            {{ formatHowTo(command) }}
          </p>
        </div>

        <button
          type="button"
          class="btn btn-ghost btn-sm btn-circle"
          :aria-label="`Copy /${command.name}`"
          :title="`Copy /${command.name}`"
          :data-testid="`skill-builtin-copy-${command.name}`"
          @click="onCopy(command.name)"
        >
          <Icon
            name="lucide:copy"
            size="16"
            aria-hidden="true"
          />
        </button>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { filterBuiltinCommands } from '#shared/utils/builtin-commands'
import type { RegisteredBuiltinCommand } from '#shared/utils/builtin-commands'

const props = withDefaults(defineProps<{
  query?: string
}>(), {
  query: '',
})

const headingId = useId()
const available = useAvailableBuiltinCommands()
const besidkaToolsFeature = useFeature('besidka-tools')
const toolApprovalsFeature = useFeature('tool-approvals')
const clipboard = useClipboard({ legacy: true })

const commands = computed<RegisteredBuiltinCommand[]>(() => {
  return filterBuiltinCommands(available.value, props.query)
})

const canAsk = computed<boolean>(() => {
  return besidkaToolsFeature.value.active && toolApprovalsFeature.value.active
})

function formatCommand(command: RegisteredBuiltinCommand): string {
  return command.argumentHint
    ? `/${command.name} ${command.argumentHint}`
    : `/${command.name}`
}

/**
 * Asking in plain words makes the chat model call the same Besidka tool, so
 * it is only suggested to a user who has Besidka tools in chats.
 */
function formatHowTo(command: RegisteredBuiltinCommand): string {
  const typed = `type /${command.name} in a chat`

  return canAsk.value
    ? `${typed}, or ask “${command.example}” (that one uses the model).`
    : `${typed}.`
}

async function onCopy(name: string) {
  await clipboard.copy(`/${name}`)
  useSuccessMessage(`Copied /${name}`)
}
</script>

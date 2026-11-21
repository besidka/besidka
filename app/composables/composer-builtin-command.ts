import {
  BUILTIN_COMMANDS,
  isBuiltinCommandAllowed,
  toBuiltinCommandPart,
} from '#shared/utils/builtin-commands'
import type {
  BuiltinCommandName,
  DataBuiltinCommandPart,
  RegisteredBuiltinCommand,
} from '#shared/utils/builtin-commands'
import type { FeatureKey } from '#shared/utils/features/registry'

/**
 * The built-in command (`/cost`, `/stats`, `/debug`) the message being
 * written runs. It only
 * ever comes from a typed token, so erasing the token clears it. A message
 * runs one command at most: a typed built-in replaces an attached skill, and
 * attaching a skill from the "+" menu clears it. It is shared by the
 * composer, the new-chat page and the send path, and cleared when the
 * composer goes away or the message is sent.
 */
export function useComposerBuiltinCommand() {
  const command = useState<BuiltinCommandName | null>(
    'composer:builtin-command',
    () => null,
  )

  const part = computed<DataBuiltinCommandPart | null>(() => {
    return command.value ? toBuiltinCommandPart(command.value) : null
  })

  function set(next: BuiltinCommandName) {
    command.value = next
  }

  function clear() {
    command.value = null
  }

  return { command, part, set, clear }
}

/**
 * The built-in commands the user can run in the composer: every feature a
 * command needs is active (`skills.commands`). A built-in never calls a
 * model, so it is offered whatever model is chosen, also one without a key.
 * A command the user cannot run is never offered.
 */
export function useAvailableBuiltinCommands() {
  const keys: FeatureKey[] = [
    ...new Set(BUILTIN_COMMANDS.flatMap((command) => {
      return [...command.requiredFeatures]
    })),
  ]
  const states = new Map(keys.map((key) => {
    return [key, useFeature(key)] as const
  }))

  return computed<RegisteredBuiltinCommand[]>(() => {
    const isFeatureActive = (key: FeatureKey) => {
      return states.get(key)?.value.active === true
    }

    return BUILTIN_COMMANDS.filter((command) => {
      return isBuiltinCommandAllowed(command, isFeatureActive)
    })
  })
}

import { isBuiltinCommandName } from '#shared/utils/builtin-commands'
import type { RegisteredBuiltinCommand } from '#shared/utils/builtin-commands'
import {
  filterComposerCommands,
  findCommandToken,
  findCommandTrigger,
  getComposerCommandKey,
  shouldBackspaceDeleteToken,
  stripCommandToken,
  toComposerBuiltinCommand,
} from '~/utils/composer-command'
import type {
  CommandToken,
  CommandTrigger,
  ComposerCommand,
  ComposerSkillCommand,
} from '~/utils/composer-command'
import { isImeEvent } from '~/composables/markdown-textarea'
import type { TextSnapshot } from '~/composables/markdown-textarea'
import type { ComposerSkillItem } from '~/composables/composer-skills'

export const COMPOSER_COMMANDS_MAX_ROWS = 8

interface ComposerCommandsOptions {
  textarea: Ref<HTMLTextAreaElement | null | undefined>
  text: Ref<string>
  items: MaybeRefOrGetter<ComposerSkillItem[]>
  isAvailable: MaybeRefOrGetter<boolean>
  builtins?: MaybeRefOrGetter<readonly RegisteredBuiltinCommand[]>
  insertText: (text: string, snapshot?: TextSnapshot) => void
}

const LINE_BREAK_INPUT_TYPES = new Set(['insertLineBreak', 'insertParagraph'])

export function toComposerCommand(
  item: ComposerSkillItem,
): ComposerSkillCommand {
  return {
    kind: 'skill',
    skillId: item.id,
    command: item.command ?? '',
    name: item.name,
    description: item.description,
    version: item.version,
    mode: item.mode,
  }
}

/**
 * The typed `/command` of the composer: the picker that opens after a `/`,
 * the token that is highlighted and shown as a tile, Backspace over a token
 * and the stripping of the token at send. The picker never sends: while it is
 * open the keys that would send are taken. Everything here is gated on the
 * `skills.commands` flag. Skill commands also need the model to support
 * skills (`isAvailable`); built-in commands (`builtins`, already filtered to
 * the ones the user can run) are listed with them and marked Built-in. A
 * skill that already holds the name of a built-in (it was created before the
 * name was reserved) is not offered under it: the built-in wins, in the
 * picker and for the typed token. With the flag off nothing opens and nothing
 * is highlighted.
 */
export function useComposerCommands(options: ComposerCommandsOptions) {
  const invocation = useComposerSkillInvocation()
  const builtinCommand = useComposerBuiltinCommand()
  const commandsFeature = useFeature('skills.commands')

  const trigger = shallowRef<CommandTrigger | null>(null)
  const activeIndex = shallowRef<number>(0)
  const dismissedStart = shallowRef<number | null>(null)
  const isComposing = shallowRef<boolean>(false)

  const builtinCommands = computed<ComposerCommand[]>(() => {
    return (toValue(options.builtins) ?? []).map(toComposerBuiltinCommand)
  })

  const isSkillCommandsEnabled = computed<boolean>(() => {
    return commandsFeature.value.active && toValue(options.isAvailable)
  })

  const isEnabled = computed<boolean>(() => {
    return isSkillCommandsEnabled.value
      || (commandsFeature.value.active && builtinCommands.value.length > 0)
  })

  const commands = computed<ComposerCommand[]>(() => {
    if (!isEnabled.value) {
      return []
    }

    const skillCommands = isSkillCommandsEnabled.value
      ? toValue(options.items)
        .filter((item) => {
          return item.command !== null
            && item.mode !== 'off'
            && !isBuiltinCommandName(item.command)
        })
        .map(toComposerCommand)
      : []

    return [...skillCommands, ...builtinCommands.value]
      .sort((first, second) => {
        return first.command.localeCompare(second.command)
      })
  })

  const commandNames = computed<ReadonlySet<string>>(() => {
    return new Set(commands.value.map((candidate) => {
      return candidate.command
    }))
  })

  const matches = computed<ComposerCommand[]>(() => {
    return filterComposerCommands(
      commands.value,
      trigger.value?.query ?? '',
    ).slice(0, COMPOSER_COMMANDS_MAX_ROWS)
  })

  const hasNoCommands = computed<boolean>(() => {
    return isEnabled.value && commands.value.length === 0
  })

  const isOpen = computed<boolean>(() => {
    if (!isEnabled.value || !trigger.value || isComposing.value) {
      return false
    }

    if (dismissedStart.value === trigger.value.start) {
      return false
    }

    return matches.value.length > 0 || hasNoCommands.value
  })

  const token = computed<CommandToken | null>(() => {
    if (!isEnabled.value) {
      return null
    }

    return findCommandToken(options.text.value, commandNames.value)
  })

  const tokenCommand = computed<ComposerCommand | null>(() => {
    const current = token.value

    if (!current) {
      return null
    }

    return commands.value.find((candidate) => {
      return candidate.command === current.command
    }) ?? null
  })

  const activeToken = computed<CommandToken | null>(() => {
    const command = tokenCommand.value

    if (!token.value || !command) {
      return null
    }

    if (command.kind === 'builtin') {
      return builtinCommand.command.value === command.command
        ? token.value
        : null
    }

    const current = invocation.invocation.value

    if (current?.source !== 'text' || current.skillId !== command.skillId) {
      return null
    }

    return token.value
  })

  function refresh() {
    const element = options.textarea.value

    if (
      !element
      || !isEnabled.value
      || element.selectionStart !== element.selectionEnd
    ) {
      trigger.value = null

      return
    }

    const next = findCommandTrigger(element.value, element.selectionStart)

    const hasChanged = next?.start !== trigger.value?.start
      || next?.query !== trigger.value?.query

    if (hasChanged) {
      activeIndex.value = 0
    }

    trigger.value = next

    if (dismissedStart.value !== null && next?.start !== dismissedStart.value) {
      dismissedStart.value = null
    }
  }

  function reset() {
    trigger.value = null
  }

  function close() {
    dismissedStart.value = trigger.value?.start ?? null
  }

  function moveSelection(step: 1 | -1) {
    const count = matches.value.length

    if (count === 0) {
      return
    }

    activeIndex.value = (activeIndex.value + step + count) % count
  }

  function pick(command: ComposerCommand) {
    const element = options.textarea.value
    const current = trigger.value

    if (!element || !current) {
      return
    }

    const caret = element.selectionStart
    const hasSpaceAfter = element.value[caret] === ' '
    const snapshot: TextSnapshot = {
      start: current.start,
      end: caret,
      value: element.value,
    }

    options.insertText(
      `/${command.command}${hasSpaceAfter ? '' : ' '}`,
      snapshot,
    )

    if (hasSpaceAfter) {
      const end = current.start + command.command.length + 1

      element.setSelectionRange(end + 1, end + 1)
    }

    trigger.value = null
    refresh()
  }

  function pickActive() {
    const command = matches.value[activeIndex.value]

    if (command) {
      pick(command)
    }
  }

  function deleteTokenName() {
    const element = options.textarea.value
    const current = activeToken.value

    if (!element || !current) {
      return
    }

    options.insertText('', {
      start: current.start + 1,
      end: current.end,
      value: element.value,
    })
    refresh()
  }

  function removeToken() {
    const element = options.textarea.value
    const current = activeToken.value

    if (!element || !current) {
      return
    }

    const after = element.value.slice(current.end)
    const trailingBlank = /^[ \t]+/.exec(after)?.[0].length ?? 0

    options.insertText('', {
      start: current.start,
      end: current.end + trailingBlank,
      value: element.value,
    })
  }

  /**
   * Returns true when the picker or a token took the key, so the caller must
   * not run the markdown rules or send. Composition events pass through
   * untouched (`isImeEvent`).
   */
  function onKeydown(event: KeyboardEvent): boolean {
    if (isImeEvent(event) || isComposing.value) {
      return false
    }

    const element = options.textarea.value
    const key = event.key?.toLowerCase()
    const hasModifier = event.ctrlKey || event.metaKey || event.altKey

    if (isOpen.value && !hasModifier) {
      if (key === 'arrowdown' || key === 'arrowup') {
        event.preventDefault()
        moveSelection(key === 'arrowdown' ? 1 : -1)

        return true
      }

      if (key === 'enter' || key === 'tab') {
        event.preventDefault()
        pickActive()

        return true
      }

      if (key === 'escape') {
        event.preventDefault()
        close()

        return true
      }
    }

    if (
      key === 'backspace'
      && !hasModifier
      && !event.shiftKey
      && element
      && shouldBackspaceDeleteToken(
        activeToken.value,
        element.selectionStart,
        element.selectionEnd,
      )
    ) {
      event.preventDefault()
      deleteTokenName()

      return true
    }

    return false
  }

  /**
   * On phones Enter arrives as a line-break `beforeinput`, not a keydown the
   * send handler sees, so the open picker takes it here too.
   */
  function onBeforeInput(event: InputEvent): boolean {
    if (
      !isOpen.value
      || event.isComposing
      || !LINE_BREAK_INPUT_TYPES.has(event.inputType)
    ) {
      return false
    }

    event.preventDefault()
    pickActive()

    return true
  }

  function onCompositionStart() {
    isComposing.value = true
  }

  function onCompositionEnd() {
    isComposing.value = false
    refresh()
  }

  function stripFromText(text: string): string {
    const current = activeToken.value

    return current ? stripCommandToken(text, current) : text
  }

  watch(
    () => tokenCommand.value ? getComposerCommandKey(tokenCommand.value) : null,
    () => {
      const command = tokenCommand.value

      if (command?.kind === 'builtin') {
        builtinCommand.set(command.command)
        invocation.clear()

        return
      }

      builtinCommand.clear()

      if (command) {
        const current = invocation.invocation.value

        if (
          current?.source === 'text'
          && current.skillId === command.skillId
        ) {
          return
        }

        invocation.set({
          skillId: command.skillId,
          name: command.name,
          version: command.version,
        }, 'text')

        return
      }

      if (invocation.invocation.value?.source === 'text') {
        invocation.clear()
      }
    },
    { flush: 'sync' },
  )

  watch(isEnabled, (enabled) => {
    if (!enabled) {
      trigger.value = null
    }
  })

  return {
    isOpen,
    matches,
    activeIndex,
    hasNoCommands,
    trigger,
    token,
    activeToken,
    isEnabled,
    refresh,
    close,
    pick,
    pickActive,
    removeToken,
    stripFromText,
    onKeydown,
    onBeforeInput,
    onCompositionStart,
    onCompositionEnd,
    reset,
  }
}

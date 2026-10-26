import type { LoggerLike } from '~~/server/utils/files/logger'
import type { MemoryRuntimeSettings } from '~~/server/utils/memory/runtime-settings'
import { MEMORY_SETTING_DEFAULTS } from '#shared/utils/memory-policy'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { loadMemoryIndex } from '~~/server/utils/memory/index-builder'
import { loadMemoryRuntimeSettings } from '~~/server/utils/memory/runtime-settings'

type DbClient = ReturnType<typeof useDb>

const FAIL_CLOSED_SETTINGS: MemoryRuntimeSettings = {
  memoryEnabled: false,
  chatSearchEnabled: false,
}

/**
 * A failed settings read must never silently re-enable a feature the user
 * turned off, so every flag falls back to off; the failure is only logged.
 */
export async function loadMemorySettingsFailClosed(
  db: DbClient,
  userId: number,
  logger: Pick<LoggerLike, 'set'>,
): Promise<MemoryRuntimeSettings> {
  try {
    return await loadMemoryRuntimeSettings({ db, userId })
  } catch (exception) {
    logger.set({
      attributes: {
        memorySettings: { error: exceptionMessage(exception) },
      },
    })

    return { ...FAIL_CLOSED_SETTINGS }
  }
}

export function readUserMessageText(
  parts: ReadonlyArray<{ type: string, text?: string }>,
): string | null {
  const text = parts
    .flatMap((part) => {
      return part.type === 'text' && typeof part.text === 'string'
        ? [part.text]
        : []
    })
    .join('\n')

  return text.trim() === '' ? null : text
}

/**
 * The memory block of the system prompt: the `<memory>` index, only while
 * memory is on. The legacy `user_settings.about_me` text is never injected:
 * a migrated text lives on as the account `profile` entry inside the index,
 * and a text the migration skipped (rejected by the compliance gate, too
 * long, memory off, profile taken, entries full) waits in the Memory tab
 * until the user saves it as an entry or discards it. A project with memory
 * turned off contributes no project entries to the index (they are kept,
 * not deleted). `projectMemoryDisabled` is the status the caller already loaded
 * with the chat's project; `null` means it could not be determined for a
 * project chat and is treated as disabled (fail closed). A failing index
 * load drops the index, is logged, and never fails the chat.
 */
export async function buildMemoryInstructions(input: {
  db: DbClient
  userId: number
  projectId: string | null
  projectMemoryDisabled: boolean | null
  useAccountMemory: boolean | null
  settings: MemoryRuntimeSettings
  hasMemoryTools: boolean
  logger: Pick<LoggerLike, 'set'>
}): Promise<string | null> {
  if (!input.settings.memoryEnabled) {
    return null
  }

  const isProjectDisabled = input.projectId !== null
    && input.projectMemoryDisabled !== false
  const showsAccountMemory = input.useAccountMemory
    ?? MEMORY_SETTING_DEFAULTS.useAccountMemory

  if (isProjectDisabled && !showsAccountMemory) {
    return null
  }

  try {
    const index = await loadMemoryIndex({
      db: input.db,
      userId: input.userId,
      projectId: isProjectDisabled ? null : input.projectId,
      useAccountMemory: input.useAccountMemory,
      hasMemoryTools: input.hasMemoryTools,
    })

    if (!index.text) {
      return null
    }

    input.logger.set({
      attributes: {
        memoryIndex: {
          tokens: index.tokens,
          entryCount: index.entryCount,
          trimSteps: index.trimSteps,
          overBudget: index.overBudget,
        },
      },
    })

    return index.text
  } catch (exception) {
    input.logger.set({
      attributes: {
        memoryIndex: { error: exceptionMessage(exception) },
      },
    })

    return null
  }
}

import type { LoggerLike } from '~~/server/utils/files/logger'
import type { MemoryRuntimeSettings } from '~~/server/utils/memory/runtime-settings'
import { MEMORY_SETTING_DEFAULTS } from '#shared/utils/memory-policy'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { buildAboutMeInstruction } from '~~/server/utils/memory/about-me'
import { loadMemoryIndex } from '~~/server/utils/memory/index-builder'
import { loadMemoryRuntimeSettings } from '~~/server/utils/memory/runtime-settings'

type DbClient = ReturnType<typeof useDb>

const FAIL_CLOSED_SETTINGS: MemoryRuntimeSettings = {
  memoryEnabled: false,
  chatSearchEnabled: false,
  memoryIncludeSensitive: false,
  aboutMe: null,
}

/**
 * A failed settings read must never silently re-enable a feature the user
 * turned off, so every flag falls back to off and the custom instructions
 * to none; the failure is only logged.
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
 * The memory block of the system prompt: the `<memory>` index first (only
 * while memory is on), then the user's own `aboutMe` text, which is
 * independent of the memory switch because it is user-authored custom
 * instructions rather than extracted memory. A project with memory turned
 * off contributes no project entries to the index (they are kept, not
 * deleted). `projectMemoryDisabled` is the status the caller already loaded
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
  const sections: string[] = []

  if (input.settings.memoryEnabled) {
    try {
      const isProjectDisabled = input.projectId !== null
        && input.projectMemoryDisabled !== false
      const showsAccountMemory = input.useAccountMemory
        ?? MEMORY_SETTING_DEFAULTS.useAccountMemory
      const index = isProjectDisabled && !showsAccountMemory
        ? null
        : await loadMemoryIndex({
          db: input.db,
          userId: input.userId,
          projectId: isProjectDisabled ? null : input.projectId,
          useAccountMemory: input.useAccountMemory,
          includeSensitive: input.settings.memoryIncludeSensitive,
          hasMemoryTools: input.hasMemoryTools,
        })

      if (index?.text) {
        sections.push(index.text)
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
      }
    } catch (exception) {
      input.logger.set({
        attributes: {
          memoryIndex: { error: exceptionMessage(exception) },
        },
      })
    }
  }

  const aboutMeInstruction = buildAboutMeInstruction(input.settings.aboutMe)

  if (aboutMeInstruction) {
    sections.push(aboutMeInstruction)
  }

  return sections.length > 0 ? sections.join('\n\n') : null
}

import type { UIMessage } from 'ai'
import {
  SKILL_ACTIVATE_TOOL_NAME,
  SKILL_READ_FILE_TOOL_NAME,
  isDataSkillActivationPart,
  toSkillActivationPart,
} from '#shared/utils/skills/runtime'

type UiMessagePart = UIMessage['parts'][number]

const ACTIVATE_PART_TYPE = `tool-${SKILL_ACTIVATE_TOOL_NAME}`
const READ_FILE_PART_TYPE = `tool-${SKILL_READ_FILE_TOOL_NAME}`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function pickString(source: Record<string, unknown>, key: string): unknown {
  return typeof source[key] === 'string' ? source[key] : undefined
}

function redactSkillOutput(
  partType: string,
  output: unknown,
): unknown {
  if (!isRecord(output)) {
    return output
  }

  const redacted: Record<string, unknown> = {
    skillId: pickString(output, 'skillId'),
    name: pickString(output, 'name'),
    version: typeof output.version === 'number' ? output.version : undefined,
  }

  if (partType === ACTIVATE_PART_TYPE) {
    redacted.status = pickString(output, 'status')
  } else {
    redacted.path = pickString(output, 'path')
    redacted.truncated = output.truncated === true
  }

  return redacted
}

/**
 * Strips the skill text from the assistant tool parts of `activate_skill`
 * and `read_skill_file` before they are written to `messages.parts`: the
 * body is re-read from the skill's current version on every later send, so a
 * persisted copy would only be stale text that outlives an edit or a delete.
 * The skill id, name, version, status and (for a file) the path stay, which
 * is what the step card in the chat shows. Pure: the input is never mutated.
 */
export function redactSkillToolPartsForPersistence(
  parts: UIMessage['parts'],
): UIMessage['parts'] {
  return parts.map((part) => {
    if (
      !isRecord(part)
      || (part.type !== ACTIVATE_PART_TYPE && part.type !== READ_FILE_PART_TYPE)
      || !('output' in part)
    ) {
      return part
    }

    return {
      ...part,
      output: redactSkillOutput(part.type, part.output),
    } as UiMessagePart
  })
}

/**
 * Adds a `data-skill-activation` part for every skill the model activated in
 * this answer through `activate_skill`, unless the message already carries
 * one for that skill. It is the part later sends read to keep the skill
 * active through the text-only history sanitizer, which drops tool parts.
 */
export function appendSkillActivationParts(
  parts: UIMessage['parts'],
  activatedAt: string = new Date().toISOString(),
): UIMessage['parts'] {
  const known = new Set(
    parts
      .filter(isDataSkillActivationPart)
      .map(part => part.data.skillId),
  )
  const added: UiMessagePart[] = []

  for (const part of parts) {
    if (
      !isRecord(part)
      || part.type !== ACTIVATE_PART_TYPE
      || part.state !== 'output-available'
      || !isRecord(part.output)
    ) {
      continue
    }

    const { skillId, name, version } = part.output

    if (
      typeof skillId !== 'string'
      || typeof name !== 'string'
      || typeof version !== 'number'
      || known.has(skillId)
    ) {
      continue
    }

    known.add(skillId)
    added.push(
      toSkillActivationPart({ skillId, name, version }, activatedAt) as
        unknown as UiMessagePart,
    )
  }

  return added.length > 0 ? [...parts, ...added] : parts
}

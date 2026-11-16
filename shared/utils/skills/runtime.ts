export const SKILL_INVOCATION_PART_TYPE = 'data-skill-invocation'
export const SKILL_ACTIVATION_PART_TYPE = 'data-skill-activation'
export const SKILL_ACTIVATE_TOOL_NAME = 'activate_skill'
export const SKILL_READ_FILE_TOOL_NAME = 'read_skill_file'
export const SKILL_TOOL_NAMES = [
  SKILL_ACTIVATE_TOOL_NAME,
  SKILL_READ_FILE_TOOL_NAME,
] as const

export type SkillInvocationSource = 'menu' | 'text'

export const SKILL_ACTIVATION_SOURCE_PROJECT = 'project'

export const SKILL_ACTIVATION_SOURCE_JEV = 'jev'

export type SkillActivationSource
  = | typeof SKILL_ACTIVATION_SOURCE_PROJECT
    | typeof SKILL_ACTIVATION_SOURCE_JEV

export interface SkillInvocationPartData {
  skillId: string
  name: string
  version: number
}

export interface SkillActivationPartData extends SkillInvocationPartData {
  activatedAt?: string
  source?: SkillActivationSource
}

export interface DataSkillInvocationPart {
  type: typeof SKILL_INVOCATION_PART_TYPE
  data: SkillInvocationPartData
}

export interface DataSkillActivationPart {
  type: typeof SKILL_ACTIVATION_PART_TYPE
  data: SkillActivationPartData
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSkillPartData(value: unknown): value is SkillInvocationPartData {
  return isRecord(value)
    && typeof value.skillId === 'string'
    && value.skillId.length > 0
    && typeof value.name === 'string'
    && typeof value.version === 'number'
    && Number.isInteger(value.version)
    && value.version >= 1
}

export function isSkillToolName(toolName: string): boolean {
  return (SKILL_TOOL_NAMES as readonly string[]).includes(toolName)
}

export function isDataSkillInvocationPart(
  part: unknown,
): part is DataSkillInvocationPart {
  return isRecord(part)
    && part.type === SKILL_INVOCATION_PART_TYPE
    && isSkillPartData(part.data)
}

export function isDataSkillActivationPart(
  part: unknown,
): part is DataSkillActivationPart {
  return isRecord(part)
    && part.type === SKILL_ACTIVATION_PART_TYPE
    && isSkillPartData(part.data)
}

export function toSkillInvocationPart(
  data: SkillInvocationPartData,
): DataSkillInvocationPart {
  return {
    type: SKILL_INVOCATION_PART_TYPE,
    data: {
      skillId: data.skillId,
      name: data.name,
      version: data.version,
    },
  }
}

export function toSkillActivationPart(
  data: SkillInvocationPartData,
  activatedAt: string = new Date().toISOString(),
  source?: SkillActivationSource,
): DataSkillActivationPart {
  return {
    type: SKILL_ACTIVATION_PART_TYPE,
    data: {
      skillId: data.skillId,
      name: data.name,
      version: data.version,
      activatedAt,
      ...(source ? { source } : {}),
    },
  }
}

/**
 * An activation that came from a project pin, not from the model or the
 * user. It only drives the step in the reasoning list: it is never read back
 * as a skill the chat keeps active, because the pin is read again on every
 * send and a removed pin must stop applying.
 */
export function isProjectSkillActivationPart(part: unknown): boolean {
  return isDataSkillActivationPart(part)
    && part.data.source === SKILL_ACTIVATION_SOURCE_PROJECT
}

/**
 * An activation of a skill TypeSafe AI picked for one message. Like a project
 * pin it only drives the step in the reasoning list: a pick applies to that
 * send only, so a wrong one never stays active for the rest of the chat, and
 * the next send may pick it again if it still fits.
 */
export function isJevSkillActivationPart(part: unknown): boolean {
  return isDataSkillActivationPart(part)
    && part.data.source === SKILL_ACTIVATION_SOURCE_JEV
}

/**
 * An activation that is shown as a step but never read back as a skill the
 * chat keeps active: a project pin or a TypeSafe AI pick.
 */
export function isTransientSkillActivationPart(part: unknown): boolean {
  return isProjectSkillActivationPart(part) || isJevSkillActivationPart(part)
}

export function findSkillInvocation(
  parts: readonly unknown[] | undefined,
): SkillInvocationPartData | null {
  const part = parts?.find(isDataSkillInvocationPart)

  return part ? part.data : null
}

/**
 * The skill tool part types of an assistant message: `tool-activate_skill`
 * and `tool-read_skill_file`, as the UI message stream names them.
 */
export function isSkillToolPartType(partType: string): boolean {
  return partType.startsWith('tool-')
    && isSkillToolName(partType.slice('tool-'.length))
}

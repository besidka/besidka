import {
  SKILL_ACTIVATE_TOOL_NAME,
  SKILL_ACTIVATION_PART_TYPE,
} from '#shared/utils/skills/runtime'

export type SkillStepState = 'working' | 'ready' | 'failed'

export interface SkillStepModel {
  state: SkillStepState
  skillId: string | null
  name: string
}

export const SKILL_STEP_PART_TYPE = `tool-${SKILL_ACTIVATE_TOOL_NAME}`

const WORKING_STATES = new Set(['input-streaming', 'input-available'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function isSkillStepPart(part: unknown): boolean {
  return isRecord(part) && part.type === SKILL_STEP_PART_TYPE
}

/**
 * What the skill step in the reasoning list shows for one `activate_skill`
 * call: working while the call streams or runs, ready with the skill's name
 * and id once it returned, failed when it errored. The name comes from the
 * persisted output (the skill text itself is never persisted), falling back
 * to the call's input while it is still running.
 */
export function getSkillStepModel(part: unknown): SkillStepModel | null {
  if (!isSkillStepPart(part) || !isRecord(part)) {
    return null
  }

  const input = isRecord(part.input) ? part.input : null
  const output = isRecord(part.output) ? part.output : null
  const state = readString(part.state)
  const name = readString(output?.name) || readString(input?.name)

  if (WORKING_STATES.has(state)) {
    return { state: 'working', skillId: null, name }
  }

  if (state === 'output-available') {
    const skillId = readString(output?.skillId) || null

    return {
      state: skillId ? 'ready' : 'failed',
      skillId,
      name,
    }
  }

  return { state: 'failed', skillId: null, name }
}

/**
 * The step for a `data-skill-activation` part: the skill is already applied.
 * An activation next to an `activate_skill` call for the same skill is the
 * same event (the tool call emits both), so only the call makes a step; a
 * lone activation is a skill the user attached to an Auto send.
 */
export function getSkillActivationStepModel(
  parts: readonly unknown[],
  index: number,
): SkillStepModel | null {
  const part = parts[index]

  if (
    !isRecord(part)
    || part.type !== SKILL_ACTIVATION_PART_TYPE
    || !isRecord(part.data)
  ) {
    return null
  }

  const skillId = readString(part.data.skillId)
  const name = readString(part.data.name)

  if (!skillId) {
    return null
  }

  const hasMatchingCall = parts.some((candidate) => {
    const model = getSkillStepModel(candidate)

    return model !== null && model.state === 'ready' && model.skillId === skillId
  })

  return hasMatchingCall ? null : { state: 'ready', skillId, name }
}

export function getReasoningSkillStep(
  parts: readonly unknown[],
  index: number,
): SkillStepModel | null {
  return getSkillStepModel(parts[index])
    ?? getSkillActivationStepModel(parts, index)
}

export function getSkillStepTitle(model: SkillStepModel): string {
  const suffix = model.name ? ` · ${model.name}` : ''

  if (model.state === 'working') {
    return `Reading skill${suffix}`
  }

  return model.state === 'ready'
    ? `Applied skill${suffix}`
    : `Could not use skill${suffix}`
}

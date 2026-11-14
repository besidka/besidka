import { SKILL_ACTIVATE_TOOL_NAME } from '#shared/utils/skills/runtime'

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
 * What the step card in an answer shows for one `activate_skill` call: working
 * while the call streams or runs, ready with the skill's name and id once it
 * returned, failed when it errored. The name comes from the persisted output
 * (the skill text itself is never persisted), falling back to the call's
 * input while it is still running.
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

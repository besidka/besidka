import {
  toSkillInvocationPart,
} from '#shared/utils/skills/runtime'
import type {
  DataSkillInvocationPart,
  SkillInvocationPartData,
  SkillInvocationSource,
} from '#shared/utils/skills/runtime'

export interface ComposerSkillInvocation extends SkillInvocationPartData {
  source: SkillInvocationSource
}

/**
 * The one skill the user attached to the message they are writing. A message
 * carries at most one invocation, so choosing another replaces it. `source`
 * says how it got there: `menu` from the "+" menu, `text` from a typed
 * `/name` (added by the command layer on top of this same state). It is
 * shared by the composer, the new-chat page and the send path, and cleared
 * when the composer goes away or the message is sent.
 */
export function useComposerSkillInvocation() {
  const invocation = useState<ComposerSkillInvocation | null>(
    'composer:skill-invocation',
    () => null,
  )

  const part = computed<DataSkillInvocationPart | null>(() => {
    return invocation.value ? toSkillInvocationPart(invocation.value) : null
  })

  function set(
    next: SkillInvocationPartData,
    source: SkillInvocationSource = 'menu',
  ) {
    invocation.value = {
      skillId: next.skillId,
      name: next.name,
      version: next.version,
      source,
    }
  }

  function clear() {
    invocation.value = null
  }

  function restore(previous: ComposerSkillInvocation | null) {
    invocation.value = previous ? { ...previous } : null
  }

  return { invocation, part, set, clear, restore }
}

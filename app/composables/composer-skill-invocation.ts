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
 * `/name`. It is shared by the composer, the new-chat page and the send
 * path, and cleared when the composer goes away or the message is sent. A
 * restored invocation is always `menu`: the typed token is stripped from the
 * text at send, so after a failed send nothing in the text would keep a
 * `text` invocation alive.
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
    invocation.value = previous
      ? { ...previous, source: 'menu' }
      : null
  }

  return { invocation, part, set, clear, restore }
}

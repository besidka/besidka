import { describe, expect, it } from 'vitest'
import { useComposerSkillInvocation } from '../../../app/composables/composer-skill-invocation'

describe('useComposerSkillInvocation', () => {
  it('holds at most one invocation, and choosing another replaces it', () => {
    const composer = useComposerSkillInvocation()

    composer.clear()
    composer.set({ skillId: 'skl1', name: 'one', version: 1 })
    composer.set({ skillId: 'skl2', name: 'two', version: 4 }, 'text')

    expect(composer.invocation.value).toEqual({
      skillId: 'skl2',
      name: 'two',
      version: 4,
      source: 'text',
    })

    composer.clear()
  })

  it('defaults the source to the menu', () => {
    const composer = useComposerSkillInvocation()

    composer.set({ skillId: 'skl1', name: 'one', version: 1 })

    expect(composer.invocation.value?.source).toBe('menu')
    composer.clear()
  })

  it('builds the message part from the id, name and version only', () => {
    const composer = useComposerSkillInvocation()

    composer.set({ skillId: 'skl1', name: 'one', version: 2 })

    expect(composer.part.value).toEqual({
      type: 'data-skill-invocation',
      data: { skillId: 'skl1', name: 'one', version: 2 },
    })

    composer.clear()

    expect(composer.part.value).toBeNull()
  })

  it('is one shared state, and restore puts a failed send back', () => {
    const first = useComposerSkillInvocation()
    const second = useComposerSkillInvocation()

    first.set({ skillId: 'skl1', name: 'one', version: 2 })

    const snapshot = second.invocation.value
      ? { ...second.invocation.value }
      : null

    first.clear()

    expect(second.invocation.value).toBeNull()

    second.restore(snapshot)

    expect(first.invocation.value).toMatchObject({ skillId: 'skl1' })

    first.restore(null)

    expect(second.invocation.value).toBeNull()
  })
})

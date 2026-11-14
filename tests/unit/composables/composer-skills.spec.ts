import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, ref } from 'vue'
import {
  COMPOSER_SKILLS_SEARCH_MIN,
  toComposerSkillItem,
  useComposerSkills,
  useSkillPreview,
} from '../../../app/composables/composer-skills'
import { createSkillSummary } from '../../setup/helpers/skills-ui'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}))

const skillsActive = ref<boolean>(true)
const data = ref<unknown>(null)

mockNuxtImport('useFeature', () => {
  return () => computed(() => ({
    enabled: skillsActive.value,
    active: skillsActive.value,
    variant: null,
  }))
})
mockNuxtImport('useLazyFetch', () => {
  return () => ({ data, execute: mocks.execute })
})

async function mountComposable() {
  let result: ReturnType<typeof useComposerSkills> | null = null

  await mountSuspended(defineComponent({
    setup() {
      result = useComposerSkills()

      return () => null
    },
  }))

  return result!
}

describe('useComposerSkills', () => {
  beforeEach(() => {
    skillsActive.value = true
    data.value = null
    mocks.execute.mockReset()
  })

  it('fetches only while the skills flag is on', async () => {
    skillsActive.value = false

    await mountComposable()

    expect(mocks.execute).not.toHaveBeenCalled()

    skillsActive.value = true
    await flushPromises()

    expect(mocks.execute).toHaveBeenCalledTimes(1)
  })

  it('does not fetch again when the list is already loaded', async () => {
    data.value = { skills: [], counts: {} }

    await mountComposable()

    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('lists enabled skills that are not broken, by name, in any mode', async () => {
    data.value = {
      skills: [
        createSkillSummary({ id: 'c', name: 'zeta', enabled: true }),
        createSkillSummary({ id: 'a', name: 'alpha', enabled: true }),
        createSkillSummary({
          id: 'm',
          name: 'mid',
          enabled: true,
          modelInvocable: false,
          slashCommand: true,
        }),
        createSkillSummary({ id: 'o', name: 'off-one', enabled: false }),
        createSkillSummary({
          id: 'b',
          name: 'broken-one',
          enabled: true,
          status: 'broken',
        }),
      ],
    }

    const composer = await mountComposable()

    expect(composer.items.value.map(item => item.name))
      .toEqual(['alpha', 'mid', 'zeta'])
    expect(composer.items.value.find(item => item.id === 'm')?.mode)
      .toBe('ask')
    expect(composer.isVisible.value).toBe(true)
  })

  it('is not visible without an enabled skill or without the flag', async () => {
    data.value = { skills: [createSkillSummary({ enabled: false })] }

    const composer = await mountComposable()

    expect(composer.isVisible.value).toBe(false)

    data.value = { skills: [createSkillSummary({ enabled: true })] }

    expect(composer.isVisible.value).toBe(true)

    skillsActive.value = false

    expect(composer.items.value).toEqual([])
    expect(composer.isVisible.value).toBe(false)
  })

  it('maps a skill to the menu item', () => {
    expect(toComposerSkillItem(createSkillSummary({
      id: 'x',
      name: 'one',
      description: 'd',
      currentVersion: 4,
    }))).toEqual({
      id: 'x',
      name: 'one',
      description: 'd',
      version: 4,
      mode: 'auto',
    })
    expect(COMPOSER_SKILLS_SEARCH_MIN).toBe(8)
  })
})

describe('useSkillPreview', () => {
  it('opens and closes one preview for a skill id', () => {
    const preview = useSkillPreview()

    preview.open('skl1')

    expect(preview.skillId.value).toBe('skl1')

    preview.close()

    expect(preview.skillId.value).toBeNull()
  })
})

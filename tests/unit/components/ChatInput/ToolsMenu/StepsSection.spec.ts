import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import StepsSection from '../../../../../app/components/ChatInput/ToolsMenu/StepsSection.vue'

const mocks = vi.hoisted(() => ({
  setStepsExpanded: vi.fn(),
  setStepsAutoHide: vi.fn(),
}))

const stepsExpanded = shallowRef<boolean>(false)
const stepsAutoHide = shallowRef<boolean>(true)

mockNuxtImport('useUserSetting', () => {
  return () => ({
    stepsExpanded,
    stepsAutoHide,
    setStepsExpanded: mocks.setStepsExpanded,
    setStepsAutoHide: mocks.setStepsAutoHide,
  })
})

async function mountSection() {
  const Host = defineComponent({
    setup() {
      return () => h('div', { class: 'js-tools-content' }, h(StepsSection))
    },
  })

  return mountSuspended(Host)
}

type SectionWrapper = Awaited<ReturnType<typeof mountSection>>

function input(wrapper: SectionWrapper, testId: string) {
  return wrapper.get(`[data-testid="${testId}"]`)
    .element as HTMLInputElement
}

function isRevealed(wrapper: SectionWrapper, testId: string): boolean {
  const reveal = wrapper.get(`[data-testid="${testId}"]`)
    .element
    .closest('[data-open]')

  return reveal?.getAttribute('data-open') === 'true'
    && !reveal.hasAttribute('inert')
}

describe('ChatInput/ToolsMenu/StepsSection', () => {
  beforeEach(() => {
    stepsExpanded.value = false
    stepsAutoHide.value = true
    mocks.setStepsExpanded.mockReset()
    mocks.setStepsAutoHide.mockReset()
  })

  it('always renders Show steps expanded, reflecting the saved setting',
    async () => {
      const wrapper = await mountSection()

      expect(input(wrapper, 'steps-expanded-toggle').checked).toBe(false)
      expect(input(wrapper, 'steps-expanded-toggle').disabled).toBe(false)

      stepsExpanded.value = true
      await nextTick()

      expect(input(wrapper, 'steps-expanded-toggle').checked).toBe(true)
    })

  it('hides Auto-hide until steps are expanded', async () => {
    const wrapper = await mountSection()

    expect(isRevealed(wrapper, 'steps-auto-hide-toggle')).toBe(false)

    stepsExpanded.value = true
    await nextTick()

    expect(isRevealed(wrapper, 'steps-auto-hide-toggle')).toBe(true)
    expect(input(wrapper, 'steps-auto-hide-toggle').checked).toBe(true)
  })

  it('saves both toggles through the shared setters', async () => {
    stepsExpanded.value = true

    const wrapper = await mountSection()

    await wrapper.get('[data-testid="steps-expanded-toggle"]')
      .setValue(false)
    await wrapper.get('[data-testid="steps-auto-hide-toggle"]')
      .setValue(false)

    expect(mocks.setStepsExpanded).toHaveBeenCalledWith(false)
    expect(mocks.setStepsAutoHide).toHaveBeenCalledWith(false)
  })
})

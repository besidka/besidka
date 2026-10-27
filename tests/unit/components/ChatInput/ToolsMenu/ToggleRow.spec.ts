import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import {
  provideRevealGuardRoot,
  REVEAL_GUARD_DURATION_MS,
} from '../../../../../app/composables/reveal-guard'
import ToggleRow from '../../../../../app/components/ChatInput/ToolsMenu/ToggleRow.vue'

function mountMenu() {
  const updates: Record<string, boolean[]> = { early: [], late: [] }

  const Menu = defineComponent({
    props: { isLateRowVisible: Boolean },
    setup(props) {
      provideRevealGuardRoot()

      return () => h('div', [
        h(ToggleRow, {
          'label': 'Early',
          'modelValue': false,
          'testId': 'early',
          'onUpdate:modelValue': (value: boolean) => updates.early?.push(value),
        }),
        props.isLateRowVisible
          ? h(ToggleRow, {
            'label': 'Late',
            'modelValue': false,
            'testId': 'late',
            'onUpdate:modelValue': (value: boolean) => updates.late?.push(value),
          })
          : null,
      ])
    },
  })

  return { updates, mounted: mountSuspended(Menu, { attachTo: document.body }) }
}

function input(
  wrapper: Awaited<ReturnType<typeof mountMenu>['mounted']>,
  testId: string,
) {
  return wrapper.get(`[data-testid="${testId}"]`).element as HTMLInputElement
}

describe('ChatInput/ToolsMenu/ToggleRow reveal guard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts an immediate click on a row present when the menu opened',
    async () => {
      const { updates, mounted } = mountMenu()
      const wrapper = await mounted

      input(wrapper, 'early').click()

      expect(updates.early).toEqual([true])
    })

  it('ignores clicks and changes on a row revealed a moment ago, without '
    + 'flipping it', async () => {
    const { updates, mounted } = mountMenu()
    const wrapper = await mounted

    await wrapper.setProps({ isLateRowVisible: true })

    input(wrapper, 'late').click()
    await wrapper.get('[data-testid="late"]').setValue(true)

    expect(updates.late).toEqual([])
    expect(input(wrapper, 'late').checked).toBe(false)
  })

  it('accepts a click once the window has passed', async () => {
    const { updates, mounted } = mountMenu()
    const wrapper = await mounted

    await wrapper.setProps({ isLateRowVisible: true })

    vi.advanceTimersByTime(REVEAL_GUARD_DURATION_MS - 1)
    input(wrapper, 'late').click()

    expect(updates.late).toEqual([])

    vi.advanceTimersByTime(1)
    await wrapper.vm.$nextTick()
    input(wrapper, 'late').click()

    expect(updates.late).toEqual([true])
  })
})

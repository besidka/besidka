import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import {
  provideRevealGuardRoot,
  REVEAL_GUARD_DURATION_MS,
  useRevealGuard,
} from '../../../app/composables/reveal-guard'

const Probe = defineComponent({
  props: { testId: { type: String, required: true } },
  setup(props) {
    const { isGuarded } = useRevealGuard()

    return () => h('span', {
      'data-testid': props.testId,
      'data-guarded': String(isGuarded.value),
    })
  },
})

const GuardRoot = defineComponent({
  props: { isLateProbeVisible: Boolean },
  setup(props) {
    provideRevealGuardRoot()

    return () => h('div', [
      h(Probe, { testId: 'early' }),
      props.isLateProbeVisible ? h(Probe, { testId: 'late' }) : null,
    ])
  },
})

const Standalone = defineComponent({
  setup() {
    return () => h(Probe, { testId: 'standalone' })
  },
})

function guardedState(
  wrapper: Awaited<ReturnType<typeof mountSuspended>>,
  testId: string,
) {
  return wrapper.get(`[data-testid="${testId}"]`).attributes('data-guarded')
}

describe('useRevealGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('never guards a control present when the menu first rendered',
    async () => {
      const wrapper = await mountSuspended(GuardRoot)

      expect(guardedState(wrapper, 'early')).toBe('false')

      vi.advanceTimersByTime(REVEAL_GUARD_DURATION_MS * 2)
      await wrapper.vm.$nextTick()

      expect(guardedState(wrapper, 'early')).toBe('false')
    })

  it('guards a control mounted after the first render until the window '
    + 'passes', async () => {
    const wrapper = await mountSuspended(GuardRoot)

    await wrapper.setProps({ isLateProbeVisible: true })

    expect(guardedState(wrapper, 'late')).toBe('true')

    vi.advanceTimersByTime(REVEAL_GUARD_DURATION_MS - 1)
    await wrapper.vm.$nextTick()

    expect(guardedState(wrapper, 'late')).toBe('true')

    vi.advanceTimersByTime(1)
    await wrapper.vm.$nextTick()

    expect(guardedState(wrapper, 'late')).toBe('false')
    expect(guardedState(wrapper, 'early')).toBe('false')
  })

  it('does not guard a control rendered outside a guard root', async () => {
    const wrapper = await mountSuspended(Standalone)

    expect(guardedState(wrapper, 'standalone')).toBe('false')
  })

  it('clears its timer when the control unmounts inside the window',
    async () => {
      const wrapper = await mountSuspended(GuardRoot)

      await wrapper.setProps({ isLateProbeVisible: true })
      await wrapper.setProps({ isLateProbeVisible: false })

      expect(vi.getTimerCount()).toBe(0)
    })
})

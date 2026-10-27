import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import {
  provideRevealGuardRoot,
  provideRevealScope,
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

const ScopeProbe = defineComponent({
  props: { isOpen: Boolean },
  setup(props) {
    provideRevealScope(() => props.isOpen)

    return () => h(Probe, { testId: 'scoped' })
  },
})

const ScopedRoot = defineComponent({
  props: { isOpen: Boolean },
  setup(props) {
    provideRevealGuardRoot()

    return () => h(ScopeProbe, { isOpen: props.isOpen })
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

  describe('reveal scope', () => {
    it('does not guard controls in a scope that is open on the first '
      + 'render', async () => {
      const wrapper = await mountSuspended(ScopedRoot, {
        props: { isOpen: true },
      })

      expect(guardedState(wrapper, 'scoped')).toBe('false')
    })

    it('guards controls already mounted in a scope for the window after it '
      + 'opens', async () => {
      const wrapper = await mountSuspended(ScopedRoot, {
        props: { isOpen: false },
      })

      expect(guardedState(wrapper, 'scoped')).toBe('false')

      await wrapper.setProps({ isOpen: true })

      expect(guardedState(wrapper, 'scoped')).toBe('true')

      vi.advanceTimersByTime(REVEAL_GUARD_DURATION_MS)
      await wrapper.vm.$nextTick()

      expect(guardedState(wrapper, 'scoped')).toBe('false')
    })

    it('drops the guard as soon as the scope closes again', async () => {
      const wrapper = await mountSuspended(ScopedRoot, {
        props: { isOpen: false },
      })

      await wrapper.setProps({ isOpen: true })
      await wrapper.setProps({ isOpen: false })

      expect(guardedState(wrapper, 'scoped')).toBe('false')
      expect(vi.getTimerCount()).toBe(0)
    })
  })
})

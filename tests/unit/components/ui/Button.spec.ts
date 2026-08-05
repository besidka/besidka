import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import UiButton from '../../../../app/components/ui/Button.vue'

describe('ui/Button', () => {
  it('stays circular at every breakpoint when circle is set alone', async () => {
    const wrapper = await mountSuspended(UiButton, {
      props: { circle: true, text: 'Action' },
    })
    const button = wrapper.get('button')

    expect(button.classes()).toContain('btn-circle')
    expect(button.classes()).not.toContain('max-lg:btn-circle')
    expect(button.classes()).not.toContain('lg:btn-circle')
  })

  it('scopes circle to mobile only when paired with iconOnlyMobile', async () => {
    const wrapper = await mountSuspended(UiButton, {
      props: { circle: true, iconOnlyMobile: true, text: 'Action' },
    })
    const button = wrapper.get('button')

    expect(button.classes()).not.toContain('btn-circle')
    expect(button.classes()).toContain('max-lg:btn-circle')
    expect(button.classes()).not.toContain('lg:btn-circle')
  })

  it('stays square at every breakpoint when square is set alone', async () => {
    const wrapper = await mountSuspended(UiButton, {
      props: { square: true, text: 'Action' },
    })
    const button = wrapper.get('button')

    expect(button.classes()).toContain('btn-square')
    expect(button.classes()).not.toContain('max-lg:btn-square')
    expect(button.classes()).not.toContain('lg:btn-square')
  })

  it('scopes square to desktop only when paired with iconOnlyDesktop', async () => {
    const wrapper = await mountSuspended(UiButton, {
      props: { square: true, iconOnlyDesktop: true, text: 'Action' },
    })
    const button = wrapper.get('button')

    expect(button.classes()).not.toContain('btn-square')
    expect(button.classes()).not.toContain('max-lg:btn-square')
    expect(button.classes()).toContain('lg:btn-square')
  })
})

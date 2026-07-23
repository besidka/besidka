import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import UiAlert from '../../../../app/components/ui/Alert.vue'

describe('ui/Alert', () => {
  it('renders sticky by default', async () => {
    const wrapper = await mountSuspended(UiAlert)
    const bubble = wrapper.find('[role="alert"]')

    expect(bubble.classes()).toContain('sticky')
    expect(bubble.classes()).not.toContain('fixed')
  })

  it('renders fixed when the fixed prop is set', async () => {
    const wrapper = await mountSuspended(UiAlert, {
      props: { fixed: true },
    })
    const bubble = wrapper.find('[role="alert"]')

    expect(bubble.classes()).toContain('fixed')
    expect(bubble.classes()).not.toContain('sticky')
  })
})

import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import MessageBubble from '../../../../app/components/landing/MessageBubble.vue'

const mountOptions = {
  global: {
    stubs: {
      Logo: true,
      Icon: true,
    },
  },
}

describe('MessageBubble.vue', () => {
  // ARIA in HTML forbids naming a `generic` element, which a bare div maps to,
  // so a labelled bubble needs a role that permits a name. `group` does and is
  // not a landmark -- `region` would be, and ~10 of those is the overuse MDN
  // and the ARIA APG warn against.
  it('takes a group role only when sr-label gives it a name', async () => {
    const wrapper = await mountSuspended(MessageBubble, {
      props: {
        role: 'assistant',
        srLabel: 'Community size',
      },
      ...mountOptions,
    })

    expect(wrapper.attributes('role')).toBe('group')
    expect(wrapper.attributes('aria-label')).toBe('Community size')
    expect(wrapper.attributes('aria-labelledby')).toBeUndefined()
  })

  it('has no accessible name of its own when sr-label is omitted',
    async () => {
      const wrapper = await mountSuspended(MessageBubble, {
        props: { role: 'user' },
        ...mountOptions,
      })

      expect(wrapper.attributes('role')).toBeUndefined()
      expect(wrapper.attributes('aria-label')).toBeUndefined()
      expect(wrapper.attributes('aria-labelledby')).toBeUndefined()
    })
})

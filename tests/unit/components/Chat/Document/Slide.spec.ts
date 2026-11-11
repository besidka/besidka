import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ChatDocumentSlide from '../../../../../app/components/Chat/Document/Slide.vue'

enableAutoUnmount(afterEach)

describe('ChatDocumentSlide', () => {
  it('labels the slide once and keeps the card out of the landmarks',
    async () => {
      const wrapper = await mountSuspended(ChatDocumentSlide, {
        props: {
          slide: { layout: 'content', title: 'Roadmap', bullets: [] },
          position: 2,
          total: 5,
        },
      })
      const card = wrapper.get('[data-testid="document-slide-card"]')

      expect(wrapper.get('[data-testid="document-slide"]').attributes(
        'aria-label',
      )).toBe('Slide 2 of 5: Roadmap')
      expect(card.attributes('role')).toBeUndefined()
      expect(card.attributes('aria-label')).toBeUndefined()
      expect(card.attributes('tabindex')).toBe('0')
      expect(wrapper.find('[role="region"]').exists()).toBe(false)
    })
})

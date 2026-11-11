import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import ChatDocumentBlocks from '../../../../../app/components/Chat/Document/Blocks.vue'

enableAutoUnmount(afterEach)

describe('ChatDocumentBlocks headings', () => {
  it('renders block levels 1 to 4 as h4, h5, h6 and h6', async () => {
    const wrapper = await mountSuspended(ChatDocumentBlocks, {
      props: {
        blocks: [
          { type: 'heading', level: 1, text: 'One' },
          { type: 'heading', level: 2, text: 'Two' },
          { type: 'heading', level: 3, text: 'Three' },
          { type: 'heading', level: 4, text: 'Four' },
        ],
      },
    })
    const tags = wrapper
      .findAll('[data-testid="document-block-heading"]')
      .map(heading => heading.element.tagName)

    expect(tags).toEqual(['H4', 'H5', 'H6', 'H6'])
    expect(wrapper.find('h1, h2, h3').exists()).toBe(false)
  })
})

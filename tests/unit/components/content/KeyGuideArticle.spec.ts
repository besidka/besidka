import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import KeyGuideArticle from '../../../../app/components/content/KeyGuideArticle.vue'
import {
  KEY_GUIDE_SURFACE_INJECTION_KEY,
} from '../../../../app/utils/key-guide-surface'

const ARTICLE_SLOT = '<h2>What is Jev?</h2><p>A decision model.</p>'

describe('KeyGuideArticle.vue', () => {
  it('renders its content on the public guide page by default', async () => {
    const wrapper = await mountSuspended(KeyGuideArticle, {
      slots: { default: () => ARTICLE_SLOT },
    })

    expect(wrapper.find('[data-testid="key-guide-article"]').exists())
      .toBe(true)
    expect(wrapper.text()).toContain('What is Jev?')
  })

  it('renders its content when the page surface is provided', async () => {
    const wrapper = await mountSuspended(KeyGuideArticle, {
      slots: { default: () => ARTICLE_SLOT },
      global: {
        provide: { [KEY_GUIDE_SURFACE_INJECTION_KEY]: 'page' },
      },
    })

    expect(wrapper.text()).toContain('A decision model.')
  })

  it('renders nothing inside the keys page card', async () => {
    const wrapper = await mountSuspended(KeyGuideArticle, {
      slots: { default: () => ARTICLE_SLOT },
      global: {
        provide: { [KEY_GUIDE_SURFACE_INJECTION_KEY]: 'card' },
      },
    })

    expect(wrapper.find('[data-testid="key-guide-article"]').exists())
      .toBe(false)
    expect(wrapper.text()).not.toContain('What is Jev?')
  })
})

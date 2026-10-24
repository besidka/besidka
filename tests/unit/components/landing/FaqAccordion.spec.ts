import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import FaqAccordion from '../../../../app/components/landing/FaqAccordion.vue'

const MDCCachedStub = defineComponent({
  name: 'MDCCached',
  props: {
    cacheKey: { type: String, default: '' },
    value: { type: String, default: '' },
  },
  setup(props) {
    return () => {
      return h('div', {
        'data-testid': 'faq-answer',
        'data-cache-key': props.cacheKey,
      }, props.value)
    }
  },
})

const ITEMS = [
  { question: 'Is it free?', answer: 'Yes, **free**.' },
  { question: 'Is it private?', answer: 'Yes, private.' },
]

async function mountAccordion(props: Record<string, unknown> = {}) {
  return mountSuspended(FaqAccordion, {
    props: { items: ITEMS, ...props },
    global: { stubs: { MDCCached: MDCCachedStub } },
  })
}

async function readCacheKeys(props: Record<string, unknown> = {}) {
  const wrapper = await mountAccordion(props)

  return wrapper.findAll('[data-testid="faq-answer"]').map((answer) => {
    return answer.attributes('data-cache-key')
  })
}

describe('FaqAccordion.vue', () => {
  it('prefixes each answer cache key with the home group name', async () => {
    const cacheKeys = await readCacheKeys({ groupName: 'home-faq' })

    expect(cacheKeys).toEqual(['home-faq-0', 'home-faq-1'])
  })

  it('prefixes each answer cache key with the key guide group name',
    async () => {
      const cacheKeys = await readCacheKeys({
        groupName: 'key-guide-faq-gemini-api-key',
      })

      expect(cacheKeys[0]).toBe('key-guide-faq-gemini-api-key-0')
      expect(cacheKeys[1]).toBe('key-guide-faq-gemini-api-key-1')
    })

  it('never shares a cache key between two different group names',
    async () => {
      const homeKeys = await readCacheKeys({ groupName: 'home-faq' })
      const guideKeys = await readCacheKeys({
        groupName: 'key-guide-faq-gemini-api-key',
      })
      const sharedKeys = homeKeys.filter((cacheKey) => {
        return guideKeys.includes(cacheKey)
      })

      expect(sharedKeys).toEqual([])
    })

  it('defaults the group name to faq', async () => {
    const cacheKeys = await readCacheKeys()

    expect(cacheKeys).toEqual(['faq-0', 'faq-1'])
  })

  it('passes the answer markdown to the cached renderer', async () => {
    const wrapper = await mountAccordion({ groupName: 'home-faq' })
    const answers = wrapper.findAll('[data-testid="faq-answer"]').map(
      (answer) => {
        return answer.text()
      },
    )

    expect(answers).toEqual(ITEMS.map((item) => {
      return item.answer
    }))
  })

  it('names every details element after the group name', async () => {
    const wrapper = await mountAccordion({ groupName: 'home-faq' })
    const detailsElements = wrapper.findAll('details')

    expect(detailsElements).toHaveLength(2)

    for (const details of detailsElements) {
      expect(details.attributes('name')).toBe('home-faq')
    }
  })

  it('shows the question text in each summary', async () => {
    const wrapper = await mountAccordion({ groupName: 'home-faq' })
    const questions = wrapper.findAll('summary').map((summary) => {
      return summary.text()
    })

    expect(questions).toEqual(['Is it free?', 'Is it private?'])
  })
})

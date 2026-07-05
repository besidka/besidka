import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import type { ResearchClarificationResponse } from '#shared/types/research.d'
import DeepResearchClarify from '../../../../app/components/Chat/DeepResearchClarify.vue'

const clarification: ResearchClarificationResponse = {
  questions: [
    {
      id: 'audience',
      question: 'Who is this research for?',
      kind: 'choice',
      options: ['Founders', 'Engineers', 'Investors'],
    },
    {
      id: 'timeframe',
      question: 'Which timeframe should the report cover?',
      kind: 'text',
      placeholder: 'e.g. last 3 years',
    },
  ],
  note: 'These help narrow the research scope.',
}

describe('Chat/DeepResearchClarify', () => {
  it('shows the note and each question rendered by kind', async () => {
    const wrapper = await mountSuspended(DeepResearchClarify, {
      props: { clarification },
    })

    expect(wrapper.text()).toContain(clarification.note)
    expect(
      wrapper
        .find('[data-testid="research-clarify-question-audience"]')
        .exists(),
    ).toBe(true)
    expect(
      wrapper
        .find('[data-testid="research-clarify-option-audience-Founders"]')
        .exists(),
    ).toBe(true)
    expect(
      wrapper
        .find('[data-testid="research-clarify-text-timeframe"]')
        .exists(),
    ).toBe(true)
  })

  it('emits submit with only the answered choice question', async () => {
    const wrapper = await mountSuspended(DeepResearchClarify, {
      props: { clarification },
    })

    await wrapper
      .find('[data-testid="research-clarify-option-audience-Engineers"]')
      .trigger('click')
    await wrapper
      .find('[data-testid="research-clarify-form"]')
      .trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([[
      [
        {
          id: 'audience',
          question: 'Who is this research for?',
          answer: 'Engineers',
        },
      ],
    ]])
  })

  it('emits submit with a typed text answer', async () => {
    const wrapper = await mountSuspended(DeepResearchClarify, {
      props: { clarification },
    })

    await wrapper
      .find('[data-testid="research-clarify-text-timeframe"]')
      .setValue('last 3 years')
    await wrapper
      .find('[data-testid="research-clarify-form"]')
      .trigger('submit')

    expect(wrapper.emitted('submit')).toEqual([[
      [
        {
          id: 'timeframe',
          question: 'Which timeframe should the report cover?',
          answer: 'last 3 years',
        },
      ],
    ]])
  })

  it('emits skip', async () => {
    const wrapper = await mountSuspended(DeepResearchClarify, {
      props: { clarification },
    })

    await wrapper
      .find('[data-testid="research-clarify-skip"]')
      .trigger('click')

    expect(wrapper.emitted('skip')).toHaveLength(1)
  })

  it('disables the submit and skip buttons once submitting', async () => {
    const wrapper = await mountSuspended(DeepResearchClarify, {
      props: { clarification },
    })

    await wrapper
      .find('[data-testid="research-clarify-form"]')
      .trigger('submit')

    expect(
      wrapper
        .find('[data-testid="research-clarify-submit"]')
        .attributes('disabled'),
    ).toBeDefined()
    expect(
      wrapper
        .find('[data-testid="research-clarify-skip"]')
        .attributes('disabled'),
    ).toBeDefined()
  })
})

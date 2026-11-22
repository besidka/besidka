import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import GoogleLinkSuggestions from '../../../../../../app/components/ChatInput/Files/Attached/GoogleLinkSuggestions.vue'

function labels(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  return wrapper
    .findAll('[data-testid="google-link-suggestion-attach"]')
    .map(button => button.text())
}

describe('ChatInput/Files/Attached/GoogleLinkSuggestions', () => {
  it('renders nothing without a suggestion', async () => {
    const wrapper = await mountSuspended(GoogleLinkSuggestions, {
      props: { suggestions: [] },
    })

    expect(wrapper.find('[data-testid="google-link-suggestions"]').exists())
      .toBe(false)
  })

  it('says "Attach this Google file" for one suggestion', async () => {
    const wrapper = await mountSuspended(GoogleLinkSuggestions, {
      props: { suggestions: [{ id: 'a', kind: 'document' }] },
    })

    expect(labels(wrapper)).toEqual(['Attach this Google file'])
    expect(wrapper.get('[data-testid="google-link-suggestions"]')
      .attributes('aria-live')).toBe('polite')
  })

  it('names the kind of each file when there are several, and numbers '
    + 'two of the same kind', async () => {
    const wrapper = await mountSuspended(GoogleLinkSuggestions, {
      props: {
        suggestions: [
          { id: 'a', kind: 'spreadsheet' },
          { id: 'b', kind: 'document' },
          { id: 'c', kind: 'document' },
        ],
      },
    })

    expect(labels(wrapper)).toEqual([
      'Attach this Google Sheet',
      'Attach this Google Doc (1)',
      'Attach this Google Doc (2)',
    ])
  })

  it('emits the id to accept or dismiss', async () => {
    const wrapper = await mountSuspended(GoogleLinkSuggestions, {
      props: {
        suggestions: [
          { id: 'a', kind: 'file' },
          { id: 'b', kind: 'file' },
        ],
      },
    })

    await wrapper.findAll('[data-testid="google-link-suggestion-attach"]')[1]!
      .trigger('click')
    await wrapper.findAll('[data-testid="google-link-suggestion-dismiss"]')[0]!
      .trigger('click')

    expect(wrapper.emitted('accept')).toEqual([['b']])
    expect(wrapper.emitted('dismiss')).toEqual([['a']])
  })

  it('cannot be accepted while a pick or copy is running, but can be '
    + 'dismissed', async () => {
    const wrapper = await mountSuspended(GoogleLinkSuggestions, {
      props: {
        suggestions: [{ id: 'a', kind: 'file' }],
        isBusy: true,
      },
    })

    expect(wrapper.get('[data-testid="google-link-suggestion-attach"]')
      .attributes('disabled')).toBeDefined()
    expect(wrapper.get('[data-testid="google-link-suggestion-dismiss"]')
      .attributes('disabled')).toBeUndefined()
  })

  it('gives the dismiss button a name that says what it dismisses',
    async () => {
      const wrapper = await mountSuspended(GoogleLinkSuggestions, {
        props: { suggestions: [{ id: 'a', kind: 'presentation' }] },
      })

      expect(wrapper.get('[data-testid="google-link-suggestion-dismiss"]')
        .attributes('aria-label'))
        .toBe('Dismiss: Attach this Google file')
    })
})

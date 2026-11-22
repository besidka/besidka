import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import GoogleLinkSuggestions from '../../../../../../app/components/ChatInput/Files/Attached/GoogleLinkSuggestions.vue'

function labels(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  return wrapper
    .findAll('[data-testid="google-link-suggestion-attach"]')
    .map(button => button.text())
}

describe('ChatInput/Files/Attached/GoogleLinkSuggestions', () => {
  it('shows no button and says nothing without a suggestion, but keeps its '
    + 'live region', async () => {
    const wrapper = await mountSuspended(GoogleLinkSuggestions, {
      props: { suggestions: [] },
    })
    const status = wrapper.get(
      '[data-testid="google-link-suggestions-status"]',
    )

    expect(wrapper.find('[data-testid="google-link-suggestion"]').exists())
      .toBe(false)
    expect(status.text()).toBe('')
    expect(status.attributes('role')).toBe('status')
    expect(status.attributes('aria-live')).toBe('polite')
  })

  it('keeps one live region that receives the text when a suggestion '
    + 'appears, instead of a live root that appears with it', async () => {
    const wrapper = await mountSuspended(GoogleLinkSuggestions, {
      props: { suggestions: [] },
    })
    const status = wrapper.get(
      '[data-testid="google-link-suggestions-status"]',
    )

    await wrapper.setProps({
      suggestions: [{ id: 'a', kind: 'document' }],
    })

    expect(wrapper.get('[data-testid="google-link-suggestions-status"]')
      .element).toBe(status.element)
    expect(status.text()).toContain('A Google file link in your message')
    expect(status.text()).toContain('open the file in Google Drive')
    expect(wrapper.find('[aria-live]').element).toBe(status.element)
    expect(wrapper.get('[role="group"]').attributes('aria-live'))
      .toBeUndefined()
  })

  it('tells the user to open the file in Google Drive first, in case the '
    + 'Picker shows nothing', async () => {
    const wrapper = await mountSuspended(GoogleLinkSuggestions, {
      props: { suggestions: [{ id: 'a', kind: 'file' }] },
    })

    expect(wrapper.get('[data-testid="google-link-suggestions-hint"]').text())
      .toBe(
        'If the Picker shows nothing, open the file in Google Drive with the '
        + 'connected account first.',
      )
  })

  it('moves focus to the next suggestion, or to the textarea, when one is '
    + 'dismissed', async () => {
    const textarea = document.createElement('textarea')

    textarea.className = 'js-chat-input-textarea'
    document.body.appendChild(textarea)

    let remaining: Array<{ id: string, kind: 'file' }> = [
      { id: 'a', kind: 'file' },
      { id: 'b', kind: 'file' },
    ]
    const wrapper = await mountSuspended(GoogleLinkSuggestions, {
      props: {
        suggestions: remaining,
        onDismiss: (id: string) => {
          remaining = remaining.filter(suggestion => suggestion.id !== id)
          wrapper.setProps({ suggestions: remaining })
        },
      },
      attachTo: document.body,
    })

    await wrapper.findAll('[data-testid="google-link-suggestion-dismiss"]')[0]!
      .trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="google-link-suggestion-attach"]').element,
    )

    await wrapper.get('[data-testid="google-link-suggestion-dismiss"]')
      .trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(textarea)

    wrapper.unmount()
    textarea.remove()
  })

  it('says "Attach this Google file" for one suggestion', async () => {
    const wrapper = await mountSuspended(GoogleLinkSuggestions, {
      props: { suggestions: [{ id: 'a', kind: 'document' }] },
    })

    expect(labels(wrapper)).toEqual(['Attach this Google file'])
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

import { describe, expect, it } from 'vitest'
import { minimarkToMarkdown } from '~~/server/utils/mcp/minimark'
import type { MinimarkBody } from '~~/server/utils/mcp/minimark'

function body(...value: MinimarkBody['value']): MinimarkBody {
  return { type: 'minimark', value }
}

describe('minimarkToMarkdown', () => {
  it('returns an empty string for a missing or malformed body', () => {
    expect(minimarkToMarkdown(null)).toBe('')
    expect(minimarkToMarkdown(undefined)).toBe('')
    expect(
      minimarkToMarkdown({ type: 'minimark' } as unknown as MinimarkBody),
    ).toBe('')
  })

  it('renders numbered lists with inline formatting and links', () => {
    const markdown = minimarkToMarkdown(body(
      ['ol', {},
        ['li', {},
          'Open the ',
          ['a', { href: 'https://example.com/keys' }, 'keys page'],
          ' and sign in.',
        ],
        ['li', {},
          'Click ',
          ['strong', {}, 'Create'],
          ', name it ',
          ['code', {}, 'Besidka'],
          '.',
        ],
      ],
    ))

    expect(markdown).toBe([
      '1. Open the [keys page](https://example.com/keys) and sign in.',
      '2. Click **Create**, name it `Besidka`.',
    ].join('\n'))
  })

  it('separates blocks with a blank line', () => {
    const markdown = minimarkToMarkdown(body(
      ['h2', { id: 'intro' }, 'Intro'],
      ['p', {}, 'First ', ['em', {}, 'paragraph'], '.'],
      ['ul', {}, ['li', {}, 'one'], ['li', {}, 'two']],
    ))

    expect(markdown).toBe([
      '## Intro',
      '',
      'First *paragraph*.',
      '',
      '- one',
      '- two',
    ].join('\n'))
  })

  it('indents block children of a list item', () => {
    const markdown = minimarkToMarkdown(body(
      ['ul', {},
        ['li', {}, ['p', {}, 'Parent'], ['ul', {}, ['li', {}, 'Child']]],
      ],
    ))

    expect(markdown).toBe('- Parent\n\n   - Child')
  })

  it('renders fenced code blocks with their language', () => {
    const markdown = minimarkToMarkdown(body(
      ['pre', {}, ['code', { language: 'json' }, '{ "a": 1 }\n']],
    ))

    expect(markdown).toBe('```json\n{ "a": 1 }\n```')
  })

  it('renders tables with a header separator and escaped pipes', () => {
    const markdown = minimarkToMarkdown(body(
      ['table', {},
        ['thead', {}, ['tr', {}, ['th', {}, 'Name'], ['th', {}, 'Purpose']]],
        ['tbody', {},
          ['tr', {},
            ['td', {}, ['code', {}, 'session']],
            ['td', {}, 'Keeps you in | out'],
          ],
        ],
      ],
    ))

    expect(markdown).toBe([
      '| Name | Purpose |',
      '| --- | --- |',
      '| `session` | Keeps you in \\| out |',
    ].join('\n'))
  })

  it('renders block quotes line by line', () => {
    const markdown = minimarkToMarkdown(body(
      ['blockquote', {}, ['p', {}, 'Quoted']],
    ))

    expect(markdown).toBe('> Quoted')
  })

  it('keeps the children of unknown container components', () => {
    const markdown = minimarkToMarkdown(body(
      ['key-guide-article', {},
        ['h2', {}, 'Heading'],
        ['p', {}, 'Body'],
      ],
    ))

    expect(markdown).toBe('## Heading\n\nBody')
  })

  it('renders registered components inline and drops unregistered ones', () => {
    const tree = body(
      ['p', {}, 'Write to ', ['privacy-email-link', {}], '.'],
    )

    expect(minimarkToMarkdown(tree, {
      components: {
        'privacy-email-link': () => {
          return 'privacy@example.com'
        },
      },
    })).toBe('Write to privacy@example.com.')
    expect(minimarkToMarkdown(tree)).toBe('Write to .')
  })
})

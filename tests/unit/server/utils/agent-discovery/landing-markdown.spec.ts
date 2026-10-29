import { describe, expect, it } from 'vitest'
import {
  buildLandingBody,
  markdownToNodes,
  parseInlineMarkdown,
} from '~~/server/utils/agent-discovery/landing-markdown'
import type { LandingPage } from '~~/server/utils/agent-discovery/landing-markdown'
import type { MinimarkNode } from '~~/server/utils/content/minimark'

function createPage(body: MinimarkNode[]): LandingPage {
  return {
    hero: {
      primaryCta: { label: 'Start chatting', href: '/signup' },
      guideLink: { label: 'Fastest start', href: '/guides/gemini-api-key' },
    },
    carousel: [{ caption: 'Model, tokens and cost on every answer' }],
    steps: [{ title: '1. Sign up', body: 'Create a free account.' }],
    features: [{ title: 'Web search', body: 'Ground answers in the web.' }],
    benefits: [{ title: 'No flat fee', body: 'Pay per message.' }],
    faqs: [
      {
        question: 'Can I start for free?',
        answer: 'Yes. [Get a Gemini key](/guides/gemini-api-key) first.',
      },
    ],
    comparison: {
      columns: ['Besidka', 'ChatGPT Plus'],
      rows: [{ label: 'Monthly fee', values: ['Free', '$20/mo'] }],
      note: 'Besidka is free.',
      priceDate: '2026-10-20',
      sources: [{ label: 'ChatGPT Plus', url: 'https://example.com/plus' }],
    },
    body: { value: body },
  }
}

function tags(nodes: MinimarkNode[]): string[] {
  return nodes.map((node) => {
    return typeof node === 'string' ? '#text' : node[0]
  })
}

describe('parseInlineMarkdown', () => {
  it('turns markdown links into anchor nodes', () => {
    expect(parseInlineMarkdown('See [the guide](/byok) now')).toEqual([
      'See ',
      ['a', { href: '/byok' }, 'the guide'],
      ' now',
    ])
  })
})

describe('parseInlineMarkdown emphasis', () => {
  it('keeps bold, italic and inline code as nodes', () => {
    expect(parseInlineMarkdown('Use **Auto**, *fast* and `max_tokens`')).toEqual([
      'Use ',
      ['strong', {}, 'Auto'],
      ', ',
      ['em', {}, 'fast'],
      ' and ',
      ['code', {}, 'max_tokens'],
    ])
  })

  it('keeps emphasis inside a link label', () => {
    expect(parseInlineMarkdown('[**Go**](/byok)')).toEqual([
      ['a', { href: '/byok' }, ['strong', {}, 'Go']],
    ])
  })

  it('leaves text without markup untouched', () => {
    expect(parseInlineMarkdown('2 * 3 and a_b')).toEqual(['2 * 3 and a_b'])
  })
})

describe('markdownToNodes', () => {
  it('keeps paragraphs and lists in their authored order', () => {
    const nodes = markdownToNodes(
      'First\n- one\n- two\nMiddle\n1. alpha\n2. beta\nLast',
    )

    expect(tags(nodes)).toEqual(['p', 'ul', 'p', 'ol', 'p'])
    expect(nodes[1]).toEqual([
      'ul',
      {},
      ['li', {}, 'one'],
      ['li', {}, 'two'],
    ])
  })

  it('keeps bold and code inside paragraphs and list items', () => {
    const nodes = markdownToNodes('Set **max** now\n\n- run `pnpm dev`')

    expect(nodes).toEqual([
      ['p', {}, 'Set ', ['strong', {}, 'max'], ' now'],
      ['ul', {}, ['li', {}, 'run ', ['code', {}, 'pnpm dev']]],
    ])
  })

  it('splits paragraphs and bullet lists', () => {
    const nodes = markdownToNodes('Intro line\n\n- first\n- second')

    expect(tags(nodes)).toEqual(['p', 'ul'])
  })
})

describe('buildLandingBody', () => {
  it('expands data-driven components from the frontmatter', () => {
    const body = buildLandingBody(createPage([
      ['home-bubble', { 'role': 'user', ':heading': 'true', 'id': 'faq' }, 'More?'],
      ['home-bubble', { role: 'assistant' }, ['home-faq', {}]],
      ['home-bubble', { role: 'assistant' }, ['home-features', { set: 'steps' }]],
      ['home-bubble', { role: 'assistant' }, ['home-comparison', {}]],
    ]), [])
    const serialized = JSON.stringify(body)

    expect(serialized).toContain('Can I start for free?')
    expect(serialized).toContain('1. Sign up')
    expect(serialized).toContain('"table"')
    expect(serialized).toContain('$20/mo')
    expect(serialized).not.toContain('home-')
  })

  it('keeps assistant prose and drops filler user bubbles', () => {
    const body = buildLandingBody(createPage([
      ['home-bubble', { role: 'user' }, 'Show me what it looks like.'],
      ['home-bubble', { role: 'assistant' }, ['p', {}, 'Real prose.']],
    ]), [])
    const serialized = JSON.stringify(body)

    expect(serialized).toContain('Real prose.')
    expect(serialized).not.toContain('Show me what it looks like.')
  })

  it('drops bubbles that only show live data and their orphan heading', () => {
    const body = buildLandingBody(createPage([
      ['home-bubble', { 'role': 'user', ':heading': 'true' }, 'How many users?'],
      ['home-bubble', { role: 'assistant' }, ['p', {}, 'Growing.'], ['home-stats', {}]],
      ['home-bubble', { 'role': 'user', ':heading': 'true' }, 'What can I do?'],
      ['home-bubble', { role: 'assistant' }, ['home-features', { set: 'features' }]],
    ]), [])
    const serialized = JSON.stringify(body)

    expect(serialized).not.toContain('How many users?')
    expect(serialized).not.toContain('Growing.')
    expect(serialized).toContain('What can I do?')
    expect(serialized).toContain('Web search')
  })

  it('links the get-started targets, key guides and legal pages', () => {
    const body = buildLandingBody(createPage([]), [
      { title: 'Claude key', path: '/guides/claude-api-key' },
    ])
    const serialized = JSON.stringify(body)

    expect(serialized).toContain('/signup')
    expect(serialized).toContain('/guides/gemini-api-key')
    expect(serialized).toContain('/guides/claude-api-key')
    expect(serialized).toContain('/byok')
    expect(serialized).toContain('/memory')
    expect(serialized).toContain('/privacy-policy')
  })
})

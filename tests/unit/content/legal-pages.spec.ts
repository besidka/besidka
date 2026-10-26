import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import { describe, expect, it } from 'vitest'

interface MarkdownNode {
  tag?: string
  props?: Record<string, unknown>
  children?: MarkdownNode[]
}

const LEGAL_PAGES = [
  'privacy-policy',
  'terms-of-use',
  'cookie-policy',
] as const

const ANCHORS_LINKED_FROM_THE_APP: Record<string, string[]> = {
  'privacy-policy': [
    'sensitive-information-in-your-chats',
    'transfers-outside-the-eu',
    'memory',
    'getting-a-copy-of-your-data',
  ],
  'terms-of-use': [],
  'cookie-policy': [],
}

const FORBIDDEN_PUBLIC_TEXT = [
  /engineer-drafted/i,
  /lawyer-reviewed/i,
  /\[OWNER/,
  /\[U\]|\[J\]|\[I\]|\[C\]|\[E\]/,
  /\{\{\s*privacyEmail\s*\}\}/,
  /\bparas?\.?\s+\d/i,
  /\bExample \d+/,
  /I have no lawful basis/i,
  /Profile → Privacy(?! &)/,
]

function readSource(slug: string): string {
  return readFileSync(
    join(process.cwd(), `content/legal/${slug}.md`),
    'utf-8',
  )
}

function collectHeadingIds(node: MarkdownNode, ids: Set<string>) {
  if (node.tag && /^h[1-6]$/.test(node.tag) && node.props?.id) {
    ids.add(String(node.props.id))
  }

  for (const child of node.children ?? []) {
    collectHeadingIds(child, ids)
  }
}

describe.each(LEGAL_PAGES)('content/legal/%s.md', (slug) => {
  it('parses with string metadata and a current updatedAt', async () => {
    const parsed = await parseMarkdown(readSource(slug), { highlight: false })
    const data = parsed.data as Record<string, unknown>

    expect(typeof data.title).toBe('string')
    expect(typeof data.description).toBe('string')

    if ('summary' in data) {
      expect(typeof data.summary).toBe('string')
    }

    expect(String(data.updatedAt)).toContain('2026-10-26')
  })

  it('keeps every heading the app links to', async () => {
    const parsed = await parseMarkdown(readSource(slug), { highlight: false })
    const ids = new Set<string>()

    collectHeadingIds(parsed.body as MarkdownNode, ids)

    for (const anchor of ANCHORS_LINKED_FROM_THE_APP[slug] ?? []) {
      expect(ids, `#${anchor} is missing`).toContain(anchor)
    }
  })

  it('publishes no internal drafting markers or case-law citations', () => {
    const source = readSource(slug)

    for (const pattern of FORBIDDEN_PUBLIC_TEXT) {
      expect(source).not.toMatch(pattern)
    }
  })
})

describe('legal page substance', () => {
  it('states the explicit-consent basis and where to withdraw it', () => {
    const source = readSource('privacy-policy')

    expect(source).toContain('Art. 9(2)(a)')
    expect(source).toContain('Profile → Security → Privacy & consent')
    expect(source).toContain(':privacy-email-link{}')
  })

  it('names the transfer countries and the Art. 49 consent', () => {
    const source = readSource('privacy-policy')

    expect(source).toContain('China')
    expect(source).toContain('Singapore')
    expect(source).toContain('Art. 49(1)(a)')
  })

  it('replaces the ban on sensitive data in the Terms of Use', () => {
    const source = readSource('terms-of-use')

    expect(source).not.toContain('Do not submit special category')
    expect(source).toContain('## Sensitive information')
  })

  it('lists the browser storage added with project knowledge', () => {
    const source = readSource('cookie-policy')

    expect(source).toContain('`besidka-knowledge`')
    expect(source).toContain('`knowledge-folders:<project id>`')
    expect(source).toContain('`knowledge-cache-info-seen`')
  })
})

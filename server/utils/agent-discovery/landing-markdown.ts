export type MinimarkNode
  = | string
    | [string, Record<string, unknown>, ...MinimarkNode[]]

interface LabeledLink {
  label: string
  href: string
}

interface TitledItem {
  title: string
  body: string
}

interface FaqItem {
  question: string
  answer: string
}

interface CarouselSlide {
  caption: string
}

interface ComparisonSource {
  label: string
  url: string
}

interface ComparisonRow {
  label: string
  values: string[]
}

interface Comparison {
  caption?: string
  columns: string[]
  rows: ComparisonRow[]
  note?: string
  priceDate?: string
  sources?: ComparisonSource[]
}

export interface LandingPage {
  hero?: {
    primaryCta?: LabeledLink
    secondaryCta?: LabeledLink
    guideLink?: LabeledLink
  }
  carousel?: CarouselSlide[]
  steps?: TitledItem[]
  features?: TitledItem[]
  benefits?: TitledItem[]
  faqs?: FaqItem[]
  comparison?: Comparison
  body: {
    value: MinimarkNode[]
  }
}

export interface GuideLink {
  title: string
  path: string
}

const INLINE_LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g
const LIST_ITEM_PATTERN = /^[-*]\s+/
const ELEMENT_TAG_INDEX = 0
const ELEMENT_PROPS_INDEX = 1
const ELEMENT_CHILDREN_START_INDEX = 2

const LIVE_DATA_COMPONENTS = new Set([
  'home-stats',
  'home-video',
  'home-testimonials',
])

const DROPPED_COMPONENTS = new Set([
  ...LIVE_DATA_COMPONENTS,
  'home-stars',
])

const STATIC_LINKS: GuideLink[] = [
  { title: 'BYOK guide: cost and key storage', path: '/byok' },
  { title: 'How memory works', path: '/memory' },
  { title: 'Privacy Policy', path: '/privacy-policy' },
  { title: 'Terms of Use', path: '/terms-of-use' },
  { title: 'Cookie Policy', path: '/cookie-policy' },
]

export function parseInlineMarkdown(text: string): MinimarkNode[] {
  const nodes: MinimarkNode[] = []
  let cursor = 0

  for (const match of text.matchAll(INLINE_LINK_PATTERN)) {
    const [fullMatch, label, href] = match as unknown as [
      string,
      string,
      string,
    ]
    const start = match.index ?? 0

    if (start > cursor) {
      nodes.push(text.slice(cursor, start))
    }

    nodes.push(['a', { href }, label])
    cursor = start + fullMatch.length
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return nodes
}

export function markdownToNodes(markdown: string): MinimarkNode[] {
  const nodes: MinimarkNode[] = []

  for (const block of markdown.split(/\n{2,}/)) {
    const lines = block.split('\n').map((line) => {
      return line.trim()
    }).filter(Boolean)

    if (!lines.length) {
      continue
    }

    const paragraphLines = lines.filter((line) => {
      return !LIST_ITEM_PATTERN.test(line)
    })
    const itemLines = lines.filter((line) => {
      return LIST_ITEM_PATTERN.test(line)
    })

    if (paragraphLines.length) {
      nodes.push([
        'p',
        {},
        ...parseInlineMarkdown(paragraphLines.join(' ')),
      ])
    }

    if (itemLines.length) {
      nodes.push([
        'ul',
        {},
        ...itemLines.map((line): MinimarkNode => {
          return [
            'li',
            {},
            ...parseInlineMarkdown(line.replace(LIST_ITEM_PATTERN, '')),
          ]
        }),
      ])
    }
  }

  return nodes
}

function listOfTitledItems(
  items: TitledItem[] | undefined,
  tag: 'ul' | 'ol',
): MinimarkNode[] {
  if (!items?.length) {
    return []
  }

  return [[
    tag,
    {},
    ...items.map((item): MinimarkNode => {
      return [
        'li',
        {},
        ['strong', {}, item.title],
        `: ${item.body}`,
      ]
    }),
  ]]
}

function faqNodes(faqs: FaqItem[] | undefined): MinimarkNode[] {
  return (faqs ?? []).flatMap((faq): MinimarkNode[] => {
    return [
      ['h3', {}, faq.question],
      ...markdownToNodes(faq.answer),
    ]
  })
}

function carouselNodes(slides: CarouselSlide[] | undefined): MinimarkNode[] {
  if (!slides?.length) {
    return []
  }

  return [[
    'ul',
    {},
    ...slides.map((slide): MinimarkNode => {
      return ['li', {}, slide.caption]
    }),
  ]]
}

function tableRow(cells: string[], cellTag: 'th' | 'td'): MinimarkNode {
  return [
    'tr',
    {},
    ...cells.map((cell): MinimarkNode => {
      return [cellTag, {}, cell]
    }),
  ]
}

function comparisonNodes(comparison: Comparison | undefined): MinimarkNode[] {
  if (!comparison?.columns.length || !comparison.rows.length) {
    return []
  }

  const nodes: MinimarkNode[] = [[
    'table',
    {},
    [
      'thead',
      {},
      tableRow(['', ...comparison.columns], 'th'),
    ],
    [
      'tbody',
      {},
      ...comparison.rows.map((row) => {
        return tableRow([row.label, ...row.values], 'td')
      }),
    ],
  ]]

  if (comparison.note) {
    nodes.push(['p', {}, comparison.note])
  }

  if (comparison.priceDate) {
    nodes.push(['p', {}, `Prices checked ${comparison.priceDate}.`])
  }

  if (comparison.sources?.length) {
    nodes.push([
      'p',
      {},
      'Sources: ',
      ...comparison.sources.flatMap((source, index): MinimarkNode[] => {
        const link: MinimarkNode = ['a', { href: source.url }, source.label]

        return index === 0 ? [link] : [', ', link]
      }),
    ])
  }

  return nodes
}

function callToActionNodes(props: Record<string, unknown>): MinimarkNode[] {
  const links = [props.primary, props.secondary].filter((link) => {
    return typeof link === 'object' && link !== null
  }) as LabeledLink[]

  if (!links.length) {
    return []
  }

  return [[
    'ul',
    {},
    ...links.map((link): MinimarkNode => {
      return ['li', {}, ['a', { href: link.href }, link.label]]
    }),
  ]]
}

function expandComponent(
  tag: string,
  props: Record<string, unknown>,
  page: LandingPage,
): MinimarkNode[] {
  if (DROPPED_COMPONENTS.has(tag)) {
    return []
  }

  switch (tag) {
    case 'home-features': {
      const set = (props.set as string | undefined) ?? 'features'

      if (set === 'steps') {
        return listOfTitledItems(page.steps, 'ul')
      }

      return listOfTitledItems(
        set === 'benefits' ? page.benefits : page.features,
        'ul',
      )
    }
    case 'home-faq':
      return faqNodes(page.faqs)
    case 'home-carousel':
      return carouselNodes(page.carousel)
    case 'home-comparison':
      return comparisonNodes(page.comparison)
    case 'home-cta':
      return callToActionNodes(props)
    default:
      return []
  }
}

function isElement(node: MinimarkNode): node is Exclude<MinimarkNode, string> {
  return Array.isArray(node)
}

function textOf(node: MinimarkNode): string {
  if (!isElement(node)) {
    return node
  }

  return node.slice(ELEMENT_CHILDREN_START_INDEX).map((child) => {
    return textOf(child as MinimarkNode)
  }).join('')
}

function unwrapBubble(
  bubble: Exclude<MinimarkNode, string>,
  page: LandingPage,
): MinimarkNode[] {
  const props = bubble[ELEMENT_PROPS_INDEX]
  const children = bubble.slice(ELEMENT_CHILDREN_START_INDEX) as MinimarkNode[]
  const hasLiveDataComponent = children.some((child) => {
    return isElement(child)
      && LIVE_DATA_COMPONENTS.has(child[ELEMENT_TAG_INDEX])
  })

  if (hasLiveDataComponent) {
    return []
  }

  if (props.role === 'user') {
    const isHeading = props[':heading'] === 'true' || props.heading === true

    return isHeading ? [['h2', { id: props.id }, textOf(bubble)]] : []
  }

  return children.flatMap((child): MinimarkNode[] => {
    if (!isElement(child)) {
      return [child]
    }

    const tag = child[ELEMENT_TAG_INDEX]

    if (tag.startsWith('home-')) {
      return expandComponent(tag, child[ELEMENT_PROPS_INDEX], page)
    }

    return [child]
  })
}

function dropEmptySections(nodes: MinimarkNode[]): MinimarkNode[] {
  return nodes.filter((node, index) => {
    if (!isElement(node) || node[ELEMENT_TAG_INDEX] !== 'h2') {
      return true
    }

    const nextNode = nodes[index + 1]

    if (nextNode === undefined) {
      return false
    }

    return !(isElement(nextNode) && nextNode[ELEMENT_TAG_INDEX] === 'h2')
  })
}

function linkListNodes(
  heading: string,
  links: GuideLink[],
): MinimarkNode[] {
  if (!links.length) {
    return []
  }

  return [
    ['h2', {}, heading],
    [
      'ul',
      {},
      ...links.map((link): MinimarkNode => {
        return ['li', {}, ['a', { href: link.path }, link.title]]
      }),
    ],
  ]
}

export function buildLandingBody(
  page: LandingPage,
  keyGuides: GuideLink[],
): MinimarkNode[] {
  const expandedBody = page.body.value.flatMap((node): MinimarkNode[] => {
    if (!isElement(node)) {
      return [node]
    }

    if (node[ELEMENT_TAG_INDEX] === 'home-bubble') {
      return unwrapBubble(node, page)
    }

    if (node[ELEMENT_TAG_INDEX].startsWith('home-')) {
      return expandComponent(
        node[ELEMENT_TAG_INDEX],
        node[ELEMENT_PROPS_INDEX],
        page,
      )
    }

    return [node]
  })
  const body = dropEmptySections(expandedBody)

  const getStartedLinks = [
    page.hero?.primaryCta,
    page.hero?.guideLink,
    page.hero?.secondaryCta,
  ].filter((link): link is LabeledLink => {
    return Boolean(link)
  }).map((link) => {
    return { title: link.label, path: link.href }
  })

  return [
    ...linkListNodes('Get started', getStartedLinks),
    ...body,
    ...linkListNodes('API key guides', keyGuides),
    ...linkListNodes('More from Besidka', STATIC_LINKS),
  ]
}

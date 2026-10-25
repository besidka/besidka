import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import { describe, expect, it } from 'vitest'

type Frontmatter = Record<string, unknown>

const CONTENT_FILES = [
  'content/index.md',
  ...readdirSync(join(process.cwd(), 'content/guides'))
    .filter(fileName => fileName.endsWith('.md'))
    .map(fileName => `content/guides/${fileName}`),
  ...readdirSync(join(process.cwd(), 'content/legal'))
    .filter(fileName => fileName.endsWith('.md'))
    .map(fileName => `content/legal/${fileName}`),
  ...readdirSync(join(process.cwd(), 'content/key-guides'))
    .filter(fileName => fileName.endsWith('.md'))
    .map(fileName => `content/key-guides/${fileName}`),
]

const TOP_LEVEL_STRING_FIELDS = ['title', 'description', 'summary']
const LANDING_ITEM_COLLECTIONS = ['benefits', 'features', 'steps']

async function readFrontmatter(relativePath: string): Promise<Frontmatter> {
  const source = readFileSync(join(process.cwd(), relativePath), 'utf-8')
  const parsed = await parseMarkdown(source, { highlight: false })

  return parsed.data as Frontmatter
}

function asRecord(value: unknown): Frontmatter {
  return (value ?? {}) as Frontmatter
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function expectString(value: unknown, path: string) {
  expect(
    typeof value,
    `${path} must be a string but YAML parsed it as ${JSON.stringify(value)}`,
  ).toBe('string')
}

describe('content frontmatter strings survive YAML parsing', () => {
  describe.each(CONTENT_FILES)('%s', (relativePath) => {
    it(
      'keeps title, description and summary as strings: an unquoted value '
      + 'containing a colon followed by a space is parsed by YAML as a '
      + 'nested mapping and renders as [object Object] in meta tags and '
      + 'JSON-LD',
      async () => {
        const data = await readFrontmatter(relativePath)

        for (const field of TOP_LEVEL_STRING_FIELDS) {
          if (field in data) {
            expectString(data[field], `${relativePath} ${field}`)
          }
        }
      },
    )
  })

  describe.each(
    CONTENT_FILES.filter(path => path.startsWith('content/key-guides/')),
  )('%s faq', (relativePath) => {
    it(
      'keeps every FAQ question and answer a string, because an unquoted '
      + 'colon-space turns an answer into a mapping and breaks the '
      + 'accordion',
      async () => {
        const data = await readFrontmatter(relativePath)

        asArray(data.faq).forEach((faq, faqIndex) => {
          expectString(asRecord(faq).question, `faq[${faqIndex}].question`)
          expectString(asRecord(faq).answer, `faq[${faqIndex}].answer`)
        })
      },
    )
  })

  describe('content/index.md landing sections', () => {
    it(
      'keeps hero text and call-to-action labels as strings instead of '
      + 'nested mappings created by an unquoted colon-space',
      async () => {
        const data = await readFrontmatter('content/index.md')
        const hero = asRecord(data.hero)

        for (const field of ['eyebrow', 'headline', 'subheadline']) {
          expectString(hero[field], `hero.${field}`)
        }

        for (const field of ['primaryCta', 'secondaryCta']) {
          expectString(
            asRecord(hero[field]).label,
            `hero.${field}.label`,
          )
        }
      },
    )

    it(
      'keeps every FAQ question and answer a string, because an answer that '
      + 'YAML turned into an object emits an invalid FAQPage JSON-LD and a '
      + 'broken visible answer',
      async () => {
        const data = await readFrontmatter('content/index.md')
        const faqs = asArray(data.faqs)

        expect(faqs.length).toBeGreaterThan(0)

        faqs.forEach((faq, faqIndex) => {
          expectString(asRecord(faq).question, `faqs[${faqIndex}].question`)
          expectString(asRecord(faq).answer, `faqs[${faqIndex}].answer`)
        })
      },
    )

    it.each(LANDING_ITEM_COLLECTIONS)(
      'keeps every %s title and body a string rather than a colon-split '
      + 'mapping',
      async (collection) => {
        const data = await readFrontmatter('content/index.md')
        const items = asArray(data[collection])

        expect(items.length).toBeGreaterThan(0)

        items.forEach((item, itemIndex) => {
          expectString(
            asRecord(item).title,
            `${collection}[${itemIndex}].title`,
          )
          expectString(
            asRecord(item).body,
            `${collection}[${itemIndex}].body`,
          )
        })
      },
    )

    it(
      'keeps the comparison caption, note, columns and every row label and '
      + 'value a string; yes and no stay strings under YAML 1.2',
      async () => {
        const data = await readFrontmatter('content/index.md')
        const comparison = asRecord(data.comparison)

        expectString(comparison.caption, 'comparison.caption')

        if ('note' in comparison) {
          expectString(comparison.note, 'comparison.note')
        }

        const columns = asArray(comparison.columns)
        const rows = asArray(comparison.rows)

        expect(columns.length).toBeGreaterThan(0)
        expect(rows.length).toBeGreaterThan(0)

        columns.forEach((column, columnIndex) => {
          expectString(column, `comparison.columns[${columnIndex}]`)
        })

        rows.forEach((row, rowIndex) => {
          expectString(
            asRecord(row).label,
            `comparison.rows[${rowIndex}].label`,
          )

          const values = asArray(asRecord(row).values)

          expect(values).toHaveLength(columns.length)

          values.forEach((value, valueIndex) => {
            expectString(
              value,
              `comparison.rows[${rowIndex}].values[${valueIndex}]`,
            )
          })
        })
      },
    )
  })
})

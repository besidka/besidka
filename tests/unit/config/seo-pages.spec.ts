import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const NOINDEX_NOFOLLOW_PATTERN
  = /robots\s*:\s*['"]noindex\s*,\s*nofollow['"]/

function readPageSource(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8')
}

describe('auth pages set a crawlable noindex meta', () => {
  it(
    'sets robots: noindex, nofollow on signin.vue, since /signin was '
    + 'deliberately removed from robots.disallow — a Disallow-ed URL is '
    + 'never fetched, so this useSeoMeta line is the only remaining guard '
    + 'against indexing',
    () => {
      const source = readPageSource('app/pages/(auth)/signin.vue')

      expect(source).toMatch(NOINDEX_NOFOLLOW_PATTERN)
    },
  )

  it(
    'sets robots: noindex, nofollow on signup.vue, since /signup was '
    + 'deliberately removed from robots.disallow — a Disallow-ed URL is '
    + 'never fetched, so this useSeoMeta line is the only remaining guard '
    + 'against indexing',
    () => {
      const source = readPageSource('app/pages/(auth)/signup.vue')

      expect(source).toMatch(NOINDEX_NOFOLLOW_PATTERN)
    },
  )

  it(
    'sets robots: noindex, nofollow on reset-password.vue, since '
    + '/reset-password was deliberately removed from robots.disallow — '
    + 'a Disallow-ed URL is never fetched, so this useSeoMeta line is the '
    + 'only remaining guard against indexing',
    () => {
      const source = readPageSource('app/pages/(auth)/reset-password.vue')

      expect(source).toMatch(NOINDEX_NOFOLLOW_PATTERN)
    },
  )

  it(
    'sets robots: noindex, nofollow on new-password.vue as a second '
    + 'layer of defense — the route is still disallowed in robots.txt, '
    + 'but this test guards against that disallow rule being removed '
    + 'without this meta being added',
    () => {
      const source = readPageSource('app/pages/(auth)/new-password.vue')

      expect(source).toMatch(NOINDEX_NOFOLLOW_PATTERN)
    },
  )

  it(
    'sets robots: noindex, nofollow on 2fa.vue as a second layer of '
    + 'defense — the route is still disallowed in robots.txt, but this '
    + 'test guards against that disallow rule being removed without '
    + 'this meta being added',
    () => {
      const source = readPageSource('app/pages/(auth)/2fa.vue')

      expect(source).toMatch(NOINDEX_NOFOLLOW_PATTERN)
    },
  )
})

const LEGAL_DOCUMENTS = [
  'privacy-policy',
  'terms-of-use',
  'cookie-policy',
] as const

function readFrontmatter(slug: string): string {
  const source = readPageSource(`content/legal/${slug}.md`)
  const frontmatterMatch = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)

  return frontmatterMatch?.[1] ?? ''
}

function readFrontmatterValue(slug: string, key: string): string {
  const valueMatch = readFrontmatter(slug).match(
    new RegExp(`^${key}:\\s*(.+)$`, 'm'),
  )

  return (valueMatch?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
}

describe('useLegalDocument', () => {
  it(
    'derives the collection path and the payload key from one route slug, so '
    + 'a renamed document cannot leave a page querying a path that no longer '
    + 'exists while still rendering its hardcoded fallback title',
    () => {
      const source = readPageSource('app/composables/legal-document.ts')

      expect(source).toContain('queryCollection(\'legal\')')
      expect(source).toMatch(/path\(`\/legal\/\$\{slug\}`\)/)
      expect(source).toMatch(/`legal-\$\{slug\}`/)
    },
  )
})

describe.each(LEGAL_DOCUMENTS)(
  'legal page %s is content-driven and carries its own SEO meta',
  (slug) => {
    it(
      'fetches through useLegalDocument, since the page renders nothing and '
      + 'silently falls back to a hardcoded title when the path no longer '
      + 'matches a content file',
      () => {
        const source = readPageSource(`app/pages/(legal)/${slug}.vue`)

        expect(source).toContain('useLegalDocument()')
        expect(source).not.toContain('queryCollection(')
      },
    )

    it(
      'sources both title and description from the content document, so the '
      + 'frontmatter stays the single source of truth for this page\'s meta',
      () => {
        const source = readPageSource(`app/pages/(legal)/${slug}.vue`)

        expect(source).toMatch(/title\s*:\s*\(\)\s*=>\s*page\.value\?\.title/)
        expect(source).toMatch(
          /description\s*:\s*\(\)\s*=>\s*page\.value\?\.description/,
        )
      },
    )

    it(
      'has a non-empty description in its content frontmatter, since a '
      + 'missing one silently falls back to the global description and '
      + 'reintroduces duplicate meta descriptions across pages',
      () => {
        expect(readFrontmatterValue(slug, 'description')).toBeTruthy()
      },
    )

    it(
      'has a non-empty title and updatedAt in its content frontmatter — '
      + 'updatedAt is rendered to users and used as the sitemap lastmod',
      () => {
        expect(readFrontmatterValue(slug, 'title')).toBeTruthy()
        expect(readFrontmatterValue(slug, 'updatedAt')).toMatch(
          /^\d{4}-\d{2}-\d{2}$/,
        )
      },
    )
  },
)

describe('BYOK guide page', () => {
  function readGuideFrontmatterValue(key: string): string {
    const source = readPageSource('content/guides/byok.md')
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
    const valueMatch = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))

    return (valueMatch?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
  }

  it(
    'is content-driven from the guides collection and sources title and '
    + 'description from it, so the frontmatter stays the single source of '
    + 'truth for the page meta',
    () => {
      const source = readPageSource('app/pages/byok.vue')

      expect(source).toContain('queryCollection(\'guides\')')
      expect(source).toContain('.path(\'/guides/byok\')')
      expect(source).toMatch(/description\s*:\s*\(\)\s*=>\s*description\.value/)
    },
  )

  it(
    'stays indexable: it must not set its own noindex and must not be '
    + 'excluded from the sitemap or disallowed in robots',
    () => {
      const source = readPageSource('app/pages/byok.vue')

      expect(source).not.toMatch(/noindex/)

      const nuxtConfigSource = readPageSource('nuxt.config.ts')

      expect(nuxtConfigSource).not.toMatch(/['"]\/byok/)
    },
  )

  it(
    'emits TechArticle JSON-LD through the shared landing graph helper '
    + 'instead of declaring its own Organization',
    () => {
      const source = readPageSource('app/pages/byok.vue')

      expect(source).toContain('buildGuidePageLd(')
      expect(source).not.toContain('Organization')
    },
  )

  it('has a title, description and ISO updatedAt in its frontmatter', () => {
    expect(readGuideFrontmatterValue('title')).toBeTruthy()
    expect(readGuideFrontmatterValue('description')).toBeTruthy()
    expect(readGuideFrontmatterValue('updatedAt')).toMatch(
      /^\d{4}-\d{2}-\d{2}$/,
    )
  })

  it('is linked from the home page body', () => {
    expect(readPageSource('content/index.md')).toContain('](/byok)')
  })
})

describe('memory explainer page', () => {
  function readMemoryGuide(): string {
    return readPageSource('content/guides/memory.md')
  }

  function readMemoryFrontmatter(): string {
    return readMemoryGuide().match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  }

  function readFrontmatterValue(key: string): string {
    const valueMatch = readMemoryFrontmatter().match(
      new RegExp(`^${key}:\\s*(.+)$`, 'm'),
    )

    return (valueMatch?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
  }

  function readQuestionHeadings(): string[] {
    return [...readMemoryGuide().matchAll(/^## (.+\?)$/gm)].map((match) => {
      return match[1]!
    })
  }

  it(
    'is content-driven from the guides collection and sources title and '
    + 'description from it, so the frontmatter stays the single source of '
    + 'truth for the page meta',
    () => {
      const source = readPageSource('app/pages/memory.vue')

      expect(source).toContain('queryCollection(\'guides\')')
      expect(source).toContain('.path(\'/guides/memory\')')
      expect(source).toMatch(/description\s*:\s*\(\)\s*=>\s*description\.value/)
    },
  )

  it(
    'stays indexable: it must not set its own noindex, canonical or og:url '
    + 'and must not be excluded from the sitemap or disallowed in robots',
    () => {
      const source = readPageSource('app/pages/memory.vue')

      expect(source).not.toMatch(/noindex/)
      expect(source).not.toMatch(/canonical:/)
      expect(source).not.toMatch(/ogUrl/)

      const nuxtConfigSource = readPageSource('nuxt.config.ts')

      expect(nuxtConfigSource).not.toMatch(/['"]\/memory/)
    },
  )

  it(
    'emits TechArticle JSON-LD through the shared landing graph helper and '
    + 'no FAQPage markup, because FAQ rich results were retired',
    () => {
      const source = readPageSource('app/pages/memory.vue')

      expect(source).toContain('buildKeyGuidePageLd(')
      expect(source).not.toContain('Organization')
      expect(source).not.toContain('FAQPage')
    },
  )

  it('has a title, description and ISO updatedAt in its frontmatter', () => {
    expect(readFrontmatterValue('title')).toBeTruthy()
    expect(readFrontmatterValue('description')).toBeTruthy()
    expect(readFrontmatterValue('updatedAt')).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it(
    'writes the FAQ as question headings in the body instead of a '
    + 'frontmatter faq field',
    () => {
      const questions = readQuestionHeadings()

      expect(questions.length).toBeGreaterThanOrEqual(8)
      expect(questions.length).toBeLessThanOrEqual(12)
      expect(readMemoryFrontmatter()).not.toMatch(/^faq:/m)
    },
  )

  it('links the TypeSafe AI key guide and the privacy policy', () => {
    const source = readMemoryGuide()

    expect(source).toContain('](/guides/typesafe-ai-api-key)')
    expect(source).toContain('](/privacy-policy#memory)')
  })

  it(
    'only ships a video block once its poster file exists, so the page '
    + 'never points at media that is not in the repository',
    () => {
      const posterMatch = readMemoryFrontmatter()
        .match(/^\s+poster:\s*(\S+)$/m)

      if (!posterMatch) {
        return
      }

      const posterPath = posterMatch[1]!.replace(/\?.*$/, '')

      expect(() => {
        readPageSource(join('public', posterPath))
      }).not.toThrow()
    },
  )

  it('reuses the shared video schema in the guides collection', () => {
    const source = readPageSource('content.config.ts')

    expect(source).toMatch(/video:\s*guideVideoSchema/)
  })

  it('is linked from the home page, the footer and the profile page', () => {
    expect(readPageSource('content/index.md')).toContain('](/memory)')
    expect(readPageSource('app/components/LandingFooter.vue'))
      .toContain('to="/memory"')
    expect(readPageSource('app/pages/profile/memory.vue'))
      .toContain('to="/memory"')
  })
})

describe('key guide pages', () => {
  it(
    'serves /guides/<slug> from the keyGuides collection and 404s when the '
    + 'entry is missing',
    () => {
      const source = readPageSource('app/pages/guides/[slug].vue')

      expect(source).toContain('queryCollection(\'keyGuides\')')
      expect(source).toMatch(/\.path\(`\/guides\/\$\{slug\.value\}`\)/)
      expect(source).toMatch(/createError\(\{\s*statusCode:\s*404/)
    },
  )

  it(
    'stays indexable: the page must not set its own noindex, and /guides/ '
    + 'must not be disallowed in robots or excluded from the sitemap',
    () => {
      const source = readPageSource('app/pages/guides/[slug].vue')

      expect(source).not.toMatch(/noindex/)
      expect(source).not.toMatch(/nofollow/)

      const nuxtConfigSource = readPageSource('nuxt.config.ts')

      expect(nuxtConfigSource).not.toMatch(/['"]\/guides/)
      expect(nuxtConfigSource).not.toMatch(/['"]\/key-guides/)
    },
  )

  it(
    'emits its structured data through the shared builder instead of '
    + 'declaring its own Organization',
    () => {
      const source = readPageSource('app/pages/guides/[slug].vue')

      expect(source).toContain('buildKeyGuidePageLd(')
      expect(source).not.toContain('Organization')
    },
  )

  it(
    'maps the content folder to the public URL in the collection itself, so '
    + 'the sitemap lists /guides/<slug> and never /key-guides/<slug>',
    () => {
      const source = readPageSource('content.config.ts')

      expect(source).toContain('include: \'key-guides/*.md\'')
      expect(source).toContain('prefix: \'/guides\'')
      expect(source).toContain('sitemap: defineSitemapSchema()')
    },
  )
})

describe('homepage title and H1 brand-entity association', () => {
  function readHomepageFrontmatter(): string {
    const source = readPageSource('content/index.md')

    return source.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
  }

  it(
    'keeps the brand adjacent to "BYOK" in the title: the page renders '
    + '"Besidka: <title>", so the frontmatter title must start with "BYOK" '
    + 'for the brand-entity association (docs/seo.md, "The brand-entity '
    + 'problem")',
    () => {
      expect(readHomepageFrontmatter()).toMatch(/^title: BYOK AI chat app/m)
    },
  )

  it(
    'keeps "Besidka" adjacent to "BYOK" in the H1 (hero headline) for the '
    + 'brand-entity association (docs/seo.md, "The brand-entity problem")',
    () => {
      expect(readHomepageFrontmatter()).toMatch(
        /^ {2}headline: ["']?Besidka: BYOK AI chat/m,
      )
    },
  )

  it(
    'joins the site name to the content title with "<siteName>: " in the '
    + 'page title, so the brand stays first and adjacent to the BYOK title '
    + 'chunk',
    () => {
      const source = readPageSource('app/pages/index.vue')

      expect(source).toContain('`${siteName}: ${chunk}`')
    },
  )

  it(
    'takes the Organization, WebSite and SoftwareApplication description '
    + 'from app config, not from the page meta description, so a call to '
    + 'action never becomes the entity description',
    () => {
      const source = readPageSource('app/pages/index.vue')

      expect(source).toMatch(/description:\s*entityDescription/)
      expect(source).toMatch(/\bentityDescription,\s*\n\s*faqs:/)
      expect(source).not.toMatch(/description:\s*description\.value,\s*\n\s*faqs:/)
    },
  )

  it('has no em dashes in the homepage content, per the copy rules', () => {
    expect(readPageSource('content/index.md')).not.toContain('\u2014')
  })
})

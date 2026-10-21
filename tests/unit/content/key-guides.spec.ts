import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMarkdown } from '@nuxtjs/mdc/runtime'
import { keyGuideSchema } from '../../../shared/utils/key-guide-schema'
import { providerMeta } from '../../../shared/utils/provider-meta'

const guidesDirectory = join(process.cwd(), 'content/key-guides')
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*-api-key\.md$/

const guideFiles = readdirSync(guidesDirectory).filter((fileName) => {
  return fileName.endsWith('.md')
})

async function readFrontmatter(
  fileName: string,
): Promise<Record<string, unknown>> {
  const source = readFileSync(join(guidesDirectory, fileName), 'utf8')
  const { data } = await parseMarkdown(source)

  return data as Record<string, unknown>
}

function validVideo(overrides: Record<string, unknown> = {}) {
  return {
    src: '/videos/key-guide-google.mp4',
    poster: '/key-guides/google.webp',
    duration: 'PT34S',
    uploadDate: '2026-10-20',
    ...overrides,
  }
}

function validGuide(): Record<string, unknown> {
  return {
    provider: 'google',
    description: 'Create a Gemini API key',
    updatedAt: '2026-10-20',
    keyUrl: 'https://aistudio.google.com/apikey',
    checkedAt: '2026-10-20',
    requirements: {
      card: false,
      sources: [{ label: 'Docs', url: 'https://ai.google.dev/docs' }],
    },
  }
}

describe('content/key-guides', () => {
  it('has at least one guide', () => {
    expect(guideFiles.length).toBeGreaterThan(0)
  })

  it('has at most one guide per provider', async () => {
    const providers = await Promise.all(guideFiles.map(async (fileName) => {
      return (await readFrontmatter(fileName)).provider
    }))

    expect(new Set(providers).size).toBe(providers.length)
  })

  for (const fileName of guideFiles) {
    describe(fileName, () => {
      it('uses a query-shaped <name>-api-key slug', () => {
        expect(fileName).toMatch(SLUG_PATTERN)
      })

      it('names a known provider id', async () => {
        const frontmatter = await readFrontmatter(fileName)

        expect(Object.hasOwn(providerMeta, String(frontmatter.provider)))
          .toBe(true)
      })

      it('parses against the keyGuides schema', async () => {
        const frontmatter = await readFrontmatter(fileName)
        const result = keyGuideSchema.safeParse(frontmatter)

        expect(
          result.success ? [] : result.error.issues,
          `${fileName} frontmatter issues`,
        ).toEqual([])
      })
    })
  }
})

describe('keyGuideSchema', () => {
  it('accepts a minimal valid guide', () => {
    expect(keyGuideSchema.safeParse(validGuide()).success).toBe(true)
  })

  it('accepts a guide with a complete video', () => {
    const result = keyGuideSchema.safeParse({
      ...validGuide(),
      video: validVideo(),
    })

    expect(result.success).toBe(true)
  })

  it.each([
    'http://example.com/keys',
    'javascript:alert(1)',
    '/relative/keys',
  ])('rejects keyUrl = %s', (keyUrl) => {
    const result = keyGuideSchema.safeParse({ ...validGuide(), keyUrl })

    expect(result.success).toBe(false)
  })

  it.each([
    ['src', '//evil.example/video.mp4'],
    ['src', '/\\evil.example/video.mp4'],
    ['src', 'http://example.com/video.mp4'],
    ['src', 'video.mp4'],
    ['poster', 'data:image/png;base64,AAAA'],
    ['poster', '//evil.example/poster.webp'],
    ['duration', '34'],
  ])('rejects video.%s = %s', (field, value) => {
    const result = keyGuideSchema.safeParse({
      ...validGuide(),
      video: validVideo({ [field]: value }),
    })

    expect(result.success).toBe(false)
  })

  it('rejects a non-https source url', () => {
    const result = keyGuideSchema.safeParse({
      ...validGuide(),
      requirements: {
        card: false,
        sources: [{ label: 'Docs', url: 'http://example.com' }],
      },
    })

    expect(result.success).toBe(false)
  })

  it.each([
    '2026-10-20',
    '2026-10-20T00:00:00+00:00',
    '2026-10-20T09:30:00+02:00',
    '2026-10-20T09:30:00Z',
  ])('accepts video.uploadDate = %s', (uploadDate) => {
    const result = keyGuideSchema.safeParse({
      ...validGuide(),
      video: validVideo({ uploadDate }),
    })

    expect(result.success).toBe(true)
  })

  it.each([
    '',
    'yesterday',
    '20/10/2026',
    '2026-10-20T00:00:00',
    '2026-10-20T00:00',
    '2026-10-20 00:00:00+00:00',
    '2026-02-30',
    '2026-10-20T00:00:00+0000',
  ])('rejects video.uploadDate = %j', (uploadDate) => {
    const result = keyGuideSchema.safeParse({
      ...validGuide(),
      video: validVideo({ uploadDate }),
    })

    expect(result.success).toBe(false)
  })

  it.each([
    '/videos/key-guide-google.mp4',
    'https://cdn.example.com/key-guide-google.mp4',
  ])('accepts the video url %s', (src) => {
    const result = keyGuideSchema.safeParse({
      ...validGuide(),
      video: validVideo({ src }),
    })

    expect(result.success).toBe(true)
  })

  it('rejects an unknown provider id', () => {
    const result = keyGuideSchema.safeParse({
      ...validGuide(),
      provider: 'not-a-provider',
    })

    expect(result.success).toBe(false)
  })

  it('accepts video markers and defaults them to an empty list', () => {
    const withMarkers = keyGuideSchema.safeParse({
      ...validGuide(),
      video: validVideo({
        markers: [
          { time: '0:00', label: 'Start' },
          { time: '1:05', label: 'Next' },
        ],
      }),
    })
    const withoutMarkers = keyGuideSchema.parse({
      ...validGuide(),
      video: validVideo(),
    })

    expect(withMarkers.success).toBe(true)
    expect(withoutMarkers.video?.markers).toEqual([])
  })

  it.each(['12', '0:75', 'soon', '0:3.5'])(
    'rejects the marker timecode %s',
    (time) => {
      const result = keyGuideSchema.safeParse({
        ...validGuide(),
        video: validVideo({ markers: [{ time, label: 'Bad' }] }),
      })

      expect(result.success).toBe(false)
    },
  )
})

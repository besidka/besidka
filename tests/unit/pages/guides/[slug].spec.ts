import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { reactive } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GuidePage from '../../../../app/pages/guides/[slug].vue'

const mocks = vi.hoisted(() => ({
  guide: null as Record<string, unknown> | null,
  queryCollection: vi.fn(),
  path: vi.fn(),
}))

mockNuxtImport('queryCollection', () => mocks.queryCollection)

mockComponent('LandingVideoPlayer', () => {
  return {
    name: 'LandingVideoPlayer',
    props: [
      'src',
      'poster',
      'caption',
      'captions',
      'markers',
      'guideProvider',
    ],
    template: '<div data-testid="video-player" />',
  }
})

const mockRoute = reactive<{
  query: Record<string, unknown>
  params: Record<string, unknown>
  path: string
}>({
  query: {},
  params: { slug: 'gemini-api-key' },
  path: '/guides/gemini-api-key',
})

mockNuxtImport('useRoute', () => {
  return () => mockRoute
})

const GUIDE = {
  path: '/guides/gemini-api-key',
  title: 'How to get a Gemini API key',
  provider: 'google',
  description: 'Create a free Gemini API key in Google AI Studio.',
  updatedAt: '2026-10-20',
  checkedAt: '2026-10-19',
  keyUrl: 'https://aistudio.google.com/app/apikey',
  requirements: {
    card: false,
    minimumTopUp: '$5',
    freeTier: 'Generous free quota',
    sources: [
      { label: 'Pricing page', url: 'https://ai.google.dev/pricing' },
    ],
  },
}

function mountPage(options: { showClientOnlyFallback?: boolean } = {}) {
  return mountSuspended(GuidePage, {
    global: {
      stubs: {
        ...(options.showClientOnlyFallback
          ? { ClientOnly: { template: '<slot name="fallback" />' } }
          : {}),
        ContentRenderer: { template: '<div data-testid="body" />' },
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  })
}

describe('key guide page', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    vi.stubGlobal('useSeoMeta', vi.fn())
    clearNuxtData()
    mockRoute.params = { slug: 'gemini-api-key' }
    mocks.guide = { ...GUIDE }
    mocks.path.mockReset()
    mocks.queryCollection.mockReset()
    mocks.queryCollection.mockImplementation(() => {
      return {
        path: (path: string) => {
          mocks.path(path)

          return { first: async () => mocks.guide }
        },
      }
    })
  })

  it('queries the keyGuides collection by the public path', async () => {
    await mountPage()

    expect(mocks.queryCollection).toHaveBeenCalledWith('keyGuides')
    expect(mocks.path).toHaveBeenCalledWith('/guides/gemini-api-key')
  })

  it('renders the title as the only h1 and the facts box', async () => {
    const wrapper = await mountPage()

    expect(wrapper.findAll('h1')).toHaveLength(1)
    expect(wrapper.get('h1').text()).toBe('How to get a Gemini API key')
    expect(wrapper.get('[data-testid="key-guide-fact-card"]').text())
      .toBe('Not required')
    expect(wrapper.get('[data-testid="key-guide-fact-top-up"]').text())
      .toBe('$5')
    expect(wrapper.get('[data-testid="key-guide-fact-free-tier"]').text())
      .toBe('Generous free quota')
    expect(wrapper.get('[data-testid="key-guide-facts"]').text())
      .toContain('Pricing page')
  })

  it('omits optional facts that are not set', async () => {
    mocks.guide = {
      ...GUIDE,
      requirements: { card: true, sources: [] },
    }

    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="key-guide-fact-card"]').text())
      .toBe('Required')
    expect(wrapper.find('[data-testid="key-guide-fact-top-up"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="key-guide-fact-free-tier"]').exists())
      .toBe(false)
  })

  it('shows the card note instead of Required / Not required', async () => {
    mocks.guide = {
      ...GUIDE,
      requirements: {
        ...GUIDE.requirements,
        card: false,
        cardNote: 'Only to buy credits.',
      },
    }

    const wrapper = await mountPage()

    expect(wrapper.get('[data-testid="key-guide-fact-card"]').text())
      .toBe('Only to buy credits.')
  })

  it('links the official key page in a new tab with noopener', async () => {
    const wrapper = await mountPage()
    const link = wrapper.get('[data-testid="key-guide-key-link"]')

    expect(link.attributes('href')).toBe(GUIDE.keyUrl)
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toContain('noopener')
  })

  it('renders non-https links as plain text instead of anchors', async () => {
    mocks.guide = {
      ...GUIDE,
      keyUrl: 'javascript:alert(1)',
      requirements: {
        ...GUIDE.requirements,
        sources: [
          { label: 'Pricing page', url: 'https://ai.google.dev/pricing' },
          { label: 'Unsafe page', url: 'http://example.com/pricing' },
        ],
      },
    }

    const wrapper = await mountPage()
    const facts = wrapper.get('[data-testid="key-guide-facts"]')

    expect(facts.findAll('a')).toHaveLength(1)
    expect(facts.text()).toContain('Unsafe page')
    expect(wrapper.find('[data-testid="key-guide-key-link"]').exists())
      .toBe(false)
    expect(wrapper.html()).not.toContain('javascript:')
  })

  it('deep-links the signup CTA to the provider key card', async () => {
    const wrapper = await mountPage()
    const href = wrapper
      .get('[data-testid="key-guide-signup-link"]')
      .attributes('href')!
    const parsedHref = new URL(href, 'http://localhost')

    expect(parsedHref.pathname).toBe('/signup')
    expect(parsedHref.searchParams.get('next'))
      .toBe('/profile/keys?provider=google')
    expect(wrapper.get('[data-testid="key-guide-byok-link"]')
      .attributes('href')).toBe('/byok')
  })

  it('does not deep-link an unknown provider', async () => {
    mocks.guide = { ...GUIDE, provider: 'not-a-provider' }

    const wrapper = await mountPage()
    const href = wrapper
      .get('[data-testid="key-guide-signup-link"]')
      .attributes('href')!
    const parsedHref = new URL(href, 'http://localhost')

    expect(parsedHref.searchParams.get('next')).toBe('/profile/keys')
  })

  it('renders no video block without video frontmatter', async () => {
    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="key-guide-video"]').exists())
      .toBe(false)
  })

  it('renders the video block when video frontmatter exists', async () => {
    mocks.guide = {
      ...GUIDE,
      video: {
        src: '/videos/key.mp4',
        poster: '/videos/key.webp',
        duration: 'PT1M12S',
        uploadDate: '2026-10-20',
        captions: [],
      },
    }

    const wrapper = await mountPage()

    expect(wrapper.find('[data-testid="key-guide-video"]').exists())
      .toBe(true)
  })

  it('shows the poster as the placeholder before the player mounts',
    async () => {
      mocks.guide = {
        ...GUIDE,
        video: {
          src: '/videos/key.mp4',
          poster: '/videos/key.webp',
          duration: 'PT1M12S',
          uploadDate: '2026-10-20',
          captions: [],
        },
      }

      const wrapper = await mountPage({ showClientOnlyFallback: true })
      const video = wrapper.get('[data-testid="key-guide-video"]')

      expect(video.get('img').attributes('src')).toBe('/videos/key.webp')
      expect(video.get('img').attributes('alt')).toBe('')
      expect(video.find('.skeleton').exists()).toBe(false)
    })

  it('keeps the skeleton placeholder when the video has no poster',
    async () => {
      mocks.guide = {
        ...GUIDE,
        video: {
          src: '/videos/key.mp4',
          duration: 'PT1M12S',
          uploadDate: '2026-10-20',
          captions: [],
        },
      }

      const wrapper = await mountPage({ showClientOnlyFallback: true })
      const video = wrapper.get('[data-testid="key-guide-video"]')

      expect(video.find('img').exists()).toBe(false)
      expect(video.find('.skeleton').exists()).toBe(true)
    })

  it('passes the chapter markers to the video player', async () => {
    const markers = [{ time: '0:00', label: 'Start' }]

    mocks.guide = {
      ...GUIDE,
      video: {
        src: '/videos/key.mp4',
        poster: '/videos/key.webp',
        duration: 'PT1M12S',
        uploadDate: '2026-10-20',
        captions: [],
        markers,
      },
    }

    const wrapper = await mountPage()

    expect(
      wrapper.findComponent({ name: 'LandingVideoPlayer' }).props('markers'),
    ).toEqual(markers)
  })

  it('tells the video player which provider the guide belongs to',
    async () => {
      mocks.guide = {
        ...GUIDE,
        video: {
          src: '/videos/key.mp4',
          poster: '/videos/key.webp',
          duration: 'PT1M12S',
          uploadDate: '2026-10-20',
          captions: [],
          markers: [],
        },
      }

      const wrapper = await mountPage()

      expect(
        wrapper.findComponent({ name: 'LandingVideoPlayer' })
          .props('guideProvider'),
      ).toBe('google')
    })

  it('throws a 404 when the guide does not exist', async () => {
    mocks.guide = null

    await mountPage().catch(() => undefined)

    expect(useError().value).toMatchObject({ statusCode: 404 })

    await clearError()
  })
})

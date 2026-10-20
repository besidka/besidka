import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import Guide from '../../../../../app/components/Profile/Keys/Guide.vue'

interface ObserverInstance {
  callback: IntersectionObserverCallback
  options: IntersectionObserverInit | undefined
}

const mocks = vi.hoisted(() => {
  return {
    trackGuideOpen: vi.fn(),
    observers: [] as ObserverInstance[],
  }
})

mockNuxtImport('useKeyGuideAnalytics', () => {
  return () => {
    return {
      trackGuideOpen: mocks.trackGuideOpen,
      trackGuideVideoPlay: vi.fn(),
    }
  }
})

mockComponent('ProfileKeysGuideVideo', () => {
  return {
    name: 'ProfileKeysGuideVideo',
    props: ['provider', 'src', 'poster', 'label', 'markers'],
    emits: ['failed'],
    template: '<div class="video-stub" :data-src="src" />',
  }
})

const stubs = {
  ContentRenderer: {
    template: '<div data-testid="guide-steps">Steps</div>',
  },
}

function createDoc(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'google',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyUrlLabel: 'Open Google AI Studio keys page',
    video: {
      src: '/videos/key-guide-google.mp4',
      poster: '/key-guide/google.webp',
      duration: 'PT34S',
      uploadDate: '2026-10-20',
      alt: 'Creating a key in Google AI Studio',
      captions: [],
    },
    checkedAt: '2026-10-20',
    summary: 'A short summary',
    requirements: {
      card: false,
      minimumTopUp: 'None',
      freeTier: 'Generous free tier',
      sources: [
        { label: 'Google docs', url: 'https://ai.google.dev/docs' },
        { label: 'Pricing', url: 'https://ai.google.dev/pricing' },
      ],
    },
    ...overrides,
  }
}

function guideElement(wrapper: any): HTMLDetailsElement {
  return wrapper.get('[data-testid="key-guide-google"]')
    .element as HTMLDetailsElement
}

describe('Profile/Keys/Guide', () => {
  beforeEach(() => {
    mocks.trackGuideOpen.mockReset()
    mocks.observers.length = 0

    class FakeIntersectionObserver {
      constructor(
        callback: IntersectionObserverCallback,
        options?: IntersectionObserverInit,
      ) {
        mocks.observers.push({ callback, options })
      }

      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      takeRecords = vi.fn(() => {
        return []
      })
    }

    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function mountGuide(
    props: Record<string, unknown> = {},
  ) {
    const wrapper = await mountSuspended(Guide, {
      props: {
        provider: 'google',
        doc: createDoc(),
        status: 'missing',
        ...props,
      },
      global: { stubs },
    })

    await flushPromises()

    return wrapper
  }

  function intersectLastObserver() {
    const observer = mocks.observers.at(-1)!

    observer.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver,
    )
  }

  it('renders nothing when there is no guide document', async () => {
    const wrapper = await mountGuide({ doc: null })

    expect(wrapper.find('[data-testid="key-guide-google"]').exists())
      .toBe(false)
  })

  it('tracks nothing when there is no guide document', async () => {
    await mountGuide({ doc: null, status: 'missing' })

    expect(mocks.trackGuideOpen).not.toHaveBeenCalled()
  })

  it('renders the disclosure title, summary and steps', async () => {
    const wrapper = await mountGuide()

    expect(wrapper.text()).toContain('How to get a key')
    expect(wrapper.text()).toContain('A short summary')
    expect(wrapper.find('[data-testid="guide-steps"]').exists()).toBe(true)
  })

  it('renders the requirements and the checked date with source links',
    async () => {
      const wrapper = await mountGuide()

      expect(wrapper.text()).toContain('What you need')
      expect(wrapper.text()).toContain('Not required')
      expect(wrapper.text()).toContain('Generous free tier')
      expect(wrapper.get('time').attributes('datetime')).toBe('2026-10-20')
      expect(wrapper.get('time').text()).toBe('20 October 2026')

      const sources = wrapper
        .findAll('a')
        .filter((anchor: any) => {
          return anchor.attributes('href')?.startsWith('https://ai.google.dev')
            || anchor.attributes('to')?.startsWith('https://ai.google.dev')
        })

      expect(sources).toHaveLength(2)
      sources.forEach((anchor: any) => {
        expect(anchor.attributes('target')).toBe('_blank')
        expect(anchor.attributes('rel')).toContain('noopener')
      })
    })

  it('shows the card note in place of Required / Not required',
    async () => {
      const wrapper = await mountGuide({
        doc: createDoc({
          requirements: {
            card: false,
            cardNote: 'Only to buy credits.',
            sources: [],
          },
        }),
      })

      expect(wrapper.text()).toContain('Only to buy credits.')
      expect(wrapper.text()).not.toContain('Not required')
      expect(wrapper.text()).not.toContain('Minimum top-up')
      expect(wrapper.text()).not.toContain('Free tier')
    })

  it('renders the open-keys-page button as an external link', async () => {
    const wrapper = await mountGuide()
    const button = wrapper.get('[data-testid="key-guide-open-google"]')

    expect(button.text()).toContain('Open Google AI Studio keys page')
    expect(
      button.attributes('href') ?? button.attributes('to'),
    ).toBe('https://aistudio.google.com/apikey')
    expect(button.attributes('target')).toBe('_blank')
    expect(button.attributes('rel')).toContain('noopener')
  })

  it('falls back to the provider label when the doc has no key url label',
    async () => {
      const wrapper = await mountGuide({
        doc: createDoc({ keyUrlLabel: undefined }),
      })

      expect(
        wrapper.get('[data-testid="key-guide-open-google"]').text(),
      ).toContain('Open Google AI Studio keys page')
    })

  it('opens by default when the key is missing', async () => {
    const wrapper = await mountGuide({ status: 'missing' })

    expect(guideElement(wrapper).open).toBe(true)
  })

  it('stays closed when the key is saved', async () => {
    const wrapper = await mountGuide({ status: 'saved' })

    expect(guideElement(wrapper).open).toBe(false)
  })

  it('stays closed while the key status is unknown, then follows the '
    + 'first resolved status', async () => {
    const wrapper = await mountGuide({ status: 'unknown' })

    expect(guideElement(wrapper).open).toBe(false)

    await wrapper.setProps({ status: 'missing' })

    expect(guideElement(wrapper).open).toBe(true)
  })

  it('does not reopen the guide when the status changes after it settled',
    async () => {
      const wrapper = await mountGuide({ status: 'missing' })

      await wrapper.setProps({ status: 'saved' })

      expect(guideElement(wrapper).open).toBe(true)
    })

  it('keeps a user toggle over a later status resolution', async () => {
    const wrapper = await mountGuide({ status: 'unknown' })
    const element = guideElement(wrapper)

    element.open = true
    element.dispatchEvent(new Event('toggle'))
    await flushPromises()

    await wrapper.setProps({ status: 'saved' })

    expect(guideElement(wrapper).open).toBe(true)
  })

  it('does not mount the video until the guide is open and near the '
    + 'viewport', async () => {
    const wrapper = await mountGuide({ status: 'missing' })

    expect(wrapper.find('.video-stub').exists()).toBe(false)

    intersectLastObserver()
    await flushPromises()

    expect(wrapper.find('.video-stub').attributes('data-src'))
      .toBe('/videos/key-guide-google.mp4')
  })

  it('passes the chapter markers to the video player', async () => {
    const markers = [{ time: '0:00', label: 'Start' }]
    const wrapper = await mountGuide({
      status: 'missing',
      doc: createDoc({
        video: { ...createDoc().video, markers },
      }),
    })

    intersectLastObserver()
    await flushPromises()

    expect(
      wrapper.findComponent({ name: 'ProfileKeysGuideVideo' }).props('markers'),
    ).toEqual(markers)
  })

  it('keeps the video unmounted while the guide is closed', async () => {
    const wrapper = await mountGuide({ status: 'saved' })

    intersectLastObserver()
    await flushPromises()

    expect(wrapper.find('.video-stub').exists()).toBe(false)
  })

  it('observes the video box inside the page scroll container', async () => {
    await mountGuide()

    const observer = mocks.observers.at(-1)!

    expect(observer.options?.rootMargin).toBe('300px')
  })

  it('shows a lazy poster named by the video alt before the player mounts',
    async () => {
      const wrapper = await mountGuide()
      const videoBox = wrapper.get('[data-testid="key-guide-video-google"]')

      expect(videoBox.attributes('role')).toBeUndefined()
      expect(videoBox.attributes('aria-label')).toBeUndefined()
      expect(videoBox.get('img').attributes('alt'))
        .toBe('Creating a key in Google AI Studio')
      expect(videoBox.get('img').attributes('loading')).toBe('lazy')
      expect(videoBox.get('img').attributes('src'))
        .toBe('/key-guide/google.webp')
    })

  it('swaps a failed player for the poster and a muted note', async () => {
    const wrapper = await mountGuide({ status: 'missing' })

    intersectLastObserver()
    await flushPromises()

    expect(wrapper.find('.video-stub').exists()).toBe(true)
    expect(wrapper.find('[data-testid="key-guide-video-failed-google"]')
      .exists()).toBe(false)

    wrapper.findComponent({ name: 'ProfileKeysGuideVideo' }).vm.$emit('failed')
    await flushPromises()

    const note = wrapper.get('[data-testid="key-guide-video-failed-google"]')

    expect(wrapper.find('.video-stub').exists()).toBe(false)
    expect(note.text()).toBe('Video unavailable. Follow the steps below.')
    expect(wrapper.get('[data-testid="key-guide-video-google"] img')
      .attributes('src')).toBe('/key-guide/google.webp')
  })

  it('does not remount the player once it has failed', async () => {
    const wrapper = await mountGuide({ status: 'missing' })

    intersectLastObserver()
    await flushPromises()
    wrapper.findComponent({ name: 'ProfileKeysGuideVideo' }).vm.$emit('failed')
    await flushPromises()
    intersectLastObserver()
    await flushPromises()

    expect(wrapper.find('.video-stub').exists()).toBe(false)
  })

  it('shows the note without a poster when the poster is missing too',
    async () => {
      const wrapper = await mountGuide({ status: 'missing' })

      await wrapper.get('[data-testid="key-guide-video-google"] img')
        .trigger('error')
      intersectLastObserver()
      await flushPromises()
      wrapper.findComponent({ name: 'ProfileKeysGuideVideo' })
        .vm.$emit('failed')
      await flushPromises()

      expect(wrapper.find('[data-testid="key-guide-video-google"] img')
        .exists()).toBe(false)
      expect(wrapper.find('[data-testid="key-guide-video-failed-google"]')
        .exists()).toBe(true)
    })

  it('drops a poster that fails to load', async () => {
    const wrapper = await mountGuide()
    const poster = wrapper.get('[data-testid="key-guide-video-google"] img')

    await poster.trigger('error')

    expect(
      wrapper.find('[data-testid="key-guide-video-google"] img').exists(),
    ).toBe(false)
  })

  it('omits the video block when the doc has no video', async () => {
    const wrapper = await mountGuide({
      doc: createDoc({ video: undefined }),
    })

    expect(wrapper.find('[data-testid="key-guide-video-google"]').exists())
      .toBe(false)
  })

  it('has no dead js hook classes or duplicate group role', async () => {
    const wrapper = await mountGuide()

    expect(wrapper.html()).not.toContain('js-key-guide')
    expect(wrapper.find('[role="group"]').exists()).toBe(false)
  })

  it('tracks key_guide_open when the guide is open inside an expanded card',
    async () => {
      await mountGuide({ status: 'missing', cardOpen: true })

      expect(mocks.trackGuideOpen).toHaveBeenCalledExactlyOnceWith('google')
    })

  it('does not track while the card is collapsed, then tracks once the '
    + 'card expands', async () => {
    const wrapper = await mountGuide({ status: 'missing', cardOpen: false })

    expect(mocks.trackGuideOpen).not.toHaveBeenCalled()

    await wrapper.setProps({ cardOpen: true })

    expect(mocks.trackGuideOpen).toHaveBeenCalledExactlyOnceWith('google')
  })

  it('tracks when the status resolves to missing inside an expanded card',
    async () => {
      const wrapper = await mountGuide({ status: 'unknown', cardOpen: true })

      expect(mocks.trackGuideOpen).not.toHaveBeenCalled()

      await wrapper.setProps({ status: 'missing' })

      expect(mocks.trackGuideOpen).toHaveBeenCalledExactlyOnceWith('google')
    })

  it('does not track a guide that stays closed', async () => {
    await mountGuide({ status: 'saved' })

    expect(mocks.trackGuideOpen).not.toHaveBeenCalled()
  })

  it('tracks when the user opens a closed guide', async () => {
    const wrapper = await mountGuide({ status: 'saved' })
    const element = guideElement(wrapper)

    element.open = true
    element.dispatchEvent(new Event('toggle'))
    await flushPromises()

    expect(mocks.trackGuideOpen).toHaveBeenCalledExactlyOnceWith('google')
  })

  it('does not track when the user opens the guide of a collapsed card',
    async () => {
      const wrapper = await mountGuide({ status: 'saved', cardOpen: false })
      const element = guideElement(wrapper)

      element.open = true
      element.dispatchEvent(new Event('toggle'))
      await flushPromises()

      expect(mocks.trackGuideOpen).not.toHaveBeenCalled()
    })
})

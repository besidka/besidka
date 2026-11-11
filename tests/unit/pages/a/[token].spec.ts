import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import type { Ref } from 'vue'
import type { ArtifactSharePublicView } from '#shared/utils/artifacts'
import ArtifactSharePage from '../../../../app/pages/a/[token].vue'

enableAutoUnmount(afterEach)

const TOKEN = 'abcDEF_123-token'

const mocks = vi.hoisted(() => ({
  useFetch: vi.fn(),
  refresh: vi.fn(),
  frameProps: [] as Array<Record<string, unknown>>,
  modalProps: [] as Array<Record<string, unknown>>,
}))

const loggedIn = ref<boolean>(false)
const data = ref<ArtifactSharePublicView | null>(null) as Ref<
  ArtifactSharePublicView | null
>
const error = ref<unknown>(null)
const status = ref<string>('success')

mockNuxtImport('useFetch', () => mocks.useFetch)
mockNuxtImport('useAuth', () => {
  return () => ({ loggedIn })
})
mockNuxtImport('useRoute', () => {
  return () => ({ params: { token: TOKEN }, path: `/a/${TOKEN}` })
})

mockComponent('ChatArtifactFrame', () => {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs }) {
      mocks.frameProps.push(attrs)

      return () => h('div', { 'data-testid': 'frame-stub' })
    },
  })
})

mockComponent('ArtifactReportModal', () => {
  return defineComponent({
    inheritAttrs: false,
    setup(_props, { attrs }) {
      return () => {
        mocks.modalProps.push({ ...attrs })

        return h('div', {
          'data-testid': 'report-modal-stub',
          'data-open': String(attrs.open),
        })
      }
    },
  })
})

function createShare(
  overrides: Partial<ArtifactSharePublicView> = {},
): ArtifactSharePublicView {
  return {
    shareId: 'sh_1',
    artifactId: 'ArtifactPublicId1',
    title: 'Capitals quiz',
    kind: 'html',
    version: 3,
    pinned: false,
    content: '<p>Quiz</p>',
    createdAt: '2026-11-09T10:00:00.000Z',
    expiresAt: null,
    capabilities: { storageAllowed: false, bridgeAllowed: false },
    ...overrides,
  }
}

function byTestId(testId: string) {
  return `[data-testid="${testId}"]`
}

async function mountPage() {
  const wrapper = await mountSuspended(ArtifactSharePage, {
    attachTo: document.body,
    global: {
      stubs: {
        NuxtLink: defineComponent({
          props: { to: { type: [String, Object], required: true } },
          setup(props, { slots }) {
            return () => h('a', {
              'data-to': JSON.stringify(props.to),
            }, slots.default?.())
          },
        }),
      },
    },
  })

  await flushPromises()

  return wrapper
}

function readPageSource(): string {
  return readFileSync(
    join(process.cwd(), 'app/pages/a/[token].vue'),
    'utf-8',
  )
}

describe('pages/a/[token]', () => {
  beforeEach(() => {
    vi.stubGlobal('definePageMeta', vi.fn())
    loggedIn.value = false
    data.value = createShare()
    error.value = null
    status.value = 'success'
    mocks.frameProps.length = 0
    mocks.modalProps.length = 0
    mocks.refresh.mockReset().mockResolvedValue(undefined)
    mocks.useFetch.mockReset().mockImplementation(() => {
      return { data, error, status, refresh: mocks.refresh }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches the link on the client with the token only in a header',
    async () => {
      await mountPage()

      const [url, options] = mocks.useFetch.mock.calls[0]!

      expect(url).toBe('/api/v1/artifact-shares/current')
      expect(String(url)).not.toContain(TOKEN)
      expect(options.server).toBe(false)
      expect(options.headers.value).toEqual({
        'x-besidka-artifact-share': TOKEN,
      })
    })

  it('keys the fetch by token, so another link never shows cached data',
    async () => {
      await mountPage()

      const [, options] = mocks.useFetch.mock.calls[0]!

      expect(typeof options.key).toBe('function')
      expect(options.key()).toBe(`artifact-share-current:${TOKEN}`)
    })

  it('is noindex, marked AI-generated and keeps the global canonical',
    () => {
      const source = readPageSource()

      expect(source).toMatch(/robots:\s*'noindex,\s*nofollow'/)
      expect(source).toMatch(
        /name:\s*'ai-generated',\s*content:\s*'true'/,
      )
      expect(source).toMatch(/share\.value\?\.title \|\| 'Shared artifact'/)
      expect(source).not.toMatch(/canonical/)
      expect(source).toMatch(/layout:\s*'artifact-share'/)
    })

  it('lifts the layout above the fixed page background', () => {
    const layout = readFileSync(
      join(process.cwd(), 'app/layouts/artifact-share.vue'),
      'utf-8',
    )

    expect(layout).toMatch(/class="relative /)
  })

  it('shows the AI banner as a labelled region with a Report button',
    async () => {
      const wrapper = await mountPage()
      const banner = wrapper.get(byTestId('artifact-share-banner'))

      expect(banner.attributes('role')).toBe('region')
      expect(banner.attributes('aria-label')).toBe('About this artifact')
      expect(banner.classes()).toEqual(expect.arrayContaining([
        'alert',
        'alert-info',
        'alert-soft',
      ]))
      expect(banner.text()).toContain(
        'AI-generated by a Besidka user, not reviewed by Besidka.',
      )
      expect(banner.text()).toContain(
        'Never enter passwords or payment details here.',
      )
      expect(wrapper.get(byTestId('artifact-share-title')).text())
        .toBe('Capitals quiz')

      const report = wrapper.get(byTestId('artifact-share-report'))

      expect(report.element.tagName).toBe('BUTTON')
      expect(report.classes()).toContain('min-h-6')
    })

  it('puts a skip link to the report button before the frame', async () => {
    const wrapper = await mountPage()
    const skip = wrapper.get(byTestId('artifact-share-skip-to-report'))
    const html = wrapper.html()

    expect(skip.classes()).toContain('sr-only')
    expect(html.indexOf('artifact-share-skip-to-report'))
      .toBeLessThan(html.indexOf('frame-stub'))

    await skip.trigger('click')

    expect(document.activeElement?.getAttribute('data-testid'))
      .toBe('artifact-share-report')
  })

  it('renders the frame in full-screen mode with the share token',
    async () => {
      data.value = createShare({
        capabilities: { storageAllowed: true, bridgeAllowed: false },
      })

      await mountPage()

      const props = mocks.frameProps.at(-1)!

      expect(props).toMatchObject({
        'source': 'public-share',
        'share-token': TOKEN,
        'artifact-id': 'ArtifactPublicId1',
        'version': 3,
        'display-mode-override': 'fullscreen',
        'share-capabilities': { storageAllowed: true, bridgeAllowed: false },
      })
      expect(props.result).toEqual({
        kind: 'html',
        title: 'Capitals quiz',
        content: '<p>Quiz</p>',
        artifactId: 'ArtifactPublicId1',
        version: 3,
      })
    })

  it('opens the report modal with the share endpoint and header',
    async () => {
      const wrapper = await mountPage()

      await wrapper.get(byTestId('artifact-share-report')).trigger('click')

      const props = mocks.modalProps.at(-1)!

      expect(props.open).toBe(true)
      expect(props.endpoint).toBe('/api/v1/artifact-shares/current/report')
      expect(props.headers).toEqual({ 'x-besidka-artifact-share': TOKEN })
    })

  describe('sign-in caption', () => {
    it('invites a signed-out viewer when the link saves progress',
      async () => {
        data.value = createShare({
          capabilities: { storageAllowed: true, bridgeAllowed: false },
        })

        const wrapper = await mountPage()
        const caption = wrapper.get(byTestId('artifact-share-sign-in'))

        expect(caption.text()).toBe('Sign in to save your progress')
        expect(JSON.parse(caption.get('a').attributes('data-to')!)).toEqual({
          path: '/signin',
          query: { next: `/a/${TOKEN}` },
        })
      })

    it('is hidden when the link does not save progress', async () => {
      const wrapper = await mountPage()

      expect(wrapper.find(byTestId('artifact-share-sign-in')).exists())
        .toBe(false)
    })

    it('is hidden for a signed-in viewer', async () => {
      loggedIn.value = true
      data.value = createShare({
        capabilities: { storageAllowed: true, bridgeAllowed: true },
      })

      const wrapper = await mountPage()

      expect(wrapper.find(byTestId('artifact-share-sign-in')).exists())
        .toBe(false)
    })
  })

  describe('states', () => {
    it('shows a skeleton while loading', async () => {
      data.value = null
      status.value = 'pending'

      const wrapper = await mountPage()
      const loading = wrapper.get(byTestId('artifact-share-loading'))

      expect(loading.attributes('aria-busy')).toBe('true')
      expect(loading.find('.skeleton.skeleton--default').exists()).toBe(true)
      expect(mocks.frameProps).toHaveLength(0)
    })

    it('renders an unavailable link inside the page', async () => {
      data.value = null
      status.value = 'error'
      error.value = { statusCode: 404 }

      const wrapper = await mountPage()

      expect(wrapper.get(byTestId('artifact-share-not-found')).text())
        .toContain('This link is not available')
      expect(mocks.frameProps).toHaveLength(0)
    })

    it('explains a takedown with a link to the Privacy Policy', async () => {
      data.value = null
      status.value = 'error'
      error.value = { statusCode: 410, data: { data: { takenDown: true } } }

      const wrapper = await mountPage()
      const state = wrapper.get(byTestId('artifact-share-taken-down'))

      expect(state.text()).toContain('This artifact was removed after a report')
      const link = wrapper.get(byTestId('artifact-share-takedown-link'))

      expect(JSON.parse(link.attributes('data-to')!))
        .toBe('/privacy-policy#reports-and-notices-about-content')
      expect(link.text()).toBe('How reports and removals work')
    })

    it('offers Retry for any other error', async () => {
      data.value = null
      status.value = 'error'
      error.value = { statusCode: 500 }

      const wrapper = await mountPage()

      expect(wrapper.get(byTestId('artifact-share-error')).text())
        .toContain('The artifact did not load')

      await wrapper.get(byTestId('artifact-share-retry')).trigger('click')

      expect(mocks.refresh).toHaveBeenCalled()
    })
  })
})

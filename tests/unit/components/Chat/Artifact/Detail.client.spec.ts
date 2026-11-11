import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import ChatArtifactDetail from '../../../../../app/components/Chat/Artifact/Detail.client.vue'
import {
  useArtifactPanel,
  useSharedArtifactVersions,
} from '../../../../../app/composables/artifacts'
import type { ArtifactPanelTarget } from '../../../../../app/composables/artifacts'
import { useSidePanel } from '../../../../../app/composables/side-panel'

enableAutoUnmount(afterEach)

const {
  fetchMock,
  downloadMock,
  layout,
  frameMounts,
  confirmMock,
  resetStorageMock,
  successMessageMock,
  errorMessageMock,
  renderDiagramMock,
  navigateMock,
  chatRoute,
  fakeRoute,
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  downloadMock: vi.fn(),
  layout: { value: 'docked' as 'docked' | 'overlay' | 'sheet' },
  frameMounts: { count: 0 },
  confirmMock: vi.fn(),
  resetStorageMock: vi.fn(),
  successMessageMock: vi.fn(),
  errorMessageMock: vi.fn(),
  renderDiagramMock: vi.fn(async () => {
    return { svg: '<svg data-testid="rendered"></svg>' }
  }),
  navigateMock: vi.fn(),
  chatRoute: { slug: '', isOwned: false },
  fakeRoute: { path: '/chats/artifacts' },
}))

mockNuxtImport('useDiagramRenderer', () => {
  return () => {
    return { renderDiagram: renderDiagramMock }
  }
})

mockNuxtImport('sanitizeDiagramSvg', () => {
  return (svg: string) => svg
})

mockComponent('ProseMermaidActionMenu', () => {
  return {
    props: ['label', 'icon', 'testId', 'actions', 'input'],
    template: `
      <button
        :data-testid="testId"
        :data-actions="actions.map(item => item.action).join(',')"
        :data-has-svg="String(!!input.svg)"
        :data-has-theme="String(!!input.themeElement())"
      >{{ label }}</button>
    `,
  }
})

mockNuxtImport('$fetch', () => fetchMock)

mockNuxtImport('useConfirm', () => confirmMock)

mockNuxtImport('useSuccessMessage', () => successMessageMock)

mockNuxtImport('useErrorMessage', () => errorMessageMock)

mockNuxtImport('navigateTo', () => navigateMock)

mockNuxtImport('useRoute', () => {
  return () => fakeRoute
})

mockNuxtImport('useChatRoute', () => {
  return () => {
    return {
      routeSlug: computed(() => chatRoute.slug),
      isOwnedChatPage: computed(() => chatRoute.isOwned),
    }
  }
})

mockNuxtImport('useSidePanelLayout', () => {
  return () => layout
})

const shareFeature = ref({ enabled: true, active: false, variant: null })

mockNuxtImport('useFeature', () => {
  return () => shareFeature
})

mockComponent('ChatArtifactShareModal', () => {
  return {
    props: ['open', 'artifactId', 'title', 'currentVersion'],
    template: `
      <div
        data-testid="share-modal-stub"
        :data-open="String(open)"
        :data-artifact-id="artifactId"
        :data-current-version="currentVersion"
      />
    `,
  }
})

vi.mock('~/composables/artifact-storage', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../../../app/composables/artifact-storage')
  >()

  return { ...actual, resetArtifactStorage: resetStorageMock }
})

vi.mock('~/utils/artifact-export', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../../../app/utils/artifact-export')
  >()

  return { ...actual, downloadArtifactFile: downloadMock }
})

mockComponent('ChatArtifactFrame', () => {
  return {
    props: ['title', 'result', 'partial', 'artifactId', 'version', 'source'],
    emits: ['runtime-message', 'ready', 'storage-change'],
    setup() {
      frameMounts.count += 1
    },
    template: `
      <div
        data-testid="frame-stub"
        :data-content="result?.content ?? ''"
        :data-partial="partial?.content ?? ''"
        :data-source="source"
        @click="$emit('runtime-message', {
          level: 'error',
          message: 'ReferenceError: x is not defined',
          stack: 'at render',
        })"
      >
        <button
          type="button"
          data-testid="frame-storage-stub"
          @click.stop="$emit('storage-change', {
            persistent: true,
            keys: 2,
            bytes: 10,
          })"
        />
        <button
          type="button"
          data-testid="frame-storage-memory-stub"
          @click.stop="$emit('storage-change', {
            persistent: false,
            keys: 0,
            bytes: 0,
          })"
        />
        <button
          type="button"
          data-testid="frame-storage-empty-stub"
          @click.stop="$emit('storage-change', {
            persistent: true,
            keys: 0,
            bytes: 0,
          })"
        />
      </div>
    `,
  }
})

mockComponent('ChatArtifactCodeView', () => {
  return {
    props: {
      code: String,
      language: String,
      cacheKey: String,
    },
    template: `
      <pre
        data-testid="code-stub"
        data-mode="finished"
        :data-language="language"
        :data-cache-key="cacheKey"
      >{{ code }}</pre>
    `,
  }
})

mockComponent('ProseCodeStream', () => {
  return {
    props: {
      code: String,
      language: String,
      theme: String,
    },
    template: `
      <pre
        data-testid="code-stub"
        data-mode="streaming"
        :data-language="language"
      >{{ code }}</pre>
    `,
  }
})

mockComponent('ChatArtifactReportButton', () => {
  return {
    props: ['shareSlug', 'artifactId', 'title'],
    template: `
      <button
        data-testid="report-stub"
        :data-share-slug="shareSlug"
        :data-artifact-id="artifactId"
      />
    `,
  }
})

const DETAIL = {
  id: 'Art1Art1Art1Art1',
  title: 'Landing page',
  kind: 'html',
  originChatSlug: 'origin-chat' as string | null,
  originChatTitle: 'Origin chat' as string | null,
  createdVia: 'chat',
  currentVersion: 3,
  versionCount: 3,
  versions: [
    { version: 3, sizeBytes: 10, createdBy: 'model', createdAt: '' },
    { version: 2, sizeBytes: 10, createdBy: 'model', createdAt: '' },
    { version: 1, sizeBytes: 10, createdBy: 'model', createdAt: '' },
  ],
}

function versionContent(version: number, kind = 'html') {
  return {
    artifactId: 'Art1Art1Art1Art1',
    kind,
    title: 'Landing page',
    version,
    content: `<p>v${version}</p>`,
    sizeBytes: 10,
    createdAt: '',
  }
}

const DETAIL_WITH_V4 = {
  ...DETAIL,
  currentVersion: 4,
  versionCount: 4,
  versions: [
    { version: 4, sizeBytes: 10, createdBy: 'model', createdAt: '' },
    ...DETAIL.versions,
  ],
}

function respond(detail: typeof DETAIL = DETAIL) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/v1/artifacts/Art1Art1Art1Art1') {
      return detail
    }

    const match = /\/versions\/(\d+)$/.exec(url)

    if (match) {
      return versionContent(Number(match[1]))
    }

    throw new Error(`Unexpected ${url}`)
  })
}

function openTarget(overrides: Partial<ArtifactPanelTarget> = {}) {
  useArtifactPanel().open({
    artifactId: 'Art1Art1Art1Art1',
    version: 3,
    kind: 'html',
    title: 'Landing page',
    source: 'owner',
    ...overrides,
  })
}

async function mountDetail() {
  const wrapper = await mountSuspended(ChatArtifactDetail)

  await flushPromises()

  return wrapper
}

function resetState() {
  useSidePanel().close()
  useArtifactPanel().state.value = null
  useArtifactPanel().stream.value = null
  useArtifactPanel().latestVersions.value = {}
  useSharedArtifactVersions().value = {}
  useState('artifact-panel:deleted').value = {}
  useState('artifact-panel:unavailable').value = {}
}

beforeEach(() => {
  resetState()
  fetchMock.mockReset()
  navigateMock.mockReset().mockImplementation(async (path: string) => {
    fakeRoute.path = path
  })
  fakeRoute.path = '/chats/artifacts'
  chatRoute.slug = ''
  chatRoute.isOwned = false
  downloadMock.mockReset()
  confirmMock.mockReset()
  resetStorageMock.mockReset()
  successMessageMock.mockReset()
  errorMessageMock.mockReset()
  frameMounts.count = 0
  layout.value = 'docked'
  shareFeature.value = { enabled: true, active: false, variant: null }
  respond()
})

afterEach(resetState)

describe('ChatArtifactDetail', () => {
  it('loads the owner version and lists every version', async () => {
    openTarget()

    const wrapper = await mountDetail()
    const options = wrapper.findAll(
      '[data-testid="artifact-version-select"] option',
    )

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/artifacts/Art1Art1Art1Art1',
      expect.anything(),
    )
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/artifacts/Art1Art1Art1Art1/versions/3',
      expect.anything(),
    )
    expect(options.map(option => option.text())).toEqual(['v3', 'v2', 'v1'])
    expect(wrapper.get('[data-testid="frame-stub"]').attributes('data-content'))
      .toBe('<p>v3</p>')
    expect(wrapper.get('[data-testid="artifact-ai-note"]').text())
      .toBe('AI-generated content')
  })

  it('switches versions without remounting the frame', async () => {
    openTarget()

    const wrapper = await mountDetail()

    await wrapper.get('[data-testid="artifact-version-select"]')
      .setValue('1')
    await flushPromises()

    expect(useArtifactPanel().state.value?.version).toBe(1)
    expect(wrapper.get('[data-testid="frame-stub"]').attributes('data-content'))
      .toBe('<p>v1</p>')
    expect(frameMounts.count).toBe(1)
  })

  it('gives a Mermaid artifact the chat diagram actions on the Code tab',
    async () => {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/v1/artifacts/Art1Art1Art1Art1') {
          return { ...DETAIL, kind: 'mermaid' }
        }

        return {
          ...versionContent(3, 'mermaid'),
          content: 'graph TD\n  A --> B',
        }
      })
      openTarget({ kind: 'mermaid' })

      const wrapper = await mountDetail()

      expect(wrapper.find('[data-testid="artifact-mermaid-actions"]').exists())
        .toBe(false)

      await wrapper.get('[data-testid="artifact-tab-code"]').trigger('click')
      await flushPromises()

      const actions = wrapper.get('[data-testid="artifact-mermaid-actions"]')
      const download = actions.get('[data-testid="artifact-mermaid-download"]')

      expect(actions.classes()).toContain('pele-theme')
      expect(download.attributes('data-actions'))
        .toBe('download-svg,download-png,download-drawio')
      expect(download.attributes('data-has-svg')).toBe('true')
      expect(download.attributes('data-has-theme')).toBe('true')
      expect(actions.get('[data-testid="artifact-mermaid-copy"]')
        .attributes('data-actions')).toContain('copy-drawio')
      expect(renderDiagramMock).toHaveBeenCalledWith(
        'graph TD\n  A --> B',
        expect.objectContaining({ idPrefix: expect.any(String) }),
      )

      await wrapper.get('[data-testid="artifact-tab-preview"]')
        .trigger('click')

      expect(wrapper.find('[data-testid="artifact-mermaid-actions"]').exists())
        .toBe(false)
    })

  it('shows the exact stored source in the Code tab', async () => {
    openTarget()

    const wrapper = await mountDetail()

    await wrapper.get('[data-testid="artifact-tab-code"]').trigger('click')
    await flushPromises()

    const code = wrapper.get('[data-testid="code-stub"]')

    expect(code.text()).toBe('<p>v3</p>')
    expect(code.attributes('data-language')).toBe('html')
    expect(code.attributes('data-mode')).toBe('finished')
    expect(code.attributes('data-cache-key')).toBe('Art1Art1Art1Art1:3')
    expect(wrapper.get('[data-testid="frame-stub"]').element.parentElement
      ?.style.display).toBe('none')
  })

  it('switches to Code on the click and keeps both panels mounted',
    async () => {
      openTarget()

      const wrapper = await mountDetail()

      await flushPromises()

      const mountsBefore = frameMounts.count

      await wrapper.get('[data-testid="artifact-tab-code"]').trigger('click')

      expect(wrapper.get('[data-testid="artifact-tab-code"]').classes())
        .toContain('tab-active')
      expect((wrapper.get('[data-testid="artifact-code"]').element as
        HTMLElement).style.display).toBe('')

      const codeElement = wrapper.get('[data-testid="code-stub"]').element

      await wrapper.get('[data-testid="artifact-tab-preview"]').trigger('click')

      expect((wrapper.get('[data-testid="artifact-code"]').element as
        HTMLElement).style.display).toBe('none')

      await wrapper.get('[data-testid="artifact-tab-code"]').trigger('click')

      expect(wrapper.get('[data-testid="code-stub"]').element)
        .toBe(codeElement)
      expect(frameMounts.count).toBe(mountsBefore)
    })

  describe('runtime errors per version', () => {
    const BANNER = '[data-testid="artifact-runtime-error"]'

    async function selectVersion(
      wrapper: Awaited<ReturnType<typeof mountDetail>>,
      version: string,
    ) {
      await wrapper.get('[data-testid="artifact-version-select"]')
        .setValue(version)
      await flushPromises()
    }

    it('shows only the error of the selected version', async () => {
      openTarget()

      const wrapper = await mountDetail()

      await wrapper.get('[data-testid="frame-stub"]').trigger('click')
      expect(wrapper.find(BANNER).exists()).toBe(true)

      await selectVersion(wrapper, '1')
      expect(wrapper.find(BANNER).exists()).toBe(false)
    })

    it('brings a version back without its old error until it recurs',
      async () => {
        openTarget()

        const wrapper = await mountDetail()

        await wrapper.get('[data-testid="frame-stub"]').trigger('click')
        await selectVersion(wrapper, '1')
        await wrapper.get('[data-testid="frame-stub"]').trigger('click')
        expect(wrapper.find(BANNER).exists()).toBe(true)

        await selectVersion(wrapper, '3')
        expect(wrapper.find(BANNER).exists()).toBe(false)

        await selectVersion(wrapper, '1')
        expect(wrapper.find(BANNER).exists()).toBe(false)

        await wrapper.get('[data-testid="frame-stub"]').trigger('click')
        expect(wrapper.find(BANNER).exists()).toBe(true)
      })
  })

  describe('Ask to fix', () => {
    it('targets the version whose error is shown', async () => {
      chatRoute.slug = 'origin-chat'
      chatRoute.isOwned = true
      openTarget()

      const wrapper = await mountDetail()

      await wrapper.get('[data-testid="artifact-version-select"]')
        .setValue('1')
      await flushPromises()
      await wrapper.get('[data-testid="frame-stub"]').trigger('click')
      useSidePanel().close()
      await wrapper.get('[data-testid="artifact-ask-to-fix"]')
        .trigger('click')
      await flushPromises()

      expect(useArtifactPanel().state.value).toMatchObject({
        artifactId: 'Art1Art1Art1Art1',
        version: 1,
      })
    })

    async function mountWithRuntimeError() {
      openTarget()

      const wrapper = await mountDetail()

      await wrapper.get('[data-testid="frame-stub"]').trigger('click')

      return wrapper
    }

    it('prefills the composer in the origin chat and never sends',
      async () => {
        const prefill = vi.fn()
        const submit = vi.fn()

        useNuxtApp().hook('chat-input:prefill', prefill)
        useNuxtApp().hook('chat:submit', submit)
        chatRoute.slug = 'origin-chat'
        chatRoute.isOwned = true

        const wrapper = await mountWithRuntimeError()

        expect(wrapper.get('[data-testid="artifact-runtime-error"]').text())
          .toContain('ReferenceError: x is not defined')

        await wrapper.get('[data-testid="artifact-ask-to-fix"]')
          .trigger('click')
        await flushPromises()

        expect(prefill).toHaveBeenCalledWith(
          'Fix the error in "Landing page": ReferenceError: x is not defined',
        )
        expect(submit).not.toHaveBeenCalled()
        expect(navigateMock).not.toHaveBeenCalled()
        expect(useSidePanel().isOpen.value).toBe(true)
      })

    it('closes the panel below the docked layout before prefilling',
      async () => {
        layout.value = 'overlay'
        chatRoute.slug = 'origin-chat'
        chatRoute.isOwned = true

        const wrapper = await mountWithRuntimeError()

        await wrapper.get('[data-testid="artifact-ask-to-fix"]')
          .trigger('click')
        await flushPromises()

        expect(useSidePanel().isOpen.value).toBe(false)
      })

    it('queues the prompt, navigates to the origin chat and reopens the panel',
      async () => {
        const prefill = vi.fn()
        const submit = vi.fn()

        useNuxtApp().hook('chat-input:prefill', prefill)
        useNuxtApp().hook('chat:submit', submit)

        const wrapper = await mountWithRuntimeError()

        useSidePanel().close()
        await wrapper.get('[data-testid="artifact-ask-to-fix"]')
          .trigger('click')
        await flushPromises()

        expect(navigateMock).toHaveBeenCalledWith('/chats/origin-chat')
        expect(useChatInputPrefill().take()).toBe(
          'Fix the error in "Landing page": ReferenceError: x is not defined',
        )
        expect(prefill).not.toHaveBeenCalled()
        expect(useSidePanel().currentView.value?.preserveFocus).toBe(true)
        expect(submit).not.toHaveBeenCalled()
        expect(useArtifactPanel().state.value).toMatchObject({
          artifactId: 'Art1Art1Art1Art1',
          version: 3,
          source: 'owner',
        })
        expect(useSidePanel().isOpen.value).toBe(true)
      })

    it('does not reopen the panel in the sheet layout', async () => {
      layout.value = 'sheet'

      const wrapper = await mountWithRuntimeError()

      navigateMock.mockImplementation(async (path: string) => {
        expect(useSidePanel().isOpen.value).toBe(false)
        fakeRoute.path = path
      })
      await wrapper.get('[data-testid="artifact-ask-to-fix"]')
        .trigger('click')
      await flushPromises()

      expect(navigateMock).toHaveBeenCalledWith('/chats/origin-chat')
      expect(useSidePanel().isOpen.value).toBe(false)
    })

    it('drops the queued prompt when the navigation does not land',
      async () => {
        navigateMock.mockImplementation(async () => {})

        const wrapper = await mountWithRuntimeError()

        vi.useFakeTimers()

        try {
          await wrapper.get('[data-testid="artifact-ask-to-fix"]')
            .trigger('click')
          await vi.advanceTimersByTimeAsync(3000)
        } finally {
          vi.useRealTimers()
        }

        await flushPromises()

        expect(useChatInputPrefill().take()).toBeNull()
        expect(useSidePanel().isOpen.value).toBe(true)
      })

    it('keeps Ask to fix usable when the artifact detail cannot load',
      async () => {
        fetchMock.mockImplementation(async (url: string) => {
          if (url === '/api/v1/artifacts/Art1Art1Art1Art1') {
            throw Object.assign(new Error('Server error'), { status: 500 })
          }

          return versionContent(3)
        })

        const prefill = vi.fn()

        useNuxtApp().hook('chat-input:prefill', prefill)
        chatRoute.slug = 'other-chat'
        chatRoute.isOwned = true

        const wrapper = await mountWithRuntimeError()

        await wrapper.get('[data-testid="artifact-ask-to-fix"]')
          .trigger('click')
        await flushPromises()

        expect(prefill).toHaveBeenCalled()
      })

    it('fills the open composer instead of navigating from /chats/new',
      async () => {
        const prefill = vi.fn()

        useNuxtApp().hook('chat-input:prefill', prefill)
        fakeRoute.path = '/chats/new'
        respond({ ...DETAIL, originChatSlug: null, originChatTitle: null })

        const wrapper = await mountWithRuntimeError()

        await wrapper.get('[data-testid="artifact-start-new-chat"]')
          .trigger('click')
        await flushPromises()

        expect(navigateMock).not.toHaveBeenCalled()
        expect(prefill).toHaveBeenCalledWith(
          'Fix the error in "Landing page": ReferenceError: x is not defined',
        )
        expect(useChatInputPrefill().take()).toBeNull()
      })

    it('offers a new chat when the origin chat was deleted', async () => {
      respond({ ...DETAIL, originChatSlug: null, originChatTitle: null })

      const wrapper = await mountWithRuntimeError()

      expect(wrapper.find('[data-testid="artifact-ask-to-fix"]').exists())
        .toBe(false)
      expect(wrapper.get('[data-testid="artifact-fix-no-chat"]').text())
        .toBe('The chat that created this artifact was deleted.')

      await wrapper.get('[data-testid="artifact-start-new-chat"]')
        .trigger('click')
      await flushPromises()

      expect(navigateMock).toHaveBeenCalledWith('/chats/new')
      expect(useChatInputPrefill().take()).toBe(
        'Fix the error in "Landing page": ReferenceError: x is not defined',
      )
    })

    it('says so when a connected app created the artifact', async () => {
      respond({ ...DETAIL, createdVia: 'mcp' })

      const wrapper = await mountWithRuntimeError()

      expect(wrapper.get('[data-testid="artifact-fix-no-chat"]').text())
        .toBe('A connected app created this artifact, so it has no chat.')
    })

    it('is not offered on a shared chat', async () => {
      useSharedArtifactVersions().value = { Art1Art1Art1Art1: [3] }
      openTarget({ source: 'shared', shareSlug: 'share_1' })

      const wrapper = await mountDetail()

      await wrapper.get('[data-testid="frame-stub"]').trigger('click')

      expect(wrapper.find('[data-testid="artifact-ask-to-fix"]').exists())
        .toBe(false)
      expect(wrapper.find('[data-testid="artifact-start-new-chat"]').exists())
        .toBe(false)
    })
  })

  describe('Delete artifact', () => {
    const DELETE_TEST_ID = '[data-testid="artifact-action-delete"]'

    function respondToDelete(response: {
      deletedIds: string[]
      heldIds: string[]
    }) {
      fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/v1/artifacts/delete/bulk') {
          return response
        }

        if (/^\/api\/v1\/artifacts\/[A-Za-z0-9]+$/.test(url)) {
          return DETAIL
        }

        return versionContent(3)
      })
    }

    it('is the last action of the menu with the consequences', async () => {
      confirmMock.mockResolvedValue(null)
      openTarget()

      const wrapper = await mountDetail()
      const items = wrapper.findAll('details ul > li')

      expect(items.at(-1)?.find(DELETE_TEST_ID).exists()).toBe(true)
      expect(wrapper.get(DELETE_TEST_ID).classes()).toContain('text-error')

      await wrapper.get(DELETE_TEST_ID).trigger('click')

      expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Delete "Landing page"?',
        alert: true,
        actions: ['Delete'],
        subtitle: expect.stringContaining('active share links stop working'),
      }))
    })

    it('is hidden on a shared chat', async () => {
      useSharedArtifactVersions().value = { Art1Art1Art1Art1: [3] }
      openTarget({ source: 'shared', shareSlug: 'share_1' })

      const wrapper = await mountDetail()

      expect(wrapper.find(DELETE_TEST_ID).exists()).toBe(false)
    })

    it('does nothing when the confirmation is declined', async () => {
      confirmMock.mockResolvedValue(null)
      openTarget()

      const wrapper = await mountDetail()

      await wrapper.get(DELETE_TEST_ID).trigger('click')
      await flushPromises()

      expect(fetchMock).not.toHaveBeenCalledWith(
        '/api/v1/artifacts/delete/bulk',
        expect.anything(),
      )
      expect(useSidePanel().isOpen.value).toBe(true)
    })

    it('deletes through the bulk route, closes the panel and tells the app',
      async () => {
        const deleted = vi.fn()
        const contextChanged = vi.fn()

        useNuxtApp().hook('artifacts:deleted', deleted)
        useNuxtApp().hook('chat:context-changed', contextChanged)
        confirmMock.mockResolvedValue({ label: 'Delete', index: 0 })
        respondToDelete({ deletedIds: ['Art1Art1Art1Art1'], heldIds: [] })
        openTarget()

        const wrapper = await mountDetail()

        await wrapper.get(DELETE_TEST_ID).trigger('click')
        await flushPromises()

        expect(fetchMock).toHaveBeenCalledWith(
          '/api/v1/artifacts/delete/bulk',
          { method: 'POST', body: { ids: ['Art1Art1Art1Art1'] } },
        )
        expect(useSidePanel().isOpen.value).toBe(false)
        expect(useArtifactPanel().isDeleted('Art1Art1Art1Art1')).toBe(true)
        expect(useArtifactPanel().isUnavailable('Art1Art1Art1Art1'))
          .toBe(true)
        expect(deleted).toHaveBeenCalledWith(['Art1Art1Art1Art1'])
        expect(contextChanged).toHaveBeenCalled()
        expect(successMessageMock).toHaveBeenCalledWith('Artifact deleted')
      })

    it('hides Delete while the artifact is being written', async () => {
      openTarget({ toolCallId: 'call_1' })
      useArtifactPanel().setStream({
        toolCallId: 'call_1',
        kind: 'html',
        title: 'Landing page',
        content: '<p>',
        status: 'streaming',
      })

      const wrapper = await mountDetail()

      expect(wrapper.find(DELETE_TEST_ID).exists()).toBe(false)
    })

    it('treats an artifact that is already gone as deleted', async () => {
      confirmMock.mockResolvedValue({ label: 'Delete', index: 0 })
      fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/v1/artifacts/delete/bulk') {
          throw Object.assign(new Error('Artifact not found'), {
            status: 404,
            data: { message: 'Artifact not found' },
          })
        }

        return url.endsWith('Art1Art1Art1Art1') ? DETAIL : versionContent(3)
      })
      openTarget()

      const wrapper = await mountDetail()

      await wrapper.get(DELETE_TEST_ID).trigger('click')
      await flushPromises()

      expect(errorMessageMock).not.toHaveBeenCalled()
      expect(useSidePanel().isOpen.value).toBe(false)
      expect(useArtifactPanel().isDeleted('Art1Art1Art1Art1')).toBe(true)
    })

    it('keeps another artifact open when the panel switched meanwhile',
      async () => {
        let confirmDelete: (value: unknown) => void = () => {}

        confirmMock.mockImplementation(() => {
          return new Promise((resolve) => {
            confirmDelete = resolve
          })
        })
        respondToDelete({ deletedIds: ['Art1Art1Art1Art1'], heldIds: [] })
        openTarget()

        const wrapper = await mountDetail()

        await wrapper.get(DELETE_TEST_ID).trigger('click')
        useArtifactPanel().open({
          artifactId: 'Other1Other1Other',
          version: 1,
          kind: 'html',
          title: 'Other',
          source: 'owner',
        })
        confirmDelete({ label: 'Delete', index: 0 })
        await flushPromises()

        expect(useSidePanel().isOpen.value).toBe(true)
        expect(useArtifactPanel().state.value?.artifactId)
          .toBe('Other1Other1Other')
        expect(useArtifactPanel().isDeleted('Art1Art1Art1Art1')).toBe(true)
      })

    it('keeps the panel open when the artifact is on hold', async () => {
      confirmMock.mockResolvedValue({ label: 'Delete', index: 0 })
      respondToDelete({ deletedIds: [], heldIds: ['Art1Art1Art1Art1'] })
      openTarget()

      const wrapper = await mountDetail()

      await wrapper.get(DELETE_TEST_ID).trigger('click')
      await flushPromises()

      expect(useSidePanel().isOpen.value).toBe(true)
      expect(useArtifactPanel().isDeleted('Art1Art1Art1Art1')).toBe(false)
    })

    it('shows the error and keeps the panel open when the request fails',
      async () => {
        confirmMock.mockResolvedValue({ label: 'Delete', index: 0 })
        fetchMock.mockImplementation(async (url: string) => {
          if (url === '/api/v1/artifacts/delete/bulk') {
            throw new Error('Network down')
          }

          return url.endsWith('Art1Art1Art1Art1') ? DETAIL : versionContent(3)
        })
        openTarget()

        const wrapper = await mountDetail()

        await wrapper.get(DELETE_TEST_ID).trigger('click')
        await flushPromises()

        expect(errorMessageMock).toHaveBeenCalled()
        expect(useSidePanel().isOpen.value).toBe(true)
      })
  })

  it('downloads the source with the kind extension', async () => {
    openTarget()

    const wrapper = await mountDetail()

    await wrapper.get('[data-testid="artifact-action-download-source"]')
      .trigger('click')

    expect(downloadMock).toHaveBeenCalledWith(expect.objectContaining({
      fileName: 'Landing-page.html',
    }))
    expect(wrapper.find('[data-testid="artifact-action-download-html"]')
      .exists()).toBe(false)
  })

  it('is read-only on a shared chat with the banner and Report',
    async () => {
      useSharedArtifactVersions().value = { Art1Art1Art1Art1: [1, 3] }
      openTarget({ source: 'shared', shareSlug: 'share_1' })

      const wrapper = await mountDetail()

      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/shared/share_1/artifacts/Art1Art1Art1Art1/versions/3',
        expect.anything(),
      )
      expect(fetchMock).not.toHaveBeenCalledWith(
        '/api/v1/artifacts/Art1Art1Art1Art1',
        expect.anything(),
      )
      expect(wrapper.findAll('[data-testid="artifact-version-select"] option')
        .map(option => option.text())).toEqual(['v3', 'v1'])
      expect(wrapper.get('[data-testid="artifact-shared-banner"]').text())
        .toContain('AI-generated by a Besidka user, not reviewed by Besidka.')
      expect(wrapper.get('[data-testid="artifact-shared-banner"]').text())
        .toContain('Never enter passwords or payment details here.')
      expect(wrapper.get('[data-testid="report-stub"]').attributes())
        .toMatchObject({
          'data-share-slug': 'share_1',
          'data-artifact-id': 'Art1Art1Art1Art1',
        })

      await wrapper.get('[data-testid="frame-stub"]').trigger('click')

      expect(wrapper.find('[data-testid="artifact-runtime-error"]').exists())
        .toBe(true)
      expect(wrapper.find('[data-testid="artifact-ask-to-fix"]').exists())
        .toBe(false)
    })

  it('marks a missing artifact as unavailable', async () => {
    fetchMock.mockRejectedValue({
      statusCode: 404,
      data: { message: 'Not found' },
    })
    openTarget({ source: 'shared', shareSlug: 'share_1' })

    const wrapper = await mountDetail()

    expect(wrapper.find('[data-testid="artifact-unavailable"]').exists())
      .toBe(true)
    expect(useArtifactPanel().isUnavailable('Art1Art1Art1Art1')).toBe(true)
  })

  it('offers a retry when the version request times out', async () => {
    const timeoutError = Object.assign(new Error('timeout'), {
      name: 'TimeoutError',
    })
    let hasTimedOut = false

    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/v1/artifacts/Art1Art1Art1Art1') {
        return DETAIL
      }

      if (!hasTimedOut) {
        hasTimedOut = true

        throw Object.assign(new Error('<no response>'), {
          name: 'FetchError',
          cause: timeoutError,
        })
      }

      return versionContent(3)
    })
    openTarget()

    const wrapper = await mountDetail()

    expect(wrapper.find('[data-testid="artifact-load-error"]').text())
      .toContain('The artifact took too long to load')
    expect(wrapper.find('[data-testid="frame-stub"]').attributes(
      'data-content',
    )).toBe('')

    await wrapper.find('[data-testid="artifact-load-retry"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="artifact-load-error"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="frame-stub"]').attributes(
      'data-content',
    )).toBe('<p>v3</p>')
  })

  it('streams react source in the Code tab, then previews the stored '
    + 'version', async () => {
    useArtifactPanel().open({
      artifactId: null,
      version: null,
      kind: 'react',
      title: 'Counter',
      source: 'owner',
      toolCallId: 'call_1',
    })
    useArtifactPanel().setStream({
      toolCallId: 'call_1',
      kind: 'react',
      title: 'Counter',
      content: 'export default function App',
      status: 'streaming',
    })

    const wrapper = await mountDetail()

    expect(wrapper.get('[data-testid="artifact-tab-code"]').classes())
      .toContain('tab-active')
    expect(wrapper.get('[data-testid="code-stub"]').text())
      .toBe('export default function App')
    expect(wrapper.get('[data-testid="frame-stub"]').attributes('data-partial'))
      .toBe('')

    useArtifactPanel().updateTarget('artifact:call:call_1', {
      artifactId: 'Art1Art1Art1Art1',
      version: 1,
    })
    useArtifactPanel().setStream({
      toolCallId: 'call_1',
      kind: 'react',
      title: 'Counter',
      content: 'export default function App() {}',
      status: 'done',
    })
    await flushPromises()

    expect(wrapper.get('[data-testid="artifact-tab-preview"]').classes())
      .toContain('tab-active')
    expect(wrapper.get('[data-testid="frame-stub"]').attributes('data-content'))
      .toBe('<p>v1</p>')
    expect(frameMounts.count).toBe(1)
  })

  it('previews html while it streams', async () => {
    useArtifactPanel().open({
      artifactId: null,
      version: null,
      kind: 'html',
      title: 'Page',
      source: 'owner',
      toolCallId: 'call_2',
    })
    useArtifactPanel().setStream({
      toolCallId: 'call_2',
      kind: 'html',
      title: 'Page',
      content: '<h1>Hel',
      status: 'streaming',
    })

    const wrapper = await mountDetail()

    expect(wrapper.get('[data-testid="artifact-tab-preview"]').classes())
      .toContain('tab-active')
    expect(wrapper.get('[data-testid="frame-stub"]').attributes('data-partial'))
      .toBe('<h1>Hel')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not refetch when the open target is set again unchanged',
    async () => {
      openTarget({ toolCallId: 'call_3' })

      const wrapper = await mountDetail()
      const callsBefore = fetchMock.mock.calls.length

      useArtifactPanel().updateTarget('artifact:call:call_3', {
        artifactId: 'Art1Art1Art1Art1',
        version: 3,
        kind: 'html',
        title: 'Landing page',
      })
      useArtifactPanel().state.value = {
        ...useArtifactPanel().state.value!,
      }
      await flushPromises()

      expect(fetchMock.mock.calls.length).toBe(callsBefore)
      expect(frameMounts.count).toBe(1)
      expect(wrapper.get('[data-testid="frame-stub"]')
        .attributes('data-content')).toBe('<p>v3</p>')
    })

  it('shows a failed generation as an error in both tabs', async () => {
    useArtifactPanel().open({
      artifactId: null,
      version: null,
      kind: 'html',
      title: 'Page',
      source: 'owner',
      toolCallId: 'call_4',
    })
    useArtifactPanel().setStream({
      toolCallId: 'call_4',
      kind: 'html',
      title: 'Page',
      content: '<h1>Hel',
      status: 'failed',
      errorText: 'The artifact is too large.',
    })

    const wrapper = await mountDetail()
    const alert = wrapper.get('[data-testid="artifact-stream-error"]')

    expect(alert.classes()).toEqual(
      expect.arrayContaining(['alert', 'alert-error', 'alert-soft']),
    )
    expect(alert.text()).toContain('The artifact is too large.')

    await wrapper.get('[data-testid="artifact-tab-code"]').trigger('click')

    expect(wrapper.get('[data-testid="artifact-stream-error"]').text())
      .toContain('The artifact is too large.')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('ChatArtifactDetail saved progress', () => {
  const RESET_ITEM = '[data-testid="artifact-action-reset-storage"]'

  async function emitStorage(
    wrapper: Awaited<ReturnType<typeof mountDetail>>,
    kind: 'frame-storage-stub' | 'frame-storage-memory-stub'
      | 'frame-storage-empty-stub' = 'frame-storage-stub',
  ) {
    await wrapper.get(`[data-testid="${kind}"]`).trigger('click')
    await flushPromises()
  }

  it('passes the panel source to the frame', async () => {
    openTarget()

    const owner = await mountDetail()

    expect(owner.get('[data-testid="frame-stub"]').attributes('data-source'))
      .toBe('owner')

    resetState()
    useSharedArtifactVersions().value = { Art1Art1Art1Art1: [1, 3] }
    openTarget({ source: 'shared', shareSlug: 'share_1' })

    const shared = await mountDetail()

    expect(shared.get('[data-testid="frame-stub"]').attributes('data-source'))
      .toBe('shared')
  })

  it('hides Reset saved progress until the frame reports saved keys',
    async () => {
      openTarget()

      const wrapper = await mountDetail()

      expect(wrapper.find(RESET_ITEM).exists()).toBe(false)
    })

  it('shows Reset saved progress for persistent storage with keys',
    async () => {
      openTarget()

      const wrapper = await mountDetail()

      await emitStorage(wrapper)

      expect(wrapper.get(RESET_ITEM).text()).toBe('Reset saved progress')
    })

  it('hides it when persistent storage holds no keys', async () => {
    openTarget()

    const wrapper = await mountDetail()

    await emitStorage(wrapper)
    expect(wrapper.find(RESET_ITEM).exists()).toBe(true)

    await emitStorage(wrapper, 'frame-storage-empty-stub')
    expect(wrapper.find(RESET_ITEM).exists()).toBe(false)
  })

  it('hides it when the frame runs in memory mode', async () => {
    openTarget()

    const wrapper = await mountDetail()

    await emitStorage(wrapper)
    await emitStorage(wrapper, 'frame-storage-memory-stub')

    expect(wrapper.find(RESET_ITEM).exists()).toBe(false)
  })

  it('never offers it on a shared chat', async () => {
    useSharedArtifactVersions().value = { Art1Art1Art1Art1: [1, 3] }
    openTarget({ source: 'shared', shareSlug: 'share_1' })

    const wrapper = await mountDetail()

    await emitStorage(wrapper)

    expect(wrapper.find(RESET_ITEM).exists()).toBe(false)
  })

  it('resets after confirmation, remounts the frame and hides the item',
    async () => {
      confirmMock.mockResolvedValue({ label: 'Reset progress' })
      resetStorageMock.mockResolvedValue(undefined)
      openTarget()

      const wrapper = await mountDetail()

      await emitStorage(wrapper)
      expect(frameMounts.count).toBe(1)

      await wrapper.get(RESET_ITEM).trigger('click')
      await flushPromises()

      expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Reset saved progress?',
        alert: true,
        actions: ['Reset progress'],
        labelDecline: 'Cancel',
      }))
      expect(resetStorageMock).toHaveBeenCalledTimes(1)
      expect(resetStorageMock).toHaveBeenCalledWith('Art1Art1Art1Art1')
      expect(frameMounts.count).toBe(2)
      expect(wrapper.find(RESET_ITEM).exists()).toBe(false)
      expect(successMessageMock).toHaveBeenCalledWith('Saved progress reset')
      expect(errorMessageMock).not.toHaveBeenCalled()
    })

  it('does nothing when the confirmation is dismissed', async () => {
    confirmMock.mockResolvedValue(null)
    openTarget()

    const wrapper = await mountDetail()

    await emitStorage(wrapper)
    await wrapper.get(RESET_ITEM).trigger('click')
    await flushPromises()

    expect(confirmMock).toHaveBeenCalledTimes(1)
    expect(resetStorageMock).not.toHaveBeenCalled()
    expect(frameMounts.count).toBe(1)
    expect(wrapper.find(RESET_ITEM).exists()).toBe(true)
    expect(successMessageMock).not.toHaveBeenCalled()
  })

  it('does nothing when the user picks Cancel', async () => {
    confirmMock.mockResolvedValue({ label: 'Cancel' })
    openTarget()

    const wrapper = await mountDetail()

    await emitStorage(wrapper)
    await wrapper.get(RESET_ITEM).trigger('click')
    await flushPromises()

    expect(resetStorageMock).not.toHaveBeenCalled()
    expect(frameMounts.count).toBe(1)
  })

  it('remounts the frame at once, before the reset has settled',
    async () => {
      let finishReset: () => void = () => {}

      confirmMock.mockResolvedValue({ label: 'Reset progress' })
      resetStorageMock.mockReturnValue(new Promise<void>((resolve) => {
        finishReset = resolve
      }))
      openTarget()

      const wrapper = await mountDetail()

      await emitStorage(wrapper)
      await wrapper.get(RESET_ITEM).trigger('click')
      await flushPromises()

      expect(resetStorageMock).toHaveBeenCalledTimes(1)
      expect(frameMounts.count).toBe(2)
      expect(successMessageMock).not.toHaveBeenCalled()
      expect(wrapper.find(RESET_ITEM).exists()).toBe(true)

      finishReset()
      await flushPromises()

      expect(frameMounts.count).toBe(2)
      expect(successMessageMock).toHaveBeenCalledWith('Saved progress reset')
      expect(wrapper.find(RESET_ITEM).exists()).toBe(false)
    })

  it('has already remounted the frame and shows the error when the '
    + 'reset fails', async () => {
    confirmMock.mockResolvedValue({ label: 'Reset progress' })
    resetStorageMock.mockRejectedValue(new Error('Reset failed'))
    openTarget()

    const wrapper = await mountDetail()

    await emitStorage(wrapper)
    await wrapper.get(RESET_ITEM).trigger('click')
    await flushPromises()

    expect(resetStorageMock).toHaveBeenCalledTimes(1)
    expect(errorMessageMock).toHaveBeenCalledWith(
      'Reset failed',
      undefined,
    )
    expect(successMessageMock).not.toHaveBeenCalled()
    expect(frameMounts.count).toBe(2)
    expect(wrapper.find(RESET_ITEM).exists()).toBe(true)
  })
})

describe('ChatArtifactDetail share link', () => {
  const SHARE_ITEM = '[data-testid="artifact-action-share"]'

  it('is hidden without the artifacts.share flag', async () => {
    openTarget()

    const wrapper = await mountDetail()

    expect(wrapper.find(SHARE_ITEM).exists()).toBe(false)
  })

  it('is hidden for a shared chat even with the flag', async () => {
    shareFeature.value = { enabled: true, active: true, variant: null }
    useSharedArtifactVersions().value = { Art1Art1Art1Art1: [3] }
    openTarget({ source: 'shared', shareSlug: 'share_1' })

    const wrapper = await mountDetail()

    expect(wrapper.find(SHARE_ITEM).exists()).toBe(false)
  })

  it('opens the share modal for the owner with the current version',
    async () => {
      shareFeature.value = { enabled: true, active: true, variant: null }
      openTarget({ version: 1 })

      const wrapper = await mountDetail()

      expect(wrapper.find('[data-testid="share-modal-stub"]').exists())
        .toBe(false)

      await wrapper.get(SHARE_ITEM).trigger('click')
      await flushPromises()

      const modal = wrapper.get('[data-testid="share-modal-stub"]')

      expect(modal.attributes('data-open')).toBe('true')
      expect(modal.attributes('data-artifact-id')).toBe('Art1Art1Art1Art1')
      expect(modal.attributes('data-current-version')).toBe('3')
    })
})

describe('ChatArtifactDetail new version written in the chat', () => {
  it('refreshes the list and switches to the new version', async () => {
    openTarget()

    const wrapper = await mountDetail()

    respond(DETAIL_WITH_V4)
    useArtifactPanel().noteVersion('Art1Art1Art1Art1', 4)
    await flushPromises()

    const options = wrapper.findAll(
      '[data-testid="artifact-version-select"] option',
    )

    expect(options.map(option => option.text()))
      .toEqual(['v4', 'v3', 'v2', 'v1'])
    expect(useArtifactPanel().state.value?.version).toBe(4)
    expect(wrapper.get('[data-testid="frame-stub"]').attributes('data-content'))
      .toBe('<p>v4</p>')
    expect(wrapper.find('[data-testid="artifact-newer-version"]').exists())
      .toBe(false)
  })

  it('keeps an explicitly chosen older version and offers the new one',
    async () => {
      openTarget()

      const wrapper = await mountDetail()

      await wrapper.get('[data-testid="artifact-version-select"]')
        .setValue('2')
      await flushPromises()

      respond(DETAIL_WITH_V4)
      useArtifactPanel().noteVersion('Art1Art1Art1Art1', 4)
      await flushPromises()

      const offer = wrapper.get('[data-testid="artifact-newer-version"]')

      expect(useArtifactPanel().state.value?.version).toBe(2)
      expect(offer.text()).toContain('v4')

      await offer.trigger('click')
      await flushPromises()

      expect(useArtifactPanel().state.value?.version).toBe(4)
      expect(wrapper.find('[data-testid="artifact-newer-version"]').exists())
        .toBe(false)
    })

  it('treats an older card opened after a newer version as a choice',
    async () => {
      useArtifactPanel().noteVersion('Art1Art1Art1Art1', 4)
      respond(DETAIL_WITH_V4)
      openTarget()

      const wrapper = await mountDetail()

      expect(wrapper.get('[data-testid="artifact-newer-version"]').text())
        .toContain('v4')
    })

  it('ignores a version of another artifact', async () => {
    openTarget()

    await mountDetail()

    fetchMock.mockClear()
    useArtifactPanel().noteVersion('Other0Other0Other', 9)
    await flushPromises()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(useArtifactPanel().state.value?.version).toBe(3)
  })
})

describe('ChatArtifactDetail actions menu', () => {
  async function openMenu() {
    openTarget()

    const wrapper = await mountDetail()
    const menu = wrapper.get('details.dropdown').element as HTMLDetailsElement

    menu.open = true

    return { wrapper, menu }
  }

  it('closes on a pointer press outside', async () => {
    const { menu } = await openMenu()

    document.body.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true }),
    )
    document.body.click()
    await flushPromises()

    expect(menu.open).toBe(false)
  })

  it('closes when focus moves into an iframe', async () => {
    const { menu } = await openMenu()
    const iframe = document.createElement('iframe')

    iframe.tabIndex = 0
    document.body.appendChild(iframe)
    iframe.focus()
    window.dispatchEvent(new Event('blur'))
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })

    expect(menu.open).toBe(false)
    iframe.remove()
  })

  it('closes when Tab moves focus out of the menu', async () => {
    const { wrapper, menu } = await openMenu()
    const outside = document.createElement('button')

    document.body.appendChild(outside)
    wrapper.get('details.dropdown').element.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }),
    )

    expect(menu.open).toBe(false)
    outside.remove()
  })

  it('stays open while focus moves between items of the menu', async () => {
    const { wrapper, menu } = await openMenu()
    const item = wrapper.get('details.dropdown button').element

    wrapper.get('details.dropdown summary').element.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: item }),
    )
    wrapper.get('details.dropdown').element.dispatchEvent(
      new FocusEvent('focusout', { bubbles: true, relatedTarget: null }),
    )

    expect(menu.open).toBe(true)
  })

  it('closes on Escape and returns focus to the trigger', async () => {
    const { wrapper, menu } = await openMenu()

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    })

    wrapper.get('details.dropdown').element.dispatchEvent(event)

    expect(menu.open).toBe(false)
    expect(event.defaultPrevented).toBe(true)
  })

  it('closes when the version changes or the tab switches', async () => {
    const { wrapper, menu } = await openMenu()

    await wrapper.get('[data-testid="artifact-version-select"]')
      .setValue('1')
    expect(menu.open).toBe(false)

    menu.open = true
    await wrapper.get('[data-testid="artifact-tab-code"]').trigger('click')
    expect(menu.open).toBe(false)
  })
})

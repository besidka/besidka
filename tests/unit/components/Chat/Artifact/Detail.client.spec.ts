import {
  mockComponent,
  mockNuxtImport,
  mountSuspended,
} from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
} = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  downloadMock: vi.fn(),
  layout: { value: 'docked' as 'docked' | 'overlay' | 'sheet' },
  frameMounts: { count: 0 },
  confirmMock: vi.fn(),
  resetStorageMock: vi.fn(),
  successMessageMock: vi.fn(),
  errorMessageMock: vi.fn(),
}))

mockNuxtImport('$fetch', () => fetchMock)

mockNuxtImport('useConfirm', () => confirmMock)

mockNuxtImport('useSuccessMessage', () => successMessageMock)

mockNuxtImport('useErrorMessage', () => errorMessageMock)

mockNuxtImport('useSidePanelLayout', () => {
  return () => layout
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

mockComponent('ProsePreStream', () => {
  return {
    props: {
      code: String,
      language: String,
      sourceOnly: Boolean,
      alwaysExpanded: Boolean,
    },
    template: `
      <pre
        data-testid="code-stub"
        :data-language="language"
        :data-source-only="String(sourceOnly)"
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

function respond() {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === '/api/v1/artifacts/Art1Art1Art1Art1') {
      return DETAIL
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
  useSharedArtifactVersions().value = {}
}

beforeEach(() => {
  resetState()
  fetchMock.mockReset()
  downloadMock.mockReset()
  confirmMock.mockReset()
  resetStorageMock.mockReset()
  successMessageMock.mockReset()
  errorMessageMock.mockReset()
  frameMounts.count = 0
  layout.value = 'docked'
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

  it('shows the exact stored source in the Code tab', async () => {
    openTarget()

    const wrapper = await mountDetail()

    await wrapper.get('[data-testid="artifact-tab-code"]').trigger('click')
    await flushPromises()

    const code = wrapper.get('[data-testid="code-stub"]')

    expect(code.text()).toBe('<p>v3</p>')
    expect(code.attributes('data-language')).toBe('html')
    expect(code.attributes('data-source-only')).toBe('true')
    expect(wrapper.get('[data-testid="frame-stub"]').element.parentElement
      ?.style.display).toBe('none')
  })

  it('prefills the composer to fix a runtime error and never sends',
    async () => {
      const prefill = vi.fn()
      const submit = vi.fn()

      useNuxtApp().hook('chat-input:prefill', prefill)
      useNuxtApp().hook('chat:submit', submit)
      openTarget()

      const wrapper = await mountDetail()

      await wrapper.get('[data-testid="frame-stub"]').trigger('click')

      const alert = wrapper.get('[data-testid="artifact-runtime-error"]')

      expect(alert.text()).toContain('ReferenceError: x is not defined')

      await wrapper.get('[data-testid="artifact-ask-to-fix"]').trigger('click')
      await flushPromises()

      expect(prefill).toHaveBeenCalledWith(
        'Fix the error in "Landing page": ReferenceError: x is not defined',
      )
      expect(submit).not.toHaveBeenCalled()
      expect(useSidePanel().isOpen.value).toBe(true)
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

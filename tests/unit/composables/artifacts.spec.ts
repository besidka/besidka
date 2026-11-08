import { ref } from 'vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARTIFACT_AUTO_OPEN_STORAGE_PREFIX,
  getArtifactAutoOpenKey,
  getArtifactVersionUrl,
  getArtifactViewKey,
  hasArtifactAutoOpened,
  loadArtifactVersion,
  markArtifactAutoOpened,
  useArtifactAutoOpen,
  useArtifactPanel,
} from '../../../app/composables/artifacts'
import type { ArtifactPanelTarget } from '../../../app/composables/artifacts'
import { useSidePanel } from '../../../app/composables/side-panel'

const { fetchMock, errorMessageMock, featureState, isLarge } = vi.hoisted(
  () => ({
    fetchMock: vi.fn(),
    errorMessageMock: vi.fn(),
    featureState: { enabled: true, active: true, variant: null },
    isLarge: { value: true },
  }),
)

mockNuxtImport('$fetch', () => fetchMock)

mockNuxtImport('useErrorMessage', () => errorMessageMock)

mockNuxtImport('useFeature', () => {
  return () => ref(featureState)
})

mockNuxtImport('useMediaQuery', () => {
  return () => isLarge
})

const CHAT_ID = 'chat_01'

function target(
  overrides: Partial<ArtifactPanelTarget> = {},
): ArtifactPanelTarget {
  return {
    artifactId: null,
    version: null,
    kind: 'html',
    title: 'Landing page',
    source: 'owner',
    toolCallId: 'call_1',
    ...overrides,
  }
}

function storedKeys(): string[] {
  return Object.keys(window.sessionStorage)
}

function resetState() {
  useSidePanel().close()
  useArtifactPanel().state.value = null
  useArtifactPanel().stream.value = null
  window.sessionStorage.clear()
}

beforeEach(() => {
  resetState()
  featureState.active = true
  isLarge.value = true
  fetchMock.mockReset()
  errorMessageMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetState()
})

describe('auto-open marker', () => {
  it('uses exactly the key named in the Cookie Policy', () => {
    expect(ARTIFACT_AUTO_OPEN_STORAGE_PREFIX).toBe('artifacts:auto-opened:')
    expect(getArtifactAutoOpenKey(CHAT_ID))
      .toBe('artifacts:auto-opened:chat_01')
  })

  it('writes a marker, never artifact data, to sessionStorage', () => {
    expect(hasArtifactAutoOpened(CHAT_ID)).toBe(false)
    expect(markArtifactAutoOpened(CHAT_ID)).toBe(true)
    expect(window.sessionStorage.getItem('artifacts:auto-opened:chat_01'))
      .toBe('1')
    expect(window.localStorage.getItem('artifacts:auto-opened:chat_01'))
      .toBeNull()
    expect(hasArtifactAutoOpened(CHAT_ID)).toBe(true)
  })

  it('treats unavailable storage as already opened', () => {
    const original = window.sessionStorage
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }

    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      value: blocked,
    })

    try {
      expect(hasArtifactAutoOpened(CHAT_ID)).toBe(true)
      expect(markArtifactAutoOpened(CHAT_ID)).toBe(false)
    } finally {
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: original,
      })
    }
  })
})

describe('useArtifactAutoOpen', () => {
  it('opens the first streaming artifact once per chat', () => {
    const { tryAutoOpen } = useArtifactAutoOpen()
    const sidePanel = useSidePanel()

    expect(tryAutoOpen(CHAT_ID, target())).toBe(true)
    expect(sidePanel.viewKey.value).toBe('artifact:call:call_1')
    expect(window.sessionStorage.getItem(getArtifactAutoOpenKey(CHAT_ID)))
      .toBe('1')

    sidePanel.close()

    expect(tryAutoOpen(CHAT_ID, target({ toolCallId: 'call_2' }))).toBe(false)
    expect(sidePanel.isOpen.value).toBe(false)
  })

  it('never opens below lg and writes nothing there', () => {
    isLarge.value = false

    const { tryAutoOpen } = useArtifactAutoOpen()

    expect(tryAutoOpen(CHAT_ID, target())).toBe(false)
    expect(storedKeys()).toEqual([])
  })

  it('writes nothing when artifacts are not available to the account', () => {
    featureState.active = false

    const { tryAutoOpen } = useArtifactAutoOpen()

    expect(tryAutoOpen(CHAT_ID, target())).toBe(false)
    expect(storedKeys()).toEqual([])
  })

  it('does not replace a view the user opened', () => {
    useSidePanel().open({ viewKey: 'chat-context', title: 'Chat' })

    const { tryAutoOpen } = useArtifactAutoOpen()

    expect(tryAutoOpen(CHAT_ID, target())).toBe(false)
    expect(useSidePanel().viewKey.value).toBe('chat-context')
    expect(storedKeys()).toEqual([])
  })

  it('never auto-opens on a shared chat', () => {
    const { tryAutoOpen } = useArtifactAutoOpen()

    expect(tryAutoOpen(CHAT_ID, target({ source: 'shared' }))).toBe(false)
    expect(storedKeys()).toEqual([])
  })
})

describe('useArtifactPanel', () => {
  it('opens a detail view keyed by the tool call', () => {
    const panel = useArtifactPanel()
    const sidePanel = useSidePanel()

    panel.open(target())

    expect(panel.state.value).toMatchObject({
      viewKey: 'artifact:call:call_1',
      title: 'Landing page',
    })
    expect(sidePanel.currentView.value).toMatchObject({
      viewKey: 'artifact:call:call_1',
      title: 'Landing page',
      mode: 'detail',
    })
    expect(panel.isOpen.value).toBe(true)
  })

  it('pushes over the context view so Back returns to it', () => {
    const panel = useArtifactPanel()
    const sidePanel = useSidePanel()

    sidePanel.open({ viewKey: 'chat-context', title: 'Chat' })
    panel.open(target({ artifactId: 'art_1', toolCallId: undefined }), {
      push: true,
    })

    expect(sidePanel.stack.value.map(view => view.viewKey))
      .toEqual(['chat-context', 'artifact:art_1'])

    sidePanel.back()

    expect(sidePanel.viewKey.value).toBe('chat-context')
  })

  it('updates the target in place and keeps the view key', () => {
    const panel = useArtifactPanel()
    const sidePanel = useSidePanel()

    panel.open(target({ title: '' }))

    const viewKey = getArtifactViewKey(target())

    panel.updateTarget(viewKey, {
      artifactId: 'art_1',
      version: 1,
      title: 'Final title',
    })

    expect(panel.state.value).toMatchObject({
      viewKey,
      artifactId: 'art_1',
      version: 1,
    })
    expect(sidePanel.stack.value).toHaveLength(1)
    expect(sidePanel.title.value).toBe('Final title')
  })

  it('ignores updates for another view', () => {
    const panel = useArtifactPanel()

    panel.open(target())
    panel.updateTarget('artifact:other', { version: 9 })

    expect(panel.state.value?.version).toBeNull()
  })

  it('tracks unavailable artifacts', () => {
    const panel = useArtifactPanel()

    panel.markUnavailable('art_gone')

    expect(panel.isUnavailable('art_gone')).toBe(true)
    expect(panel.isUnavailable('constructor')).toBe(false)
  })
})

describe('loadArtifactVersion', () => {
  it('builds owner and shared URLs', () => {
    expect(getArtifactVersionUrl({
      artifactId: 'art_1',
      version: 2,
      source: 'owner',
    })).toBe('/api/v1/artifacts/art_1/versions/2')
    expect(getArtifactVersionUrl({
      artifactId: 'art 1',
      version: 2,
      source: 'shared',
      shareSlug: 'share_1',
    })).toBe('/api/v1/shared/share_1/artifacts/art%201/versions/2')
  })

  it('returns the version content', async () => {
    const content = { artifactId: 'art_1', version: 2, content: '<p>x</p>' }

    fetchMock.mockResolvedValueOnce(content)

    const result = await loadArtifactVersion({
      artifactId: 'art_1',
      version: 2,
      source: 'owner',
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/artifacts/art_1/versions/2')
    expect(result).toEqual({ ok: true, value: content })
  })

  it('reports unexpected failures through a toast', async () => {
    fetchMock.mockRejectedValueOnce({
      statusCode: 500,
      data: { message: 'Storage failed', why: 'R2 down' },
    })

    const result = await loadArtifactVersion({
      artifactId: 'art_1',
      version: 2,
      source: 'owner',
    })

    expect(result.ok).toBe(false)
    expect(errorMessageMock).toHaveBeenCalledTimes(1)
  })

  it('stays quiet for unavailable artifacts', async () => {
    fetchMock.mockRejectedValueOnce({
      statusCode: 404,
      data: { message: 'Artifact not found' },
    })

    const result = await loadArtifactVersion({
      artifactId: 'art_1',
      version: 2,
      source: 'shared',
      shareSlug: 'share_1',
    })

    expect(result).toMatchObject({ ok: false, status: 404 })
    expect(errorMessageMock).not.toHaveBeenCalled()
  })
})

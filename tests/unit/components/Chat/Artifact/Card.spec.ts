import { ref } from 'vue'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ChatArtifactCard from '../../../../../app/components/Chat/Artifact/Card.vue'
import { useArtifactPanel } from '../../../../../app/composables/artifacts'
import { useSidePanel } from '../../../../../app/composables/side-panel'

enableAutoUnmount(afterEach)

const { featureState, isLarge } = vi.hoisted(() => ({
  featureState: { enabled: true, active: true, variant: null },
  isLarge: { value: true },
}))

mockNuxtImport('useFeature', () => {
  return () => ref(featureState)
})

mockNuxtImport('useMediaQuery', () => {
  return () => isLarge
})

const READY_PART = {
  type: 'data-artifact',
  data: {
    artifactId: 'art_1',
    version: 2,
    kind: 'html',
    title: 'Landing page',
  },
}

function streamingPart(input?: Record<string, unknown>) {
  return {
    type: 'tool-create_artifact',
    toolCallId: 'call_1',
    state: 'input-streaming',
    ...(input ? { input } : {}),
  }
}

function resetState() {
  useSidePanel().close()
  useArtifactPanel().state.value = null
  useArtifactPanel().stream.value = null
  window.sessionStorage.clear()
}

beforeEach(() => {
  resetState()
  isLarge.value = true
  featureState.active = true
})

afterEach(resetState)

describe('ChatArtifactCard', () => {
  it('renders a ready artifact as one button with badges', async () => {
    const wrapper = await mountSuspended(ChatArtifactCard, {
      props: { part: READY_PART, source: 'owner' },
    })
    const card = wrapper.get('[data-testid="artifact-card"]')

    expect(card.element.tagName).toBe('BUTTON')
    expect(card.classes()).toContain('js-artifact-card')
    expect(card.attributes('aria-label')).toBe('Open Landing page')
    expect(card.attributes('data-state')).toBe('ready')
    expect(wrapper.get('[data-testid="artifact-card-kind"]').classes())
      .toEqual(expect.arrayContaining(['badge', 'badge-soft', 'badge-sm']))
    expect(wrapper.get('[data-testid="artifact-card-kind"]').text())
      .toBe('HTML')
    expect(wrapper.get('[data-testid="artifact-card-version"]').text())
      .toBe('v2')
    expect(wrapper.get('.badge-ghost').text()).toBe('AI-generated')
    expect(card.findAll('button')).toHaveLength(0)
  })

  it('opens the detail panel on click', async () => {
    const wrapper = await mountSuspended(ChatArtifactCard, {
      props: { part: READY_PART, source: 'shared', shareSlug: 'share_1' },
    })

    await wrapper.get('[data-testid="artifact-card"]').trigger('click')

    expect(useSidePanel().viewKey.value).toBe('artifact:art_1')
    expect(useArtifactPanel().state.value).toMatchObject({
      artifactId: 'art_1',
      version: 2,
      source: 'shared',
      shareSlug: 'share_1',
    })
  })

  it('shows an honest streaming state before any input arrives', async () => {
    const wrapper = await mountSuspended(ChatArtifactCard, {
      props: { part: streamingPart(), source: 'shared' },
    })
    const card = wrapper.get('[data-testid="artifact-card"]')

    expect(card.attributes('data-state')).toBe('streaming')
    expect(card.attributes('aria-label')).toBe('Open Writing artifact…')
    expect(wrapper.find('[data-testid="artifact-card-progress"]').exists())
      .toBe(true)
    expect(wrapper.text()).not.toMatch(/%/)
  })

  it('counts the streamed lines', async () => {
    const wrapper = await mountSuspended(ChatArtifactCard, {
      props: {
        part: streamingPart({
          kind: 'svg',
          title: 'Logo',
          content: '<svg>\n<g/>\n</svg>',
        }),
        source: 'shared',
      },
    })

    expect(wrapper.get('[data-testid="artifact-card-title"]').text())
      .toBe('Logo')
    expect(wrapper.get('[data-testid="artifact-card-lines"]').text())
      .toBe('3 lines')
  })

  it('renders a failed call as an error alert', async () => {
    const wrapper = await mountSuspended(ChatArtifactCard, {
      props: {
        part: {
          type: 'tool-create_artifact',
          toolCallId: 'call_2',
          state: 'output-error',
          input: { kind: 'html', title: 'Broken' },
          errorText: 'The artifact is too large.',
        },
        source: 'owner',
      },
    })
    const alert = wrapper.get('[data-testid="artifact-card-failed"]')

    expect(alert.classes()).toEqual(
      expect.arrayContaining(['alert', 'alert-error', 'alert-soft']),
    )
    expect(alert.text()).toContain('The artifact is too large.')
    expect(wrapper.find('[data-testid="artifact-card"]').exists()).toBe(false)
  })

  it('shows unavailable artifacts as muted text', async () => {
    useArtifactPanel().markUnavailable('art_1')

    const wrapper = await mountSuspended(ChatArtifactCard, {
      props: { part: READY_PART, source: 'owner' },
    })

    expect(wrapper.get('[data-testid="artifact-card-unavailable"]').text())
      .toContain('Artifact unavailable')
    expect(wrapper.find('[data-testid="artifact-card"]').exists()).toBe(false)
  })

  it('auto-opens the first streaming artifact on the owner page', async () => {
    await mountSuspended(ChatArtifactCard, {
      props: {
        part: streamingPart({ kind: 'html', title: 'Page' }),
        source: 'owner',
        chatId: 'chat_1',
      },
    })

    expect(useSidePanel().viewKey.value).toBe('artifact:call:call_1')
    expect(window.sessionStorage.getItem('artifacts:auto-opened:chat_1'))
      .toBe('1')
    expect(useArtifactPanel().stream.value).toMatchObject({
      toolCallId: 'call_1',
      status: 'streaming',
    })
  })

  it('does not auto-open below lg or on persisted parts', async () => {
    isLarge.value = false

    await mountSuspended(ChatArtifactCard, {
      props: {
        part: streamingPart({ kind: 'html', title: 'Page' }),
        source: 'owner',
        chatId: 'chat_1',
      },
    })

    isLarge.value = true

    await mountSuspended(ChatArtifactCard, {
      props: { part: READY_PART, source: 'owner', chatId: 'chat_2' },
    })

    expect(useSidePanel().isOpen.value).toBe(false)
    expect(Object.keys(window.sessionStorage)).toEqual([])
  })

  it('moves the open view from the stream to the stored version',
    async () => {
      const wrapper = await mountSuspended(ChatArtifactCard, {
        props: {
          part: streamingPart({ kind: 'html', title: 'Page', content: '<p>' }),
          source: 'owner',
          chatId: 'chat_1',
        },
      })

      await wrapper.setProps({
        part: {
          type: 'tool-create_artifact',
          toolCallId: 'call_1',
          state: 'output-available',
          input: { kind: 'html', title: 'Page', content: '<p>x</p>' },
          output: {
            artifactId: 'art_9',
            version: 1,
            kind: 'html',
            title: 'Page',
          },
        },
      })

      expect(useSidePanel().viewKey.value).toBe('artifact:call:call_1')
      expect(useArtifactPanel().state.value).toMatchObject({
        artifactId: 'art_9',
        version: 1,
      })
      expect(useArtifactPanel().stream.value?.status).toBe('done')
    })
})

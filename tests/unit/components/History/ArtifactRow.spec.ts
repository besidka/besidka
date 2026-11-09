import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { ArtifactSummary } from '../../../../shared/utils/artifacts'
import HistoryArtifactRow from '../../../../app/components/History/ArtifactRow.vue'

enableAutoUnmount(afterEach)

function createArtifact(
  overrides: Partial<ArtifactSummary> = {},
): ArtifactSummary {
  return {
    id: 'ArtifactPublicId01',
    title: 'Photosynthesis quiz',
    kind: 'html',
    currentVersion: 1,
    versionCount: 1,
    updatedAt: '2026-11-09T08:00:00.000Z',
    originChatSlug: 'chat-slug',
    originChatTitle: 'Biology help',
    createdVia: 'chat',
    activeShareCount: 0,
    takenDown: false,
    ...overrides,
  }
}

function mountRow(
  artifact: ArtifactSummary,
  props: {
    isSelectionMode?: boolean
    isSelected?: boolean
    canShare?: boolean
  } = {},
) {
  return mountSuspended(HistoryArtifactRow, {
    props: {
      artifact,
      isSelectionMode: false,
      isSelected: false,
      index: 2,
      ...props,
    },
    global: {
      stubs: {
        UiLocalDate: true,
        NuxtLink: {
          props: ['to'],
          template: '<a :href="to"><slot /></a>',
        },
      },
    },
  })
}

function testId(id: string) {
  return `[data-testid="${id}"]`
}

describe('History/ArtifactRow', () => {
  it('shows the title, kind badge and version', async () => {
    const wrapper = await mountRow(createArtifact({
      kind: 'mermaid',
      currentVersion: 3,
      versionCount: 3,
    }))

    expect(wrapper.get(testId('artifact-row-open')).text())
      .toBe('Photosynthesis quiz')

    const kind = wrapper.get(testId('artifact-row-kind'))

    expect(kind.text()).toBe('Mermaid')
    expect(kind.classes()).toEqual(
      expect.arrayContaining(['badge', 'badge-soft', 'badge-sm']),
    )
    expect(wrapper.get(testId('artifact-row-version')).text())
      .toBe('v3 · 3 versions')
  })

  it('shows only the version number for a single version', async () => {
    const wrapper = await mountRow(createArtifact())

    expect(wrapper.get(testId('artifact-row-version')).text()).toBe('v1')
  })

  it('links the origin chat by its title', async () => {
    const wrapper = await mountRow(createArtifact())
    const link = wrapper.get(testId('artifact-row-origin-link'))

    expect(link.text()).toBe('Biology help')
    expect(link.attributes('href')).toBe('/chats/chat-slug')
  })

  it('falls back to Untitled chat for a chat without a title', async () => {
    const wrapper = await mountRow(createArtifact({ originChatTitle: null }))

    expect(wrapper.get(testId('artifact-row-origin-link')).text())
      .toBe('Untitled chat')
  })

  it('labels an artifact whose chat is gone, without a link', async () => {
    const wrapper = await mountRow(createArtifact({
      originChatSlug: null,
      originChatTitle: null,
    }))

    expect(wrapper.get(testId('artifact-row-origin')).text())
      .toBe('Chat deleted')
    expect(wrapper.find(testId('artifact-row-origin-link')).exists())
      .toBe(false)
    expect(wrapper.find(testId('artifact-action-open-chat')).exists())
      .toBe(false)
  })

  it('labels a connected-app artifact and never says the chat is deleted',
    async () => {
      const wrapper = await mountRow(createArtifact({
        createdVia: 'mcp',
        originChatSlug: null,
        originChatTitle: null,
      }))

      expect(wrapper.get(testId('artifact-row-origin')).text())
        .toBe('Created by a connected app')
      expect(wrapper.text()).not.toContain('Chat deleted')
    })

  it('shows the Shared badge only while a link is active', async () => {
    const shared = await mountRow(createArtifact({ activeShareCount: 2 }))
    const unshared = await mountRow(createArtifact())
    const badge = shared.get(testId('artifact-row-shared-badge'))

    expect(badge.text()).toBe('Shared')
    expect(badge.classes()).toEqual(
      expect.arrayContaining(['badge-soft', 'badge-success']),
    )
    expect(unshared.find(testId('artifact-row-shared-badge')).exists())
      .toBe(false)
  })

  it('opens the panel when the title is clicked', async () => {
    const artifact = createArtifact()
    const wrapper = await mountRow(artifact)

    await wrapper.get(testId('artifact-row-open')).trigger('click')

    expect(wrapper.emitted('open')).toEqual([[artifact]])
  })

  it('emits share, download and delete from the actions menu', async () => {
    const artifact = createArtifact()
    const wrapper = await mountRow(artifact, { canShare: true })

    await wrapper.get(testId('artifact-action-share')).trigger('click')
    await wrapper.get(testId('artifact-action-download')).trigger('click')
    await wrapper.get(testId('artifact-action-delete')).trigger('click')
    await wrapper.get(testId('artifact-action-open')).trigger('click')

    expect(wrapper.emitted('share')).toEqual([[artifact]])
    expect(wrapper.emitted('download')).toEqual([[artifact]])
    expect(wrapper.emitted('delete')).toEqual([[artifact]])
    expect(wrapper.emitted('open')).toEqual([[artifact]])
  })

  it('offers Open chat only when the chat exists', async () => {
    const wrapper = await mountRow(createArtifact())

    expect(wrapper.get(testId('artifact-action-open-chat'))
      .attributes('href')).toBe('/chats/chat-slug')
  })

  it('hides Share without the share feature', async () => {
    const wrapper = await mountRow(createArtifact())

    expect(wrapper.find(testId('artifact-action-share')).exists())
      .toBe(false)
  })

  it('enters selection mode from the Select action', async () => {
    const wrapper = await mountRow(createArtifact())

    await wrapper.get(testId('artifact-action-select')).trigger('click')

    expect(wrapper.emitted('enterSelect')).toEqual([['ArtifactPublicId01', 2]])
  })

  it('toggles the selection from the checkbox and the title in selection mode',
    async () => {
      const wrapper = await mountRow(createArtifact(), {
        isSelectionMode: true,
      })

      await wrapper.get(testId('artifact-row-checkbox')).trigger('click')
      await wrapper.get(testId('artifact-row-open')).trigger('click')

      expect(wrapper.emitted('select')).toEqual([
        ['ArtifactPublicId01', 2, false],
        ['ArtifactPublicId01', 2, false],
      ])
      expect(wrapper.emitted('open')).toBeUndefined()
      expect(wrapper.find(testId('artifact-row-actions-trigger')).exists())
        .toBe(false)
    })

  it('marks a taken-down artifact and disables Open, Download and Share',
    async () => {
      const wrapper = await mountRow(createArtifact({
        takenDown: true,
        activeShareCount: 0,
      }), { canShare: true })
      const badge = wrapper.get(testId('artifact-row-taken-down-badge'))
      const open = wrapper.get(testId('artifact-row-open'))

      expect(badge.text()).toBe('Removed after a report')
      expect(badge.classes()).toEqual(
        expect.arrayContaining(['badge-soft', 'badge-error']),
      )
      expect(open.attributes('disabled')).toBeDefined()
      expect(open.attributes('title'))
        .toBe('This artifact was removed after a report')
      expect(wrapper.get(testId('artifact-action-open')).attributes('disabled'))
        .toBeDefined()
      expect(wrapper.get(testId('artifact-action-download'))
        .attributes('disabled')).toBeDefined()
      expect(wrapper.find(testId('artifact-action-share')).exists())
        .toBe(false)
      expect(wrapper.find(testId('artifact-action-delete')).exists())
        .toBe(true)

      await open.trigger('click')

      expect(wrapper.emitted('open')).toBeUndefined()
    })
})

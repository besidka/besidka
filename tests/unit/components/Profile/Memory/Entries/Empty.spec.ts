import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { MemorySettingsFields } from '../../../../../../shared/types/memory.d'
import Empty from '../../../../../../app/components/Profile/Memory/Entries/Empty.vue'

enableAutoUnmount(afterEach)

const defaultSettings: MemorySettingsFields = {
  memoryEnabled: true,
  memoryExtractionEnabled: false,
  chatSearchEnabled: true,
  memoryIncludeSensitive: false,
  aboutMe: null,
  profileMemoryModel: null,
  profileMemoryGateway: null,
  projectMemoryModel: null,
  projectMemoryGateway: null,
}

async function mountEmpty(
  settings: Partial<MemorySettingsFields> = {},
  projectId: string | null = null,
) {
  return await mountSuspended(Empty, {
    props: { settings: { ...defaultSettings, ...settings }, projectId },
  })
}

describe('Profile/Memory/Entries/Empty', () => {
  it('invites the user to ask Besidka to remember something', async () => {
    const wrapper = await mountEmpty()

    expect(wrapper.text()).toContain('Nothing remembered yet')
    expect(wrapper.text()).toContain(
      'Ask Besidka in any chat to remember something',
    )
    expect(wrapper.text()).toContain('Remember that I prefer short answers.')
  })

  it('suggests turning on generation when it is off', async () => {
    const wrapper = await mountEmpty({ memoryExtractionEnabled: false })

    expect(wrapper.get(
      '[data-testid="memory-entries-empty-generation-hint"]',
    ).text()).toBe(
      'Or turn on Generate memory from chats above and let Besidka pick up '
      + 'lasting facts for you.',
    )
  })

  it('skips the generation hint when it is already on', async () => {
    const wrapper = await mountEmpty({ memoryExtractionEnabled: true })

    expect(wrapper.find(
      '[data-testid="memory-entries-empty-generation-hint"]',
    ).exists()).toBe(false)
  })

  it('explains the project variant instead', async () => {
    const wrapper = await mountEmpty({}, 'project-1')

    expect(wrapper.get('[data-testid="memory-entries-empty-project"]').text())
      .toBe(
        'Nothing remembered for this project yet. Memory saved in this '
        + 'project\'s chats shows up here.',
      )
    expect(wrapper.text()).not.toContain('Ask Besidka in any chat')
    expect(wrapper.find(
      '[data-testid="memory-entries-empty-generation-hint"]',
    ).exists()).toBe(false)
  })
})

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { UIMessage } from 'ai'
import Reasoning from '../../../../app/components/Chat/Reasoning.vue'
import { expandReasoningSteps } from './Reasoning/expand-steps'

mockNuxtImport('useNuxtData', () => {
  return () => ({ data: ref({ connectors: [] }) })
})
mockNuxtImport('useConnectorLibrary', () => {
  return () => ({})
})
mockNuxtImport('useUserSetting', () => {
  return () => ({
    stepsExpanded: shallowRef<boolean>(false),
    stepsAutoHide: shallowRef<boolean>(true),
  })
})

const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'
const LINK = `https://drive.google.com/open?id=${DRIVE_ID}`

function drivePart(overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool-google__drive_read_file',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { fileId: 'file-1' },
    output: {
      bodyRemoved: true,
      note: 'The content is kept only for the reply that fetched it.',
      references: [{
        id: DRIVE_ID,
        kind: 'drive-file',
        title: 'Plan.md',
        link: LINK,
      }],
    },
    ...overrides,
  }
}

async function mountMessage(parts: unknown[]) {
  const wrapper = await mountSuspended(Reasoning, {
    props: {
      message: {
        id: 'msg-google',
        role: 'assistant',
        parts,
      } as UIMessage,
      status: 'ready',
      reasoningLevel: 'off',
      turnStartedAt: 0,
      reasoningAccumulatedMs: 0,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
    },
    global: { stubs: { MDCCached: true } },
  })

  await expandReasoningSteps(wrapper)

  return wrapper
}

describe('Chat/Reasoning Google Drive step', () => {
  it('shows the file name and Open in Google Drive after a reload, from the '
    + 'stored references', async () => {
    const wrapper = await mountMessage([drivePart()])
    const link = wrapper.get('[data-testid="reasoning-google-step-link"]')

    expect(wrapper.get('[data-testid="reasoning-google-step-title"]').text())
      .toBe('Read a file from Google Drive')
    expect(wrapper.get('[data-testid="reasoning-google-step-reference"]')
      .text()).toContain('Plan.md')
    expect(link.attributes('href')).toBe(LINK)
    expect(link.attributes('rel')).toBe('noopener noreferrer')
  })

  it('shows the save step with its link', async () => {
    const wrapper = await mountMessage([drivePart({
      type: 'tool-google__drive_save_file',
    })])

    expect(wrapper.get('[data-testid="reasoning-google-step-title"]').text())
      .toBe('Saved a file to Google Drive')
    expect(wrapper.find('[data-testid="reasoning-google-step-link"]').exists())
      .toBe(true)
  })

  it.each([
    ['always', 'Ran without asking (Always allowed)'],
    ['chat', 'Ran without asking (Allowed in this chat)'],
  ] as const)('marks a Google call that ran under a %s grant, under the '
    + 'tool\'s own step', async (scope, text) => {
    const wrapper = await mountMessage([
      drivePart({ type: 'tool-google__gmail_search' }),
      {
        type: 'data-tool-grant',
        id: 'grant-call-1',
        data: {
          toolCallId: 'call-1',
          toolName: 'google__gmail_search',
          scope,
        },
      },
    ])

    expect(wrapper.get('[data-testid="reasoning-grant-marker"]').text())
      .toContain(text)
    expect(wrapper.findAll('[data-testid="reasoning-grant-marker"]'))
      .toHaveLength(1)
  })

  it('marks no Google call that asked and was approved', async () => {
    const wrapper = await mountMessage([drivePart({
      type: 'tool-google__drive_create_folder',
    })])

    expect(wrapper.find('[data-testid="reasoning-grant-marker"]').exists())
      .toBe(false)
  })

  it('shows a failed call as a title without an empty box', async () => {
    const wrapper = await mountMessage([drivePart({
      state: 'output-error',
      output: undefined,
      errorText: 'The Google tool did not return a result.',
    })])

    expect(wrapper.get('[data-testid="reasoning-google-step-title"]').text())
      .toBe('Reading a file from Google Drive failed')
    expect(wrapper.find('[data-testid="reasoning-google-step-references"]')
      .exists()).toBe(false)
  })
})

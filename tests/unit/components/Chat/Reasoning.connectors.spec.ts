import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { UIMessage } from 'ai'
import Reasoning from '../../../../app/components/Chat/Reasoning.vue'
import { CONNECTOR_APPROVAL_DENIAL_TEXT } from '#shared/utils/connectors-parts'

const cachedConnectors = ref<unknown>({
  connectors: [{ slug: 'notion', title: 'Notion' }],
})

mockNuxtImport('useNuxtData', () => {
  return () => ({ data: cachedConnectors })
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

const framed = '<untrusted_tool_result connector="notion" tool="search">'
  + 'result</untrusted_tool_result>'

function connectorCall(overrides: Record<string, unknown> = {}) {
  return {
    type: 'dynamic-tool',
    toolName: 'mcp__notion__search',
    toolCallId: 'call-1',
    state: 'output-available',
    input: { query: 'roadmap' },
    output: framed,
    ...overrides,
  }
}

async function mountMessage(
  parts: unknown[],
  options: { status?: 'ready' | 'streaming', role?: UIMessage['role'] } = {},
) {
  return await mountSuspended(Reasoning, {
    props: {
      message: {
        id: 'msg-connector',
        role: options.role ?? 'assistant',
        parts,
      } as UIMessage,
      status: options.status ?? 'ready',
      reasoningLevel: 'off',
      turnStartedAt: 0,
      reasoningAccumulatedMs: 0,
      reasoningSegmentStartedAt: 0,
      isTurnThinkingHeld: false,
    },
    global: { stubs: { MDCCached: true } },
  })
}

function titleOf(wrapper: Awaited<ReturnType<typeof mountMessage>>): string {
  return wrapper.get('[data-testid="reasoning-connector-step-title"]').text()
}

describe('Chat/Reasoning connector step', () => {
  it('renders a finished call as a reasoning step with the connector display name', async () => {
    const wrapper = await mountMessage([connectorCall()])

    expect(wrapper.find('[data-testid="reasoning-steps"]').exists()).toBe(true)
    expect(titleOf(wrapper)).toBe('Used Notion · search')
    expect(wrapper.find('[data-testid="reasoning-connector-step-untrusted"]')
      .exists()).toBe(true)
  })

  it('falls back to the slug for a connector that was deleted', async () => {
    const wrapper = await mountMessage([connectorCall({
      toolName: 'mcp__gone__lookup',
    })])

    expect(titleOf(wrapper)).toBe('Used gone · lookup')
  })

  it('shows a running call with a spinner step', async () => {
    const wrapper = await mountMessage([connectorCall({
      state: 'input-available',
      output: undefined,
    })], { status: 'streaming' })

    expect(titleOf(wrapper)).toBe('Using Notion · search…')
    expect(wrapper.find('svg.text-accent, [class*="loader"]').exists()
      || wrapper.html().includes('reasoning-main-title-skeleton')).toBe(true)
  })

  it('shows an error and a denial as failed steps', async () => {
    const errored = await mountMessage([connectorCall({
      state: 'output-error',
      output: undefined,
    })])
    const denied = await mountMessage([connectorCall({
      output: CONNECTOR_APPROVAL_DENIAL_TEXT,
    })])

    expect(titleOf(errored)).toBe('Could not use Notion · search')
    expect(errored.find('.reasoning-step-failed').exists()).toBe(true)
    expect(titleOf(denied)).toBe('Needs approval: Notion · search')
    expect(denied.find('.reasoning-step-failed').exists()).toBe(true)
    expect(denied.find('[data-testid="reasoning-connector-step-untrusted"]')
      .exists()).toBe(false)
  })

  it('keeps the order of a connector call and another tool step', async () => {
    const wrapper = await mountMessage([
      connectorCall(),
      {
        type: 'tool-memory_list',
        toolCallId: 'call-2',
        state: 'output-available',
        input: {},
        output: { notice: 'data', entries: [] },
      },
    ])
    const steps = wrapper.findAll('[data-testid="reasoning-steps"] > li')

    expect(steps).toHaveLength(2)
    expect(steps[0]!.find('[data-testid="reasoning-connector-step"]').exists())
      .toBe(true)
    expect(steps[1]!.find('[data-testid="reasoning-memory-step"]').exists())
      .toBe(true)
  })

  it('does not treat a user message part as a connector step', async () => {
    const wrapper = await mountMessage([connectorCall()], { role: 'user' })

    expect(wrapper.find('[data-testid="reasoning-connector-step"]').exists())
      .toBe(false)
  })
})

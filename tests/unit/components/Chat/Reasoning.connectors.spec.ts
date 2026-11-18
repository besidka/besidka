import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref, shallowRef } from 'vue'
import type { UIMessage } from 'ai'
import Reasoning from '../../../../app/components/Chat/Reasoning.vue'
import { CONNECTOR_APPROVAL_DENIAL_TEXT } from '#shared/utils/connectors-parts'

vi.mock('@panzoom/panzoom', () => {
  return {
    default: vi.fn(() => {
      return {
        destroy: vi.fn(),
        getScale: vi.fn(() => 1),
        reset: vi.fn(),
        resetStyle: vi.fn(),
        zoomToPoint: vi.fn(),
      }
    }),
  }
})

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

function connectorImage(toolCallId: string, index: number, deleted = false) {
  return {
    type: 'data-connector-image',
    id: `connector-image-${toolCallId}-${index}`,
    data: {
      toolCallId,
      fileId: `file-${toolCallId}-${index}`,
      url: `/files/connector-${toolCallId}-${index}.png`,
      mediaType: 'image/png',
      width: 8,
      height: 8,
      size: 75,
      name: 'notion-search.png',
      ...(deleted ? { deleted: true } : {}),
    },
  }
}

describe('Chat/Reasoning connector images', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
      })
  })

  it('shows up to three thumbnails and the rest as +N in the header',
    async () => {
      const wrapper = await mountMessage([
        connectorCall(),
        connectorImage('call-1', 0),
        connectorImage('call-1', 1),
        connectorCall({ toolCallId: 'call-2' }),
        connectorImage('call-2', 0),
        connectorImage('call-2', 1),
        connectorImage('call-2', 2, true),
      ])
      const header = wrapper.get('[data-testid="reasoning-header-images"]')
      const thumbnails = header.findAll(
        '[data-testid="reasoning-connector-image"]',
      )

      expect(thumbnails).toHaveLength(3)
      expect(thumbnails[0]!.get('img').attributes('alt'))
        .toBe('Screenshot from Notion')
      expect(header.get('[data-testid="reasoning-header-images-more"]').text())
        .toBe('+1')
      expect(header.get(
        '[data-testid="reasoning-header-images-more-phone"]',
      ).text()).toBe('+2')
      expect(header.find('[data-testid="reasoning-connector-image-deleted"]')
        .exists()).toBe(false)
    })

  it('opens the image without toggling the steps', async () => {
    const wrapper = await mountMessage([
      connectorCall(),
      connectorImage('call-1', 0),
    ])
    const details = wrapper.get('details')

    await wrapper.get('[data-testid="reasoning-header-images"] '
      + '[data-testid="reasoning-connector-image"]').trigger('click')

    expect(details.attributes('open')).toBeUndefined()
    expect(wrapper.find('[data-testid="reasoning-header-images"]').exists())
      .toBe(true)
  })

  it('shows one thumbnail per step row and a deleted tile when it is gone',
    async () => {
      const wrapper = await mountMessage([
        connectorCall(),
        connectorImage('call-1', 0),
        connectorImage('call-1', 1),
        connectorCall({ toolCallId: 'call-2' }),
        connectorImage('call-2', 0, true),
      ])
      const steps = wrapper.findAll('[data-testid="reasoning-connector-step"]')

      expect(steps[0]!.findAll('[data-testid="reasoning-connector-image"]'))
        .toHaveLength(1)
      expect(steps[0]!.get('[data-testid="reasoning-connector-image-more"]')
        .text()).toBe('+1')
      expect(steps[1]!.find('[data-testid="reasoning-connector-image"]')
        .exists()).toBe(false)
      expect(steps[1]!.find(
        '[data-testid="reasoning-connector-image-deleted"]',
      ).exists()).toBe(true)
    })

  it('shows no images in a shared chat', async () => {
    const wrapper = await mountSuspended(Reasoning, {
      props: {
        message: {
          id: 'msg-shared',
          role: 'assistant',
          parts: [connectorCall(), connectorImage('call-1', 0)],
        } as UIMessage,
        status: 'ready',
        reasoningLevel: 'off',
        turnStartedAt: 0,
        reasoningAccumulatedMs: 0,
        reasoningSegmentStartedAt: 0,
        isTurnThinkingHeld: false,
        isShared: true,
      },
      global: { stubs: { MDCCached: true } },
    })

    expect(wrapper.find('[data-testid="reasoning-connector-image"]').exists())
      .toBe(false)
  })
})

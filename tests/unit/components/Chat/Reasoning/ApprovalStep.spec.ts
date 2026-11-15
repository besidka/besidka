import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, shallowRef } from 'vue'
import type { ToolApprovalController } from '~/composables/tool-approvals'
import type {
  ApprovalStepModel,
  ApprovalStepState,
} from '~/utils/tool-approval-step'
import { TOOL_APPROVAL_CONTROLLER_KEY } from '~/composables/tool-approvals'
import { useSidePanel } from '~/composables/side-panel'
import ApprovalStep from '../../../../../app/components/Chat/Reasoning/ApprovalStep.vue'

function createModel(
  overrides: Partial<ApprovalStepModel> = {},
): ApprovalStepModel {
  return {
    approvalId: 'approval-1',
    toolCallId: 'call-1',
    toolName: 'mcp__linear__create_issue',
    connectorSlug: 'linear',
    tool: 'create_issue',
    reason: 'always-ask',
    summary: '',
    rememberOptions: ['once'],
    input: { title: 'Bug' },
    partState: 'approval-requested',
    approved: null,
    ...overrides,
  }
}

function createController(): ToolApprovalController {
  return {
    isActive: computed(() => true),
    messages: shallowRef([]),
    isRequestActive: computed(() => false),
    pendingApprovalIds: computed(() => []),
    sendingApprovalIds: shallowRef([]),
    answeredApprovalIds: shallowRef([]),
    failures: shallowRef({}),
    answeredAt: shallowRef({}),
    focusRequest: shallowRef(null),
    answer: vi.fn(async () => {}),
    change: vi.fn(),
    askAgain: vi.fn(async () => {}),
    focusFirstPending: vi.fn(),
  }
}

async function mountStep(options: {
  model?: ApprovalStepModel
  state?: ApprovalStepState
  title?: string
  progress?: string
  outcome?: string
  summaryLine?: string
  controller?: ToolApprovalController | null
} = {}) {
  const controller = options.controller === undefined
    ? createController()
    : options.controller

  const wrapper = await mountSuspended(ApprovalStep, {
    props: {
      model: options.model ?? createModel(),
      state: options.state ?? 'pending',
      title: options.title ?? 'Linear wants to run create_issue',
      reasonText: 'Changes or deletes data',
      summaryLine: options.summaryLine ?? '',
      progress: options.progress ?? '',
      outcome: options.outcome ?? '',
      messageId: 'assistant-1',
    },
    global: controller
      ? { provide: { [TOOL_APPROVAL_CONTROLLER_KEY as symbol]: controller } }
      : {},
  })

  return { wrapper, controller }
}

function testId(id: string): string {
  return `[data-testid="reasoning-approval-step-${id}"]`
}

describe('Chat/Reasoning/ApprovalStep', () => {
  afterEach(() => {
    useSidePanel().close()
  })

  it('shows the title, reason and collapsed arguments while pending',
    async () => {
      const { wrapper } = await mountStep()

      expect(wrapper.get(testId('title')).text())
        .toBe('Linear wants to run create_issue')
      expect(wrapper.get(testId('reason')).text())
        .toBe('Changes or deletes data')
      expect(wrapper.get(testId('arguments')).attributes('open'))
        .toBeUndefined()
      expect(wrapper.get(testId('arguments-text')).text())
        .toBe('{\n  "title": "Bug"\n}')
      expect(wrapper.find(testId('shortened')).exists()).toBe(false)
      expect(wrapper.get('[data-testid="reasoning-approval-step"]')
        .attributes('tabindex')).toBe('0')
    })

  it('renders a hostile tool name and arguments as text', async () => {
    const { wrapper } = await mountStep({
      title: 'Evil wants to run <img src=x onerror=alert(1)>',
      model: createModel({
        tool: '<img src=x onerror=alert(1)>',
        input: { html: '<script>alert(1)</script>' },
      }),
    })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.get(testId('title')).text())
      .toBe('Evil wants to run <img src=x onerror=alert(1)>')
  })

  it.each([
    [['once'], ['allow-once']],
    [['once', 'chat'], ['allow-once', 'allow-chat']],
    [['once', 'chat', 'always'], ['allow-once', 'allow-chat', 'allow-always']],
  ] as const)('offers only the allowed buttons %j', async (options, ids) => {
    const { wrapper } = await mountStep({
      model: createModel({ rememberOptions: [...options] }),
    })
    const buttons = wrapper.get(testId('actions')).findAll('button')

    expect(buttons.map(button => button.attributes('data-testid'))).toEqual([
      ...ids.map(id => `reasoning-approval-step-${id}`),
      'reasoning-approval-step-deny',
    ])
    expect(buttons[0]!.classes()).toContain('btn-primary')
    expect(buttons.at(-1)!.classes()).toContain('btn-ghost')
    expect(buttons.every(button => button.classes().includes('btn-sm')))
      .toBe(true)
  })

  it('sends Allow once with its remember choice', async () => {
    const { wrapper, controller } = await mountStep({
      model: createModel({ rememberOptions: ['once', 'chat'] }),
    })

    await wrapper.get(testId('allow-chat')).trigger('click')

    expect(controller!.answer).toHaveBeenCalledWith({
      approvalId: 'approval-1',
      approved: true,
      remember: 'chat',
    })
  })

  it('sends a denial', async () => {
    const { wrapper, controller } = await mountStep()

    await wrapper.get(testId('deny')).trigger('click')

    expect(controller!.answer).toHaveBeenCalledWith({
      approvalId: 'approval-1',
      approved: false,
    })
  })

  it('allows once on Enter only when the step itself has focus', async () => {
    const { wrapper, controller } = await mountStep()
    const step = wrapper.get('[data-testid="reasoning-approval-step"]')

    await wrapper.get(testId('deny')).trigger('keydown', { key: 'Enter' })
    await step.trigger('keydown', { key: 'Enter', repeat: true })

    expect(controller!.answer).not.toHaveBeenCalled()

    await step.trigger('keydown', { key: 'Enter' })

    expect(controller!.answer).toHaveBeenCalledWith({
      approvalId: 'approval-1',
      approved: true,
      remember: 'once',
    })
  })

  it('ignores Enter when Allow once is not offered', async () => {
    const { wrapper, controller } = await mountStep({
      model: createModel({ rememberOptions: ['chat'] }),
    })

    await wrapper.get('[data-testid="reasoning-approval-step"]')
      .trigger('keydown', { key: 'Enter' })

    expect(controller!.answer).not.toHaveBeenCalled()
  })

  it('collapses the arguments on Escape', async () => {
    const { wrapper } = await mountStep()
    const details = wrapper.get(testId('arguments'))

    ;(details.element as HTMLDetailsElement).open = true
    await details.trigger('toggle')

    expect(details.attributes('open')).toBeDefined()

    await wrapper.get('[data-testid="reasoning-approval-step"]')
      .trigger('keydown', { key: 'Escape' })

    expect(details.attributes('open')).toBeUndefined()
  })

  it('disables the buttons and shows a spinner while sending', async () => {
    const { wrapper } = await mountStep({ state: 'sending' })

    expect(wrapper.get(testId('sending')).text())
      .toContain('Sending your answer')
    expect(wrapper.get(testId('actions')).findAll('button')
      .every(button => button.attributes('disabled') !== undefined))
      .toBe(true)
    expect(wrapper.get('[data-testid="reasoning-approval-step"]')
      .attributes('tabindex')).toBeUndefined()
  })

  it('shows the local answer and progress while other calls wait',
    async () => {
      const { wrapper, controller } = await mountStep({
        state: 'answered',
        progress: '1 of 2 answered',
        model: createModel({
          partState: 'approval-responded',
          approved: false,
        }),
      })

      expect(wrapper.find(testId('actions')).exists()).toBe(false)
      expect(wrapper.get(testId('answered')).text())
        .toContain('You denied this')
      expect(wrapper.get(testId('progress')).text()).toBe('1 of 2 answered')

      await wrapper.get(testId('change')).trigger('click')

      expect(controller!.change).toHaveBeenCalledWith('approval-1')
    })

  it('shows one line with the outcome once denied', async () => {
    const { wrapper } = await mountStep({
      state: 'denied',
      outcome: 'Denied · 14:05',
    })

    expect(wrapper.get(testId('outcome')).text()).toBe('Denied · 14:05')
    expect(wrapper.find(testId('actions')).exists()).toBe(false)
    expect(wrapper.find(testId('arguments')).exists()).toBe(false)
  })

  it.each([
    ['expired', 'This approval expired.'],
    ['interrupted', 'Interrupted before it finished.'],
  ] as const)('offers Ask again when %s', async (state, text) => {
    const { wrapper, controller } = await mountStep({ state })

    expect(wrapper.get(testId('failure')).text()).toContain(text)
    expect(wrapper.find(testId('actions')).exists()).toBe(false)

    await wrapper.get(testId('ask-again')).trigger('click')

    expect(controller!.askAgain).toHaveBeenCalledWith('assistant-1')
    expect(wrapper.get(testId('ask-again-hint')).text())
      .toContain('Your message is back in the box')
  })

  it('says when the arguments are shortened', async () => {
    const { wrapper } = await mountStep({
      model: createModel({ input: { token: '[redacted]' } }),
    })

    expect(wrapper.get(testId('shortened')).text()).toBe('· Shown shortened')
  })

  it('opens the details in the side panel without buttons', async () => {
    const { wrapper } = await mountStep()

    await wrapper.get(testId('details')).trigger('click')

    const view = useSidePanel().currentView.value

    expect(view?.viewKey).toBe('tool-approval:approval-1')
    expect(view?.title).toBe('Approval details')
    expect(view?.props).toEqual(expect.objectContaining({
      toolName: 'mcp__linear__create_issue',
      reasonText: 'Changes or deletes data',
      input: { title: 'Bug' },
    }))
  })

  it('is read-only without a controller', async () => {
    const { wrapper } = await mountStep({ controller: null })

    expect(wrapper.find(testId('actions')).exists()).toBe(false)
    expect(wrapper.get('[data-testid="reasoning-approval-step"]')
      .attributes('tabindex')).toBeUndefined()
  })
})

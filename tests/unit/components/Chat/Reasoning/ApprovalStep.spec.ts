import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed, shallowRef } from 'vue'
import type { ToolApprovalController } from '~/composables/tool-approvals'
import type {
  ApprovalStepModel,
  ApprovalStepState,
} from '~/utils/tool-approval-step'
import { TOOL_APPROVAL_CONTROLLER_KEY } from '~/composables/tool-approvals'
import { getApprovalReasonText } from '~/utils/tool-approval-step'
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
    preview: '',
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
    focusApproval: vi.fn(),
  }
}

async function mountStep(options: {
  model?: ApprovalStepModel
  state?: ApprovalStepState
  title?: string
  progress?: string
  outcome?: string
  summaryLine?: string
  connectorName?: string
  controller?: ToolApprovalController | null
  reasonText?: string
} = {}) {
  const controller = options.controller === undefined
    ? createController()
    : options.controller

  const wrapper = await mountSuspended(ApprovalStep, {
    props: {
      model: options.model ?? createModel(),
      state: options.state ?? 'pending',
      title: options.title ?? 'Linear wants to run create_issue',
      reasonText: options.reasonText ?? 'Changes or deletes data',
      summaryLine: options.summaryLine ?? '',
      progress: options.progress ?? '',
      outcome: options.outcome ?? '',
      messageId: 'assistant-1',
      connectorName: options.connectorName ?? 'Linear',
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

  it.each([
    ['a Google tool', {
      toolName: 'google__calendar_list_events',
      connectorSlug: null,
      tool: 'google__calendar_list_events',
    }, 'Allow in this chat: reading events on your Google Calendar'],
    ['a connector tool', {}, undefined],
    ['a Besidka tool', {
      toolName: 'besidka__get_chat',
      connectorSlug: null,
      isBesidka: true,
      tool: 'get_chat',
    }, undefined],
  ] as const)('labels the chat grant of %s the same short way and makes '
    + 'only Allow once and Allow in this chat primary', async (
    _kind,
    overrides,
    ariaLabel,
  ) => {
    const { wrapper } = await mountStep({
      model: createModel({
        ...overrides,
        rememberOptions: ['once', 'chat', 'always'],
      }),
    })
    const chatButton = wrapper.get(testId('allow-chat'))
    const alwaysButton = wrapper.get(testId('allow-always'))

    expect(chatButton.text()).toBe('Allow in this chat')
    expect(chatButton.attributes('aria-label')).toBe(ariaLabel)

    if (ariaLabel) {
      expect(chatButton.attributes('title')).toBe(ariaLabel)
    }

    expect(wrapper.get(testId('allow-once')).classes())
      .toContain('btn-primary')
    expect(chatButton.classes()).toContain('btn-primary')
    expect(chatButton.classes()).not.toContain('btn-soft')
    expect(alwaysButton.classes()).toContain('btn-soft')
    expect(alwaysButton.classes()).not.toContain('btn-primary')
    expect(wrapper.get(testId('deny')).classes()).toContain('btn-ghost')
  })

  it('shows the Google egress prompt without Always allow', async () => {
    const { wrapper } = await mountStep({
      model: createModel({
        reason: 'google-egress',
        rememberOptions: ['once', 'chat'],
      }),
      reasonText: getApprovalReasonText('google-egress', ''),
    })

    expect(wrapper.get(testId('reason')).text())
      .toBe('Content from Google in this chat may be sent to this connector')
    expect(wrapper.find(testId('allow-always')).exists()).toBe(false)
    expect(wrapper.find(testId('allow-chat')).exists()).toBe(true)
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

  it('offers all four answers for a plain write', async () => {
    const { wrapper } = await mountStep({
      model: createModel({
        reason: 'default',
        rememberOptions: ['once', 'chat', 'always'],
      }),
    })

    expect(wrapper.get(testId('actions')).findAll('button')
      .map(button => button.text()))
      .toEqual(['Allow once', 'Allow in this chat', 'Always allow', 'Deny'])
    expect(wrapper.get(testId('allow-chat')).attributes('title')).toBe(
      'Runs this tool without asking in later messages of this chat, also '
      + 'after content from earlier messages.',
    )
  })

  it('answers Always allow with one click and explains it in the tooltip',
    async () => {
      const { wrapper, controller } = await mountStep({
        model: createModel({
          reason: 'default',
          rememberOptions: ['once', 'chat', 'always'],
        }),
      })
      const always = wrapper.get(testId('allow-always'))

      expect(always.attributes('title')).toBe(
        'Runs without asking in every chat until the tool changes. '
        + 'Remove it in the chat panel.',
      )

      await always.trigger('click')

      expect(controller!.answer).toHaveBeenCalledWith({
        approvalId: 'approval-1',
        approved: true,
        remember: 'always',
      })
      expect(wrapper.find(testId('always-confirm')).exists()).toBe(false)
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

  it.each([
    'google__gmail_create_draft',
    'google__drive_save_file',
    'google__drive_create_folder',
    'google__drive_create_file',
    'google__drive_rename',
    'google__drive_move',
    'google__calendar_create_event',
  ])('never approves the Google write %s on Enter from the card', async (
    toolName,
  ) => {
    const { wrapper, controller } = await mountStep({
      model: createModel({ toolName, connectorSlug: null, tool: toolName }),
    })

    await wrapper.get('[data-testid="reasoning-approval-step"]')
      .trigger('keydown', { key: 'Enter' })

    expect(controller!.answer).not.toHaveBeenCalled()

    await wrapper.get(testId('allow-once')).trigger('click')

    expect(controller!.answer).toHaveBeenCalledWith({
      approvalId: 'approval-1',
      approved: true,
      remember: 'once',
    })
  })

  it('still approves a Google read on Enter from the card', async () => {
    const { wrapper, controller } = await mountStep({
      model: createModel({
        toolName: 'google__gmail_read_thread',
        connectorSlug: null,
        tool: 'google__gmail_read_thread',
      }),
    })

    await wrapper.get('[data-testid="reasoning-approval-step"]')
      .trigger('keydown', { key: 'Enter' })

    expect(controller!.answer).toHaveBeenCalledTimes(1)
  })

  it('shows the link the call names, and none without one', async () => {
    const link = 'https://mail.google.com/mail/?authuser=me%40example.com#all/t1'
    const withLink = await mountStep({ model: createModel({ link }) })
    const anchor = withLink.wrapper.get(testId('link'))

    expect(anchor.attributes('href')).toBe(link)
    expect(anchor.attributes('target')).toBe('_blank')
    expect(anchor.attributes('rel')).toBe('noopener noreferrer')
    expect(anchor.text()).toBe('Open in Gmail')

    const without = await mountStep()

    expect(without.wrapper.find(testId('link')).exists()).toBe(false)

    const drive = await mountStep({
      model: createModel({ link: 'https://drive.google.com/open?id=abc' }),
    })

    expect(drive.wrapper.get(testId('link')).text())
      .toBe('Open in Google Drive')
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

  it('shows the text a content write saves, collapsed and in full in the '
    + 'details', async () => {
    const preview = `${'a'.repeat(600)}END`
    const { wrapper } = await mountStep({
      model: createModel({ preview, isBesidka: true }),
    })
    const step = wrapper.get(testId('preview'))

    expect(step.attributes('open')).toBeUndefined()
    expect(step.text()).toContain('Full text in View details')
    expect(wrapper.get(testId('preview-text')).text()).not.toContain('END')

    await wrapper.get(testId('details')).trigger('click')

    expect(useSidePanel().currentView.value?.props)
      .toEqual(expect.objectContaining({ preview }))
  })

  describe('a Gmail draft', () => {
    const body = `${'Dear Alice, '.repeat(120)}THE END`
    const draftInput = {
      to: [
        { email: 'alice@example.com', name: 'Alice Ünal' },
        { email: 'bob@example.com' },
      ],
      cc: [{ email: 'carol@example.com' }],
      bcc: [{ email: 'secret.boss@example.com' }],
      subject: 'Lunch plans',
      body,
      replyToThreadId: '18c0ffee',
    }

    function draftModel(
      overrides: Partial<ApprovalStepModel> = {},
    ): ApprovalStepModel {
      return createModel({
        toolName: 'google__gmail_create_draft',
        connectorSlug: null,
        tool: 'google__gmail_create_draft',
        input: draftInput,
        summary: 'Create a Gmail draft "Lunch plans" to Alice',
        ...overrides,
      })
    }

    it('shows every recipient, the subject and the whole body', async () => {
      const { wrapper } = await mountStep({ model: draftModel() })
      const card = wrapper.get(testId('gmail-draft'))

      expect(card.get(testId('gmail-draft-to')).text())
        .toContain('Alice Ünal <alice@example.com>')
      expect(card.get(testId('gmail-draft-to')).text())
        .toContain('bob@example.com')
      expect(card.get(testId('gmail-draft-cc')).text())
        .toBe('carol@example.com')
      expect(card.get(testId('gmail-draft-bcc')).text())
        .toBe('secret.boss@example.com')
      expect(card.get(testId('gmail-draft-subject')).text())
        .toBe('Lunch plans')
      expect(card.get(testId('gmail-draft-body')).text()).toBe(body)
      expect(card.get(testId('gmail-draft-body')).text()).toContain('THE END')
      expect(card.text()).toContain('a reply in the thread above')
      expect(card.get(testId('gmail-draft-lines')).text()).toContain('1 line')
      expect(card.get(testId('gmail-draft-note')).text())
        .toContain('Besidka cannot send it')
    })

    it('makes the scrolling body a labeled region keyboard users can reach',
      async () => {
        const { wrapper } = await mountStep({ model: draftModel() })
        const region = wrapper.get(testId('gmail-draft-body'))

        expect(region.attributes('tabindex')).toBe('0')
        expect(region.attributes('role')).toBe('region')
        expect(region.attributes('aria-label')).toBe('Draft message')
      })

    it('counts the lines and shows a long blank run as one marker', async () => {
      const padded = `Hi${'\n'.repeat(15)}hidden line`
      const { wrapper } = await mountStep({
        model: draftModel({ input: { ...draftInput, body: padded } }),
      })

      expect(wrapper.get(testId('gmail-draft-lines')).text())
        .toContain('16 lines')
      expect(wrapper.get(testId('gmail-draft-body')).text())
        .toBe('Hi\n[14 blank lines]\nhidden line')
    })

    it('offers Allow once and nothing else to allow', async () => {
      const { wrapper } = await mountStep({ model: draftModel() })

      expect(wrapper.find(testId('allow-once')).exists()).toBe(true)
      expect(wrapper.find(testId('allow-chat')).exists()).toBe(false)
      expect(wrapper.find(testId('allow-always')).exists()).toBe(false)
    })

    it('renders the text as text, never as markup', async () => {
      const { wrapper } = await mountStep({
        model: draftModel({
          input: {
            ...draftInput,
            subject: '<img src=x onerror=alert(1)>',
            body: '<b>bold</b> [link](https://evil.example)',
          },
        }),
      })
      const card = wrapper.get(testId('gmail-draft'))

      expect(card.find('img').exists()).toBe(false)
      expect(card.find('b').exists()).toBe(false)
      expect(card.get(testId('gmail-draft-body')).text())
        .toBe('<b>bold</b> [link](https://evil.example)')
    })

    it('shows no draft card for another tool or an input that is no draft',
      async () => {
        const other = await mountStep({
          model: createModel({ input: draftInput }),
        })
        const broken = await mountStep({
          model: draftModel({ input: { nothing: true } }),
        })

        expect(other.wrapper.find(testId('gmail-draft')).exists()).toBe(false)
        expect(broken.wrapper.find(testId('gmail-draft')).exists()).toBe(false)
      })
  })

  describe('a Google Drive folder', () => {
    const FOLDER_ID = 'folder-id-0123456789'

    function folderModel(
      overrides: Partial<ApprovalStepModel> = {},
    ): ApprovalStepModel {
      return createModel({
        toolName: 'google__drive_create_folder',
        connectorSlug: null,
        tool: 'google__drive_create_folder',
        input: { name: 'Reports', parentFolderId: FOLDER_ID },
        driveNames: { folder: { name: 'Projects', id: FOLDER_ID } },
        summary: 'Create the folder "Reports" inside "Projects"',
        ...overrides,
      })
    }

    it('shows the folder name, its parent and the exact id', async () => {
      const { wrapper } = await mountStep({ model: folderModel() })
      const card = wrapper.get(testId('drive-change'))

      expect(card.get(testId('drive-change-name')).text()).toBe('Reports')
      expect(card.get(testId('drive-change-parent')).text())
        .toContain('“Projects”')
      expect(card.get(testId('drive-change-parent-id')).text())
        .toBe(FOLDER_ID)
      expect(card.get(testId('drive-change-note')).text())
        .toContain('cannot delete files')
    })

    it('shows the top level of My Drive for a call with no parent',
      async () => {
        const { wrapper } = await mountStep({
          model: folderModel({
            input: { name: 'Reports' },
            driveNames: undefined,
          }),
        })

        expect(wrapper.get(testId('drive-change-parent')).text())
          .toBe('My Drive (top level)')
      })

    it('shows no card for an input the server would refuse', async () => {
      const { wrapper } = await mountStep({
        model: folderModel({ input: { name: '../../x' } }),
      })

      expect(wrapper.find(testId('drive-change')).exists()).toBe(false)
    })

    it('names the parent only for the id the server wrote it for',
      async () => {
        const { wrapper } = await mountStep({
          model: folderModel({
            driveNames: { folder: { name: 'Other', id: 'other-id-0123456789' } },
          }),
        })

        expect(wrapper.get(testId('drive-change-parent')).text())
          .not.toContain('Other')
        expect(wrapper.get(testId('drive-change-parent-id')).text())
          .toBe(FOLDER_ID)
      })

    it('hands the names to the details panel', async () => {
      const { wrapper } = await mountStep({ model: folderModel() })

      await wrapper.get(testId('details')).trigger('click')

      expect(useSidePanel().currentView.value?.props).toMatchObject({
        toolName: 'google__drive_create_folder',
        driveNames: { folder: { name: 'Projects', id: FOLDER_ID } },
      })
    })
  })

  describe('a Google Drive file', () => {
    const FOLDER_ID = 'folder-id-0123456789'

    function fileModel(
      overrides: Partial<ApprovalStepModel> = {},
    ): ApprovalStepModel {
      return createModel({
        toolName: 'google__drive_create_file',
        connectorSlug: null,
        tool: 'google__drive_create_file',
        input: {
          name: 'Plan',
          kind: 'document',
          content: '# Plan\n\nFirst line.\nSecond line.',
          folderId: FOLDER_ID,
        },
        driveNames: { folder: { name: 'Projects', id: FOLDER_ID } },
        summary: 'Create the Google Doc "Plan" (1 KB) in "Projects"',
        ...overrides,
      })
    }

    it('shows the name, the type, the folder, the size and the whole '
      + 'content in a region the keyboard can reach', async () => {
      const { wrapper } = await mountStep({ model: fileModel() })
      const card = wrapper.get(testId('drive-change'))
      const content = card.get(testId('drive-change-content'))

      expect(card.get(testId('drive-change-name')).text()).toBe('Plan')
      expect(card.get(testId('drive-change-type')).text())
        .toBe('Google Doc, converted from Markdown')
      expect(card.get(testId('drive-change-parent')).text())
        .toContain('“Projects”')
      expect(card.get(testId('drive-change-parent-id')).text())
        .toBe(FOLDER_ID)
      expect(card.get(testId('drive-change-size')).text())
        .toBe('32 bytes, 4 lines')
      expect(content.text()).toContain('First line.')
      expect(content.text()).toContain('Second line.')
      expect(content.attributes('tabindex')).toBe('0')
      expect(content.attributes('role')).toBe('region')
      expect(content.attributes('aria-label')).toBe('File content')
      expect(card.get(testId('drive-change-note')).text())
        .toContain('cannot delete files')
    })

    it('shows the top level of My Drive for a call with no folder',
      async () => {
        const { wrapper } = await mountStep({
          model: fileModel({
            input: { name: 'Plan', kind: 'text', content: 'plain' },
            driveNames: undefined,
          }),
        })

        expect(wrapper.get(testId('drive-change-parent')).text())
          .toBe('My Drive (top level)')
        expect(wrapper.get(testId('drive-change-type')).text())
          .toBe('Plain text file')
      })

    it('shows a spreadsheet as a table of text cells', async () => {
      const { wrapper } = await mountStep({
        model: fileModel({
          input: {
            name: 'Totals',
            kind: 'spreadsheet',
            content: 'item,count\npens,3\n',
          },
          driveNames: undefined,
        }),
      })
      const cells = wrapper.get(testId('drive-change-content')).findAll('td')

      expect(cells.map(cell => cell.text())).toEqual([
        'item',
        'count',
        'pens',
        '3',
      ])
      expect(wrapper.get(testId('drive-change-size')).text())
        .toBe('2 rows, 2 columns')
    })

    it('shows hostile text as text, never as markup', async () => {
      const { wrapper } = await mountStep({
        model: fileModel({
          input: {
            name: 'Plan',
            kind: 'text',
            content: '<img src=x onerror=alert(1)> [x](https://evil.example)',
          },
        }),
      })

      expect(wrapper.find('img').exists()).toBe(false)
      expect(wrapper.find('a').exists()).toBe(false)
      expect(wrapper.get(testId('drive-change-content')).text())
        .toContain('<img src=x onerror=alert(1)>')
    })

    it.each([
      ['a formula in a spreadsheet', {
        name: 'Totals',
        kind: 'spreadsheet',
        content: 'a\n=IMPORTXML("x","y")',
      }],
      ['an image in a document', {
        name: 'Plan',
        kind: 'document',
        content: '![x](https://e.test/a.png)',
      }],
      ['HTML in a document', {
        name: 'Plan',
        kind: 'document',
        content: '<script>x</script>',
      }],
      ['a media type from the model', {
        name: 'Plan',
        kind: 'text',
        content: 'x',
        mimeType: 'text/html',
      }],
    ])('shows no card for %s', async (_label, input) => {
      const { wrapper } = await mountStep({ model: fileModel({ input }) })

      expect(wrapper.find(testId('drive-change')).exists()).toBe(false)
    })

    it('hands the names to the details panel', async () => {
      const { wrapper } = await mountStep({ model: fileModel() })

      await wrapper.get(testId('details')).trigger('click')

      expect(useSidePanel().currentView.value?.props).toMatchObject({
        toolName: 'google__drive_create_file',
        driveNames: { folder: { name: 'Projects', id: FOLDER_ID } },
      })
    })
  })

  describe('a Google Drive rename and move', () => {
    const ITEM_ID = 'item-id-0123456789'
    const FOLDER_ID = 'folder-id-0123456789'
    const TARGET_ID = 'target-id-0123456789'

    function renameModel(
      overrides: Partial<ApprovalStepModel> = {},
    ): ApprovalStepModel {
      return createModel({
        toolName: 'google__drive_rename',
        connectorSlug: null,
        tool: 'google__drive_rename',
        input: { itemId: ITEM_ID, newName: 'Plan' },
        driveNames: { item: { name: 'Draft', id: ITEM_ID, kind: 'file' } },
        summary: 'Rename "Draft" to "Plan" in your Google Drive',
        ...overrides,
      })
    }

    function moveModel(
      overrides: Partial<ApprovalStepModel> = {},
    ): ApprovalStepModel {
      return createModel({
        toolName: 'google__drive_move',
        connectorSlug: null,
        tool: 'google__drive_move',
        input: {
          itemId: ITEM_ID,
          fromFolderId: FOLDER_ID,
          toFolderId: TARGET_ID,
        },
        driveNames: {
          item: { name: 'Plan', id: ITEM_ID, kind: 'folder' },
          from: { name: 'Projects', id: FOLDER_ID },
          to: { name: 'Archive', id: TARGET_ID },
        },
        summary: 'Move "Plan" from "Projects" to "Archive"',
        ...overrides,
      })
    }

    it('shows the old and the new name of a rename with the item id',
      async () => {
        const { wrapper } = await mountStep({ model: renameModel() })
        const card = wrapper.get(testId('drive-change'))

        expect(card.get(testId('drive-change-old-name')).text())
          .toContain('“Draft”')
        expect(card.get(testId('drive-change-name')).text()).toBe('Plan')
        expect(card.get(testId('drive-change-item-id')).text()).toBe(ITEM_ID)
        expect(card.get(testId('drive-change-type')).text()).toBe('File')
        expect(card.get(testId('drive-change-note')).text())
          .toContain('cannot delete files')
      })

    it('shows the item, both folders and the folder note of a move',
      async () => {
        const { wrapper } = await mountStep({ model: moveModel() })
        const card = wrapper.get(testId('drive-change'))

        expect(card.get(testId('drive-change-name')).text())
          .toContain('“Plan”')
        expect(card.get(testId('drive-change-from')).text())
          .toContain('“Projects”')
        expect(card.get(testId('drive-change-to')).text())
          .toContain('“Archive”')
        expect(card.get(testId('drive-change-to-id')).text()).toBe(TARGET_ID)
        expect(card.get(testId('drive-change-folder-note')).text())
          .toBe('Everything inside moves with it.')
      })

    it('shows My Drive (top level) for the alias in a move', async () => {
      const { wrapper } = await mountStep({
        model: moveModel({
          input: { itemId: ITEM_ID, fromFolderId: 'root', toFolderId: 'root' },
          driveNames: undefined,
        }),
      })

      expect(wrapper.get(testId('drive-change-from')).text())
        .toBe('My Drive (top level)')
      expect(wrapper.get(testId('drive-change-to')).text())
        .toBe('My Drive (top level)')
    })

    it.each([
      ['a rename with a hostile name', renameModel({
        input: { itemId: ITEM_ID, newName: '../../x' },
      })],
      ['a move into the item itself', moveModel({
        input: {
          itemId: ITEM_ID,
          fromFolderId: FOLDER_ID,
          toFolderId: ITEM_ID,
        },
      })],
    ])('shows no card for %s', async (_label, model) => {
      const { wrapper } = await mountStep({ model })

      expect(wrapper.find(testId('drive-change')).exists()).toBe(false)
    })

    it('names an item only for the id the server wrote it for', async () => {
      const { wrapper } = await mountStep({
        model: renameModel({
          driveNames: {
            item: { name: 'Other', id: 'other-id-0123456789', kind: 'file' },
          },
        }),
      })

      expect(wrapper.get(testId('drive-change-old-name')).text())
        .not.toContain('Other')
    })

    it('hands the names to the details panel', async () => {
      const { wrapper } = await mountStep({ model: moveModel() })

      await wrapper.get(testId('details')).trigger('click')

      expect(useSidePanel().currentView.value?.props).toMatchObject({
        toolName: 'google__drive_move',
        driveNames: { to: { name: 'Archive', id: TARGET_ID } },
      })
    })
  })

  describe('a Google Calendar event', () => {
    const description = `Agenda${'\n'.repeat(12)}THE END`
    const eventInput = {
      title: 'Planning',
      start: '2026-12-01T10:00:00+01:00',
      end: '2026-12-01T11:00:00+01:00',
      timeZone: 'Europe/Berlin',
      description,
      location: 'Room 4',
    }

    function eventModel(
      overrides: Partial<ApprovalStepModel> = {},
    ): ApprovalStepModel {
      return createModel({
        toolName: 'google__calendar_create_event',
        connectorSlug: null,
        tool: 'google__calendar_create_event',
        input: eventInput,
        summary: 'Create the Google Calendar event "Planning" on 2026-12-01',
        ...overrides,
      })
    }

    it('shows the title, times, time zone, location and description as '
      + 'they will be sent', async () => {
      const { wrapper } = await mountStep({ model: eventModel() })
      const card = wrapper.get(testId('calendar-event'))

      expect(card.get(testId('calendar-event-title')).text())
        .toBe('Planning')
      expect(card.get(testId('calendar-event-kind')).text())
        .toBe('Timed event')
      expect(card.get(testId('calendar-event-start')).text())
        .toContain('Tue, Dec 1, 2026, 10:00 (UTC+01:00)')
      expect(card.get(testId('calendar-event-start-exact')).text())
        .toBe('2026-12-01T10:00:00+01:00')
      expect(card.get(testId('calendar-event-end')).text())
        .toContain('Tue, Dec 1, 2026, 11:00 (UTC+01:00)')
      expect(card.get(testId('calendar-event-end-exact')).text())
        .toBe('2026-12-01T11:00:00+01:00')
      expect(card.get(testId('calendar-event-duration')).text())
        .toBe('1 hour')
      expect(card.get(testId('calendar-event-time-zone')).text())
        .toBe('Europe/Berlin')
      expect(card.get(testId('calendar-event-location')).text())
        .toBe('Room 4')
      expect(card.find(testId('calendar-event-last-day')).exists())
        .toBe(false)
      expect(card.get(testId('calendar-event-lines')).text())
        .toContain('13 lines')
      expect(card.get(testId('calendar-event-description')).text())
        .toBe('Agenda\n[11 blank lines]\nTHE END')
    })

    it('says nobody is invited and no email is sent', async () => {
      const { wrapper } = await mountStep({ model: eventModel() })

      expect(wrapper.get(testId('calendar-event-note')).text())
        .toContain('Nobody is invited and no email is sent')
    })

    it('shows an all-day event with its exclusive end and its last day',
      async () => {
        const { wrapper } = await mountStep({
          model: eventModel({
            input: {
              title: 'Holiday',
              start: '2026-12-24',
              end: '2026-12-26',
              timeZone: 'Europe/Berlin',
            },
          }),
        })

        expect(wrapper.get(testId('calendar-event-kind')).text())
          .toBe('All-day event')
        expect(wrapper.get(testId('calendar-event')).text())
          .toContain('End (not included)')
        expect(wrapper.get(testId('calendar-event-last-day')).text())
          .toContain('Fri, Dec 25, 2026')
        expect(wrapper.get(testId('calendar-event-last-day-exact')).text())
          .toBe('2026-12-25')
        expect(wrapper.get(testId('calendar-event-start')).text())
          .toContain('Thu, Dec 24, 2026')
        expect(wrapper.get(testId('calendar-event-duration')).text())
          .toBe('2 days')
        expect(wrapper.find(testId('calendar-event-description')).exists())
          .toBe(false)
      })

    it('makes the scrolling description a labeled region keyboard users '
      + 'can reach', async () => {
      const { wrapper } = await mountStep({ model: eventModel() })
      const region = wrapper.get(testId('calendar-event-description'))

      expect(region.attributes('tabindex')).toBe('0')
      expect(region.attributes('role')).toBe('region')
      expect(region.attributes('aria-label')).toBe('Event description')
    })

    it('offers Allow once and nothing else to allow', async () => {
      const { wrapper } = await mountStep({ model: eventModel() })

      expect(wrapper.find(testId('allow-once')).exists()).toBe(true)
      expect(wrapper.find(testId('allow-chat')).exists()).toBe(false)
      expect(wrapper.find(testId('allow-always')).exists()).toBe(false)
    })

    it('renders the text as text, never as markup', async () => {
      const { wrapper } = await mountStep({
        model: eventModel({
          input: {
            ...eventInput,
            title: '<img src=x onerror=alert(1)>',
            description: '<b>bold</b> [link](https://evil.example)',
          },
        }),
      })
      const card = wrapper.get(testId('calendar-event'))

      expect(card.find('img').exists()).toBe(false)
      expect(card.find('b').exists()).toBe(false)
      expect(card.get(testId('calendar-event-description')).text())
        .toBe('<b>bold</b> [link](https://evil.example)')
    })

    it('shows no event card for another tool or an input that cannot run',
      async () => {
        const other = await mountStep({
          model: createModel({ input: eventInput }),
        })
        const endBeforeStart = await mountStep({
          model: eventModel({
            input: { ...eventInput, end: '2026-12-01T09:00:00+01:00' },
          }),
        })
        const broken = await mountStep({
          model: eventModel({ input: { nothing: true } }),
        })

        for (const mounted of [other, endBeforeStart, broken]) {
          expect(mounted.wrapper.find(testId('calendar-event')).exists())
            .toBe(false)
        }
      })
  })

  it('shows no preview for a call without text to save', async () => {
    const { wrapper } = await mountStep()

    expect(wrapper.find(testId('preview')).exists()).toBe(false)
  })

  it('is read-only without a controller', async () => {
    const { wrapper } = await mountStep({ controller: null })

    expect(wrapper.find(testId('actions')).exists()).toBe(false)
    expect(wrapper.get('[data-testid="reasoning-approval-step"]')
      .attributes('tabindex')).toBeUndefined()
  })
})

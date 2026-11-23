import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'
import { computed, shallowRef } from 'vue'
import { TOOL_APPROVAL_CONTROLLER_KEY } from '~/composables/tool-approvals'
import type { ToolApprovalController } from '~/composables/tool-approvals'
import ApprovalDetails from '../../../../../app/components/Chat/Reasoning/ApprovalDetails.vue'

const GOOGLE_WRITE_TOOL_NAMES = [
  'google__calendar_create_event',
  'google__gmail_create_draft',
  'google__drive_save_file',
  'google__drive_create_folder',
]

const EVENT_INPUT = {
  title: 'Planning',
  start: '2026-12-01T10:00:00+01:00',
  end: '2026-12-01T11:00:00+01:00',
  timeZone: 'Europe/Berlin',
  description: 'Agenda',
  location: 'Room 4',
}

function testId(name: string): string {
  return `[data-testid="reasoning-approval-step-${name}"]`
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

async function mountDetails(
  toolName: string,
  input: unknown,
  controller: ToolApprovalController = createController(),
) {
  const wrapper = await mountSuspended(ApprovalDetails, {
    props: {
      title: 'Approval',
      toolName,
      summaryLine: '',
      reasonText: 'Changes data',
      input,
      isShortened: false,
    },
    global: {
      provide: { [TOOL_APPROVAL_CONTROLLER_KEY as symbol]: controller },
    },
  })

  return { wrapper, controller }
}

describe('Chat/Reasoning/ApprovalDetails', () => {
  it('shows the same event view as the approval card for a create-event call',
    async () => {
      const { wrapper } = await mountDetails(
        'google__calendar_create_event',
        EVENT_INPUT,
      )
      const card = wrapper.get(testId('calendar-event'))

      expect(card.get(testId('calendar-event-title')).text()).toBe('Planning')
      expect(card.get(testId('calendar-event-start')).text())
        .toContain('Tue, Dec 1, 2026, 10:00 (UTC+01:00)')
      expect(card.get(testId('calendar-event-end-exact')).text())
        .toBe('2026-12-01T11:00:00+01:00')
      expect(card.get(testId('calendar-event-duration')).text())
        .toBe('1 hour')
      expect(card.get(testId('calendar-event-time-zone')).text())
        .toBe('Europe/Berlin')
      expect(card.get(testId('calendar-event-location')).text())
        .toBe('Room 4')
      expect(card.get(testId('calendar-event-note')).text())
        .toContain('Nobody is invited and no email is sent')
    })

  it('shows the same folder view as the approval card, with the names the '
    + 'server wrote and no way to allow it', async () => {
    const folderId = 'folder-id-0123456789'
    const wrapper = await mountSuspended(ApprovalDetails, {
      props: {
        title: 'Approval',
        toolName: 'google__drive_create_folder',
        summaryLine: '',
        reasonText: 'Changes data',
        input: { name: 'Reports', parentFolderId: folderId },
        isShortened: false,
        driveNames: { folder: { name: 'Projects', id: folderId } },
      },
    })
    const card = wrapper.get(testId('drive-change'))

    expect(card.get(testId('drive-change-name')).text()).toBe('Reports')
    expect(card.get(testId('drive-change-parent')).text())
      .toContain('“Projects”')
    expect(card.get(testId('drive-change-parent-id')).text()).toBe(folderId)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it.each([
    [
      'google__drive_rename',
      { itemId: 'item-id-0123456789', newName: 'Plan' },
      { item: { name: 'Draft', id: 'item-id-0123456789', kind: 'file' } },
      'Rename',
      'drive-change-old-name',
    ],
    [
      'google__drive_move',
      {
        itemId: 'item-id-0123456789',
        fromFolderId: 'root',
        toFolderId: 'target-id-0123456789',
      },
      {
        item: { name: 'Plan', id: 'item-id-0123456789', kind: 'folder' },
        to: { name: 'Archive', id: 'target-id-0123456789' },
      },
      'Move',
      'drive-change-to',
    ],
    [
      'google__drive_create_folder',
      { name: 'Reports' },
      undefined,
      'Folder',
      'drive-change-parent',
    ],
  ] as const)('headlines the %s details by the kind of change and shows the '
    + 'same card with no way to allow it', async (
    toolName,
    input,
    driveNames,
    heading,
    cardTestId,
  ) => {
    const wrapper = await mountSuspended(ApprovalDetails, {
      props: {
        title: 'Approval',
        toolName,
        summaryLine: '',
        reasonText: 'Changes data',
        input,
        isShortened: false,
        driveNames: driveNames as never,
      },
    })

    expect(wrapper.get('[data-testid="approval-details-drive-heading"]').text())
      .toBe(heading)
    expect(wrapper.get(testId(cardTestId)).exists()).toBe(true)
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('shows no change card for a rename or move the server would refuse',
    async () => {
      for (const [toolName, input] of [
        ['google__drive_rename', { itemId: 'item-id-0123456789', newName: '' }],
        ['google__drive_move', { itemId: 'short', fromFolderId: 'root' }],
      ] as const) {
        const wrapper = await mountSuspended(ApprovalDetails, {
          props: {
            title: 'Approval',
            toolName,
            summaryLine: '',
            reasonText: 'Changes data',
            input,
            isShortened: false,
          },
        })

        expect(wrapper.find(testId('drive-change')).exists()).toBe(false)
      }
    })

  it('names no parent for names of the wrong shape', async () => {
    const folderId = 'folder-id-0123456789'
    const wrapper = await mountSuspended(ApprovalDetails, {
      props: {
        title: 'Approval',
        toolName: 'google__drive_create_folder',
        summaryLine: '',
        reasonText: 'Changes data',
        input: { name: 'Reports', parentFolderId: folderId },
        isShortened: false,
        driveNames: {
          folder: { name: 'a'.repeat(300), id: folderId },
        } as never,
      },
    })

    expect(wrapper.get(testId('drive-change-parent')).text())
      .not.toContain('aaaa')
  })

  it('shows the same draft view as the approval card for a create-draft call',
    async () => {
      const { wrapper } = await mountDetails('google__gmail_create_draft', {
        to: [{ email: 'alice@example.test', name: 'Alice' }],
        cc: [{ email: 'carol@example.test' }],
        subject: 'Lunch plans',
        body: 'Shall we meet at noon?',
        replyToThreadId: '18c0ffee',
      })
      const card = wrapper.get(testId('gmail-draft'))

      expect(card.get(testId('gmail-draft-to')).text())
        .toContain('alice@example.test')
      expect(card.get(testId('gmail-draft-cc')).text())
        .toContain('carol@example.test')
      expect(card.get(testId('gmail-draft-subject')).text())
        .toBe('Lunch plans')
      expect(card.get(testId('gmail-draft-body')).text())
        .toBe('Shall we meet at noon?')
      expect(card.get(testId('gmail-draft-lines')).text())
        .toContain('a reply in the thread above')
      expect(card.get(testId('gmail-draft-note')).text())
        .toContain('Besidka cannot send it')
    })

  it('shows no draft view for another tool or an input that cannot run',
    async () => {
      const other = await mountDetails('mcp__linear__create_issue', {
        subject: 'x',
        body: 'y',
        to: [{ email: 'alice@example.test' }],
      })
      const broken = await mountDetails(
        'google__gmail_create_draft',
        { nothing: true },
      )

      expect(other.wrapper.find(testId('gmail-draft')).exists()).toBe(false)
      expect(broken.wrapper.find(testId('gmail-draft')).exists()).toBe(false)
    })

  it('shows no event view for another tool or an input that cannot run',
    async () => {
      const other = await mountDetails('mcp__linear__create_issue', EVENT_INPUT)
      const broken = await mountDetails(
        'google__calendar_create_event',
        { nothing: true },
      )

      expect(other.wrapper.find(testId('calendar-event')).exists())
        .toBe(false)
      expect(broken.wrapper.find(testId('calendar-event')).exists())
        .toBe(false)
    })

  it.each(GOOGLE_WRITE_TOOL_NAMES)(
    'has no way to allow %s: no button and Enter does nothing',
    async (toolName) => {
      const { wrapper, controller } = await mountDetails(toolName, EVENT_INPUT)

      expect(wrapper.find('button').exists()).toBe(false)
      expect(wrapper.find('[role="button"]').exists()).toBe(false)
      expect(wrapper.find('a[href]').exists()).toBe(false)

      await wrapper.trigger('keydown', { key: 'Enter' })
      await wrapper.find('section').trigger('keydown', { key: 'Enter' })

      expect(controller.answer).not.toHaveBeenCalled()
    },
  )
})

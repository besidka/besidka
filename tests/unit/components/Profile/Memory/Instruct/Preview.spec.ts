import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import type { MemoryInstructPreviewOperation } from '../../../../../../shared/types/memory-instruct.d'
import Preview from '../../../../../../app/components/Profile/Memory/Instruct/Preview.vue'

enableAutoUnmount(afterEach)

function createOperation(
  overrides: Partial<MemoryInstructPreviewOperation> = {},
): MemoryInstructPreviewOperation {
  return {
    key: 'op-0',
    kind: 'create',
    status: 'ready',
    category: 'topics',
    id: null,
    updatedAt: null,
    before: null,
    after: {
      title: 'Travel',
      description: 'Trips the user plans',
      body: '- Lisbon in May',
    },
    reason: null,
    rejection: null,
    ...overrides,
  }
}

const OPERATIONS: MemoryInstructPreviewOperation[] = [
  createOperation(),
  createOperation({
    key: 'op-1',
    kind: 'update',
    category: 'profile',
    id: 'pub-1',
    updatedAt: '2026-10-01T10:00:00.000Z',
    before: {
      title: 'Profile',
      description: 'Who the user is',
      body: '- Lives in Warsaw\n- Speaks Polish',
    },
    after: {
      title: 'Profile',
      description: 'Who the user is',
      body: '- Lives in Kraków\n- Speaks Polish',
    },
  }),
  createOperation({
    key: 'op-2',
    kind: 'delete',
    id: 'pub-2',
    updatedAt: '2026-10-01T10:00:00.000Z',
    before: {
      title: 'Coffee',
      description: 'Coffee habits',
      body: '- Two flat whites',
    },
    after: null,
    reason: 'You asked to forget the coffee thing.',
  }),
  createOperation({
    key: 'op-3',
    status: 'rejected',
    after: {
      title: 'Health',
      description: 'Health',
      body: '- Sensitive',
    },
    rejection: {
      message: 'Sensitive topics are not saved to memory.',
      why: 'This entry looks like sensitive data (health).',
    },
  }),
]

async function mountPreview(selected: string[]) {
  return await mountSuspended(Preview, {
    props: {
      'operations': OPERATIONS,
      'selected': selected,
      'onUpdate:selected': () => {},
    },
  })
}

type Wrapper = Awaited<ReturnType<typeof mountPreview>>

function byTestId(wrapper: Wrapper, testId: string) {
  return wrapper.find(`[data-testid="${testId}"]`)
}

describe('Profile/Memory/Instruct/Preview', () => {
  it('labels each row with its kind and category', async () => {
    const wrapper = await mountPreview(['op-0', 'op-1'])

    expect(byTestId(wrapper, 'memory-instruct-kind-op-0').text()).toBe('New')
    expect(byTestId(wrapper, 'memory-instruct-kind-op-1').text())
      .toBe('Update')
    expect(byTestId(wrapper, 'memory-instruct-kind-op-2').text())
      .toBe('Delete')
    expect(byTestId(wrapper, 'memory-instruct-kind-op-3').text())
      .toBe('Rejected')
    expect(byTestId(wrapper, 'memory-instruct-operation-op-1').text())
      .toContain('Profile')
  })

  it('reflects the selection, so a delete stays unticked until chosen',
    async () => {
      const wrapper = await mountPreview(['op-0', 'op-1'])
      const deleteToggle = byTestId(wrapper, 'memory-instruct-toggle-op-2')
      const createToggle = byTestId(wrapper, 'memory-instruct-toggle-op-0')

      expect((createToggle.element as HTMLInputElement).checked).toBe(true)
      expect((deleteToggle.element as HTMLInputElement).checked).toBe(false)
      expect(byTestId(wrapper, 'memory-instruct-operation-op-2').text())
        .toContain('You asked to forget the coffee thing.')
    })

  it('emits the new selection when a delete is ticked explicitly',
    async () => {
      const wrapper = await mountPreview(['op-0', 'op-1'])

      await byTestId(wrapper, 'memory-instruct-toggle-op-2').setValue(true)

      expect(wrapper.emitted('update:selected')!.at(-1)).toEqual([
        ['op-0', 'op-1', 'op-2'],
      ])

      await byTestId(wrapper, 'memory-instruct-toggle-op-0').setValue(false)

      expect(wrapper.emitted('update:selected')!.at(-1)).toEqual([
        ['op-1'],
      ])
    })

  it('shows a rejected row with its reason and no checkbox', async () => {
    const wrapper = await mountPreview(['op-0'])
    const row = byTestId(wrapper, 'memory-instruct-operation-op-3')

    expect(row.attributes('data-status')).toBe('rejected')
    expect(row.find('input[type="checkbox"]').exists()).toBe(false)
    expect(byTestId(wrapper, 'memory-instruct-rejection-op-3').text())
      .toBe('Sensitive topics are not saved to memory.')
    expect(row.text()).toContain('sensitive data (health)')
  })

  it('shows an update as a line diff of the body', async () => {
    const wrapper = await mountPreview([])
    const lines = byTestId(wrapper, 'memory-instruct-diff-op-1')
      .findAll('li')
      .map((line) => {
        return {
          type: line.attributes('data-diff'),
          text: line.text(),
        }
      })

    expect(lines).toEqual([
      { type: 'removed', text: expect.stringContaining('Lives in Warsaw') },
      { type: 'added', text: expect.stringContaining('Lives in Kraków') },
      { type: 'same', text: expect.stringContaining('Speaks Polish') },
    ])
  })
})

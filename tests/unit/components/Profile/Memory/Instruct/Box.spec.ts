import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  MemoryInstructPreviewOperation,
  MemoryInstructPreviewResponse,
} from '../../../../../../shared/types/memory-instruct.d'
import Box from '../../../../../../app/components/Profile/Memory/Instruct/Box.vue'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useWarningMessage', () => mocks.warning)

enableAutoUnmount(afterEach)

const PREVIEW_URL = '/api/v1/memory/instruct/preview'
const APPLY_URL = '/api/v1/memory/instruct/apply'

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

function createPreview(
  operations: MemoryInstructPreviewOperation[],
  overrides: Partial<MemoryInstructPreviewResponse> = {},
): MemoryInstructPreviewResponse {
  return {
    projectId: null,
    operations,
    blocked: {},
    model: {
      source: 'setting',
      providerId: 'openai',
      gatewayId: null,
      modelId: 'gpt-test',
      modelName: 'GPT Test',
    },
    capacity: { total: 3, limit: 30 },
    ...overrides,
  }
}

const DELETE_OPERATION = createOperation({
  key: 'op-1',
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
})

const REJECTED_OPERATION = createOperation({
  key: 'op-2',
  status: 'rejected',
  rejection: { message: 'Not saved', why: 'Sensitive' },
})

async function mountBox(props: Record<string, unknown> = {}) {
  return await mountSuspended(Box, { props })
}

type Wrapper = Awaited<ReturnType<typeof mountBox>>

function byTestId(wrapper: Wrapper, testId: string) {
  return wrapper.get(`[data-testid="${testId}"]`)
}

function isDisabled(wrapper: Wrapper, testId: string): boolean {
  return byTestId(wrapper, testId).classes().includes('btn-disabled')
}

async function previewText(wrapper: Wrapper, text: string) {
  await byTestId(wrapper, 'memory-instruct-text').setValue(text)
  await byTestId(wrapper, 'memory-instruct-preview').trigger('click')
  await flushPromises()
}

describe('Profile/Memory/Instruct/Box', () => {
  beforeEach(() => {
    mocks.fetch.mockReset()
    mocks.success.mockReset()
    mocks.warning.mockReset()
  })

  it('uses a rounded-box textarea and says it runs on the user\'s key',
    async () => {
      const wrapper = await mountBox({ modelId: 'gpt-unknown-model' })
      const textarea = byTestId(wrapper, 'memory-instruct-text')

      expect(textarea.classes()).toEqual(expect.arrayContaining([
        'textarea',
        'textarea-bordered',
        'rounded-box',
        'resize-none',
      ]))
      expect(wrapper.html()).not.toContain('rounded-full')
      expect(byTestId(wrapper, 'memory-instruct-hint').text())
        .toContain('Runs once on your own API key')
      expect(byTestId(wrapper, 'memory-instruct-model').text())
        .toContain('gpt-unknown-model')
      expect(isDisabled(wrapper, 'memory-instruct-preview')).toBe(true)
    })

  it('previews with the project id and ticks everything but deletes',
    async () => {
      mocks.fetch.mockResolvedValueOnce(createPreview([
        createOperation(),
        DELETE_OPERATION,
        REJECTED_OPERATION,
      ]))

      const wrapper = await mountBox({ projectId: 'pub-9' })

      await previewText(wrapper, 'Deadline is 15 Nov. Forget the coffee.')

      expect(mocks.fetch).toHaveBeenCalledWith(PREVIEW_URL, {
        method: 'POST',
        body: {
          text: 'Deadline is 15 Nov. Forget the coffee.',
          projectId: 'pub-9',
        },
      })

      const createToggle = byTestId(wrapper, 'memory-instruct-toggle-op-0')
      const deleteToggle = byTestId(wrapper, 'memory-instruct-toggle-op-1')

      expect((createToggle.element as HTMLInputElement).checked).toBe(true)
      expect((deleteToggle.element as HTMLInputElement).checked).toBe(false)
      expect(byTestId(wrapper, 'memory-instruct-apply').text())
        .toContain('Apply 1 change')
      expect(byTestId(wrapper, 'memory-instruct-model').text())
        .toContain('GPT Test')
    })

  it('applies only the ticked ready operations and reports the counts',
    async () => {
      mocks.fetch.mockResolvedValueOnce(createPreview([
        createOperation(),
        DELETE_OPERATION,
        REJECTED_OPERATION,
      ]))
      mocks.fetch.mockResolvedValueOnce({
        projectId: null,
        created: 1,
        updated: 0,
        deleted: 1,
        skipped: 0,
        entries: [],
        deletedIds: ['pub-2'],
      })

      const wrapper = await mountBox()

      await previewText(wrapper, 'Lisbon in May. Forget the coffee thing.')
      await byTestId(wrapper, 'memory-instruct-toggle-op-1').setValue(true)

      expect(byTestId(wrapper, 'memory-instruct-apply').text())
        .toContain('Apply 2 changes')

      await byTestId(wrapper, 'memory-instruct-apply').trigger('click')
      await flushPromises()

      expect(mocks.fetch).toHaveBeenLastCalledWith(APPLY_URL, {
        method: 'POST',
        body: {
          operations: [
            {
              kind: 'create',
              category: 'topics',
              title: 'Travel',
              description: 'Trips the user plans',
              body: '- Lisbon in May',
            },
            {
              kind: 'delete',
              id: 'pub-2',
              updatedAt: '2026-10-01T10:00:00.000Z',
            },
          ],
        },
      })
      expect(mocks.success).toHaveBeenCalledWith(
        'Memory updated: 1 added, 0 updated, 1 removed',
      )
      expect(wrapper.emitted('changed')).toHaveLength(1)
      expect(wrapper.find('[data-testid="memory-instruct-result"]').exists())
        .toBe(false)
      expect(
        (byTestId(wrapper, 'memory-instruct-text').element as HTMLTextAreaElement)
          .value,
      ).toBe('')
    })

  it('cannot apply when only a rejected row is left', async () => {
    mocks.fetch.mockResolvedValueOnce(createPreview([REJECTED_OPERATION]))

    const wrapper = await mountBox()

    await previewText(wrapper, 'I have a condition')

    expect(isDisabled(wrapper, 'memory-instruct-apply')).toBe(true)
    expect(byTestId(wrapper, 'memory-instruct-apply').text())
      .toContain('Apply 0 changes')
  })

  it('blocks apply when the ticked changes exceed the entry cap',
    async () => {
      mocks.fetch.mockResolvedValueOnce(createPreview([
        createOperation(),
        DELETE_OPERATION,
      ], { capacity: { total: 30, limit: 30 } }))

      const wrapper = await mountBox()

      await previewText(wrapper, 'Lisbon. Forget the coffee thing.')

      expect(byTestId(wrapper, 'memory-instruct-capacity').text())
        .toContain('1 more than the 30 entries')
      expect(isDisabled(wrapper, 'memory-instruct-apply')).toBe(true)

      await byTestId(wrapper, 'memory-instruct-toggle-op-1').setValue(true)

      expect(wrapper.find('[data-testid="memory-instruct-capacity"]').exists())
        .toBe(false)
      expect(isDisabled(wrapper, 'memory-instruct-apply')).toBe(false)
    })

  it('cancel clears the preview and keeps the text', async () => {
    mocks.fetch.mockResolvedValueOnce(createPreview([createOperation()]))

    const wrapper = await mountBox()

    await previewText(wrapper, 'Lisbon in May')
    await byTestId(wrapper, 'memory-instruct-cancel').trigger('click')

    expect(wrapper.find('[data-testid="memory-instruct-result"]').exists())
      .toBe(false)
    expect(
      (byTestId(wrapper, 'memory-instruct-text').element as HTMLTextAreaElement)
        .value,
    ).toBe('Lisbon in May')
  })

  it('shows the server reason when no model is available', async () => {
    mocks.fetch.mockRejectedValueOnce(Object.assign(new Error('Failed'), {
      statusCode: 409,
      data: {
        statusCode: 409,
        message: 'No model available for memory',
        data: { why: 'No saved API key', fix: 'Add an API key' },
      },
    }))

    const wrapper = await mountBox()

    await previewText(wrapper, 'Lisbon in May')

    const error = byTestId(wrapper, 'memory-instruct-error')

    expect(error.text()).toContain('No model available for memory')
    expect(error.text()).toContain('Add an API key')
  })
})

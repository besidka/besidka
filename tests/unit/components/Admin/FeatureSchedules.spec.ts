import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import FeatureSchedules from '../../../../app/components/Admin/FeatureSchedules.vue'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  fetch: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)

const DAY_MS = 86_400_000
const gateMs = Date.now() + 60 * DAY_MS
const gateDate = new Date(gateMs).toISOString().slice(0, 10)

const closedGate = {
  open: false,
  reason: 'notice_pending',
  override: 'auto',
  noticeId: '2026-11-experimental-features',
  effectiveAt: gateDate,
  effectiveAtMs: gateMs,
  description: `Closed until the Privacy notice takes effect on ${gateDate}.`,
}

function localInput(daysAhead: number): string {
  const date = new Date(Date.now() + daysAhead * DAY_MS)
  const pad = (value: number) => String(value).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
    + `-${pad(date.getDate())}T10:00`
}

function createSchedule(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    flag: 'artifacts',
    change: { allowRoles: ['admin', 'tester'] },
    runAt: Math.floor(Date.parse('2099-01-02T10:00:00Z') / 1000),
    status: 'pending',
    requiresNoticeId: null,
    appliedAt: null,
    error: null,
    ...overrides,
  }
}

async function mountSchedules(options: {
  schedules?: Record<string, unknown>[]
  rolloutGate?: Record<string, unknown>
} = {}) {
  return mountSuspended(FeatureSchedules, {
    props: {
      flag: 'artifacts',
      schedules: options.schedules ?? [],
      rolloutGate: options.rolloutGate ?? closedGate,
    } as never,
  })
}

async function flushPromises() {
  for (let tick = 0; tick < 6; tick += 1) {
    await Promise.resolve()
  }
}

describe('Admin feature schedules', () => {
  beforeEach(() => {
    mocks.confirm.mockReset().mockResolvedValue({ label: 'Schedule' })
    mocks.fetch.mockReset().mockResolvedValue({})
    mocks.success.mockReset()
    mocks.error.mockReset()
  })

  it('shows the computed gate and an empty state', async () => {
    const wrapper = await mountSchedules()

    expect(wrapper.get('[data-testid="admin-schedule-gate"]').text())
      .toContain(gateDate)
    expect(wrapper.find('[data-testid="admin-schedule-empty"]').exists())
      .toBe(true)
  })

  it('lists steps with their status, the gate wait and the failure reason', async () => {
    const wrapper = await mountSchedules({
      schedules: [
        createSchedule({
          id: 1,
          change: { rolloutBps: 2500 },
          status: 'blocked',
          requiresNoticeId: '2026-11-experimental-features',
        }),
        createSchedule({ id: 2, status: 'applied' }),
        createSchedule({
          id: 3,
          status: 'failed',
          error: 'Feature not found',
        }),
      ],
    })

    expect(wrapper.get('[data-testid="admin-schedule-step-1"]').text())
      .toContain(`Applies after ${gateDate}`)
    expect(wrapper.get('[data-testid="admin-schedule-status-2"]').text())
      .toBe('applied')
    expect(wrapper.get('[data-testid="admin-schedule-step-3"]').text())
      .toContain('Feature not found')
    expect(wrapper.find('[data-testid="admin-schedule-cancel-1"]').exists())
      .toBe(true)
    expect(wrapper.find('[data-testid="admin-schedule-cancel-2"]').exists())
      .toBe(false)
    expect(wrapper.find('[data-testid="admin-schedule-cancel-3"]').exists())
      .toBe(false)
  })

  it('cancels a pending step after a confirmation', async () => {
    const wrapper = await mountSchedules({ schedules: [createSchedule()] })

    await wrapper.get('[data-testid="admin-schedule-cancel-1"]')
      .trigger('click')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalled()
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/admin/features/artifacts/schedules/1/cancel',
      { method: 'POST' },
    )
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('adds and removes step rows and prefills a staged plan', async () => {
    const wrapper = await mountSchedules()

    await wrapper.get('[data-testid="admin-schedule-add-step"]')
      .trigger('click')
    await wrapper.get('[data-testid="admin-schedule-add-step"]')
      .trigger('click')

    expect(wrapper.findAll('[data-testid^="admin-schedule-row-"]'))
      .toHaveLength(2)

    await wrapper.get('[data-testid="admin-schedule-remove-0"]')
      .trigger('click')

    expect(wrapper.findAll('[data-testid^="admin-schedule-row-"]'))
      .toHaveLength(1)

    await wrapper.get('[data-testid="admin-schedule-staged-plan"]')
      .trigger('click')

    expect(wrapper.findAll('[data-testid^="admin-schedule-row-"]'))
      .toHaveLength(3)
    expect(wrapper.get('[data-testid="admin-schedule-testers-0"]')
      .element).toHaveProperty('checked', true)
    expect(wrapper.get('[data-testid="admin-schedule-rollout-1"]')
      .element).toHaveProperty('value', '25')
  })

  it('refuses a past date and keeps the submit disabled', async () => {
    const wrapper = await mountSchedules()

    await wrapper.get('[data-testid="admin-schedule-add-step"]')
      .trigger('click')
    await wrapper.get('[data-testid="admin-schedule-run-at-0"]')
      .setValue('2020-01-01T10:00')
    await wrapper.get('[data-testid="admin-schedule-testers-0"]')
      .setValue(true)
    await nextTick()

    expect(wrapper.get('[data-testid="admin-schedule-error-0"]').text())
      .toContain('future')
    expect(wrapper.get('[data-testid="admin-schedule-submit"]').element.tagName)
      .not.toBe('BUTTON')
  })

  it('flags a time that another open step already uses', async () => {
    const wrapper = await mountSchedules({
      schedules: [createSchedule({
        runAt: Math.floor(new Date(localInput(10)).getTime() / 1000),
      })],
    })

    await wrapper.get('[data-testid="admin-schedule-add-step"]')
      .trigger('click')
    await wrapper.get('[data-testid="admin-schedule-run-at-0"]')
      .setValue(localInput(10))
    await wrapper.get('[data-testid="admin-schedule-testers-0"]')
      .setValue(true)
    await nextTick()

    expect(wrapper.get('[data-testid="admin-schedule-error-0"]').text())
      .toContain('already runs')
  })

  it.each(['150', '-5', ''])(
    'shows a row message instead of breaking for a rollout of "%s"',
    async (value) => {
      const wrapper = await mountSchedules()

      await wrapper.get('[data-testid="admin-schedule-add-step"]')
        .trigger('click')
      await wrapper.get('[data-testid="admin-schedule-run-at-0"]')
        .setValue(localInput(10))
      await wrapper.get('[data-testid="admin-schedule-rollout-toggle-0"]')
        .setValue(true)
      await wrapper.get('[data-testid="admin-schedule-rollout-0"]')
        .setValue(value)
      await nextTick()

      expect(wrapper.get('[data-testid="admin-schedule-error-0"]').text())
        .toContain('between 0 and 100')
      expect(wrapper.get('[data-testid="admin-schedule-submit"]')
        .element.tagName).not.toBe('BUTTON')
    },
  )

  it('shows "applies after" for a rollout dated before the notice', async () => {
    const wrapper = await mountSchedules()

    await wrapper.get('[data-testid="admin-schedule-add-step"]')
      .trigger('click')
    await wrapper.get('[data-testid="admin-schedule-run-at-0"]')
      .setValue(localInput(10))
    await wrapper.get('[data-testid="admin-schedule-rollout-toggle-0"]')
      .setValue(true)
    await nextTick()

    expect(wrapper.get('[data-testid="admin-schedule-gate-hint-0"]').text())
      .toContain(`Applies after ${gateDate}`)
    expect(wrapper.find('[data-testid="admin-schedule-error-0"]').exists())
      .toBe(false)
  })

  it('posts the steps as UTC with roles and basis points after a confirmation', async () => {
    const wrapper = await mountSchedules()

    await wrapper.get('[data-testid="admin-schedule-add-step"]')
      .trigger('click')
    await wrapper.get('[data-testid="admin-schedule-add-step"]')
      .trigger('click')
    await wrapper.get('[data-testid="admin-schedule-run-at-0"]')
      .setValue(localInput(20))
    await wrapper.get('[data-testid="admin-schedule-testers-0"]')
      .setValue(true)
    await wrapper.get('[data-testid="admin-schedule-run-at-1"]')
      .setValue(localInput(27))
    await wrapper.get('[data-testid="admin-schedule-rollout-toggle-1"]')
      .setValue(true)
    await wrapper.get('[data-testid="admin-schedule-rollout-1"]')
      .setValue('25')
    await nextTick()
    await wrapper.get('[data-testid="admin-schedule-form"]')
      .trigger('submit')
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
      actions: ['Schedule'],
    }))
    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/admin/features/artifacts/schedules',
      {
        method: 'POST',
        body: {
          steps: [
            {
              runAt: new Date(localInput(20)).toISOString(),
              grantRoles: ['tester'],
            },
            {
              runAt: new Date(localInput(27)).toISOString(),
              rolloutBps: 2500,
            },
          ],
        },
      },
    )
    expect(wrapper.emitted('changed')).toHaveLength(1)
  })

  it('does not post when the confirmation is declined', async () => {
    mocks.confirm.mockResolvedValue(null)

    const wrapper = await mountSchedules()

    await wrapper.get('[data-testid="admin-schedule-add-step"]')
      .trigger('click')
    await wrapper.get('[data-testid="admin-schedule-run-at-0"]')
      .setValue(localInput(20))
    await wrapper.get('[data-testid="admin-schedule-testers-0"]')
      .setValue(true)
    await nextTick()
    await wrapper.get('[data-testid="admin-schedule-form"]')
      .trigger('submit')
    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

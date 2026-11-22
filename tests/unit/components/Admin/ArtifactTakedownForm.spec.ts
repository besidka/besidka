import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TakedownForm from '../../../../app/components/Admin/ArtifactTakedownForm.vue'

enableAutoUnmount(afterEach)

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  confirm: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

mockNuxtImport('$fetch', () => mocks.fetch)
mockNuxtImport('useConfirm', () => mocks.confirm)
mockNuxtImport('useSuccessMessage', () => mocks.success)
mockNuxtImport('useErrorMessage', () => mocks.error)

const STATEMENT = 'Phishing page that collects bank passwords.'
const LINK = 'https://besidka.test/a/secret-token'

function byTestId(testId: string) {
  return `[data-testid="${testId}"]`
}

async function fill(wrapper: Awaited<ReturnType<typeof mountSuspended>>) {
  await wrapper.get(byTestId('admin-takedown-target')).setValue(LINK)
  await wrapper.get(byTestId('admin-takedown-scope')).setValue('share')
  await wrapper.get(byTestId('admin-takedown-statement')).setValue(STATEMENT)
  await wrapper.get(byTestId('admin-takedown-legal-hold')).setValue(true)
}

describe('Admin/ArtifactTakedownForm', () => {
  beforeEach(() => {
    mocks.fetch.mockReset().mockResolvedValue({
      scope: 'share',
      takenDown: 1,
      alreadyTakenDown: 0,
      artifactIds: ['ArtifactPublicId1'],
      shareId: 'sh_1',
      ownerUserId: 3,
      legalHoldUntil: '2027-05-09T10:00:00.000Z',
    })
    mocks.confirm.mockReset().mockImplementation(async (options: {
      actions: string[]
    }) => {
      return { label: options.actions[0] }
    })
    mocks.success.mockReset()
    mocks.error.mockReset()
  })

  it('keeps Take down disabled until a target and a statement are given',
    async () => {
      const wrapper = await mountSuspended(TakedownForm)
      const submit = wrapper.get(byTestId('admin-takedown-submit'))

      expect(submit.attributes('disabled')).toBeDefined()

      await wrapper.get(byTestId('admin-takedown-target')).setValue(LINK)
      await wrapper.get(byTestId('admin-takedown-statement'))
        .setValue('too short')

      expect(submit.attributes('disabled')).toBeDefined()
      expect(wrapper.text()).toContain('Keep for 6 months (removal order)')
    })

  it('takes down after confirmation and clears the token from the form',
    async () => {
      const wrapper = await mountSuspended(TakedownForm)

      await fill(wrapper)
      await wrapper.get(byTestId('admin-takedown-form')).trigger('submit')
      await flushPromises()

      expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({
        alert: true,
        actions: ['Take down'],
      }))
      expect(mocks.fetch).toHaveBeenCalledWith(
        '/api/v1/admin/artifact-takedowns',
        {
          method: 'POST',
          body: {
            target: LINK,
            scope: 'share',
            statement: STATEMENT,
            legalHold: true,
          },
        },
      )
      expect((wrapper.get(byTestId('admin-takedown-target'))
        .element as HTMLInputElement).value).toBe('')
      expect(wrapper.get(byTestId('admin-takedown-result')).text())
        .toContain('Taken down: 1')
      expect(wrapper.text()).not.toContain('secret-token')
      expect(wrapper.emitted('changed')).toHaveLength(1)
    })

  it('restores the link it took down', async () => {
    const wrapper = await mountSuspended(TakedownForm)

    await fill(wrapper)
    await wrapper.get(byTestId('admin-takedown-form')).trigger('submit')
    await flushPromises()
    mocks.fetch.mockResolvedValue({ restored: true })

    const restore = wrapper.findAll('button').find((button) => {
      return button.text() === 'Restore link sh_1'
    })!

    await restore.trigger('click')
    await flushPromises()

    expect(mocks.fetch).toHaveBeenLastCalledWith(
      '/api/v1/admin/artifact-takedowns/restore',
      { method: 'POST', body: { shareId: 'sh_1' } },
    )
  })

  it('does nothing when the admin cancels', async () => {
    mocks.confirm.mockResolvedValue(null)

    const wrapper = await mountSuspended(TakedownForm)

    await fill(wrapper)
    await wrapper.get(byTestId('admin-takedown-form')).trigger('submit')
    await flushPromises()

    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

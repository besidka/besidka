import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceDialog from '../../../../../app/components/Profile/Skills/WorkspaceDialog.client.vue'

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
}))

mockNuxtImport('useConfirm', () => mocks.confirm)

enableAutoUnmount(afterEach)

function get(id: string): HTMLElement {
  const element = document.body.querySelector(`[data-testid="${id}"]`)

  if (!element) {
    throw new Error(`Missing ${id}`)
  }

  return element as HTMLElement
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mountSuspended(WorkspaceDialog, {
    props: { title: 'Edit review-pr', ...props },
    slots: { default: '<p>content</p>', footer: '<button>Save</button>' },
    attachTo: document.body,
    global: { stubs: { teleport: false } },
  })
}

describe('Profile/Skills/WorkspaceDialog', () => {
  beforeEach(() => {
    vi.spyOn(HTMLDialogElement.prototype, 'showModal')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.setAttribute('open', '')
      })
    vi.spyOn(HTMLDialogElement.prototype, 'close')
      .mockImplementation(function (this: HTMLDialogElement) {
        this.removeAttribute('open')
        this.dispatchEvent(new Event('close'))
      })
    mocks.confirm.mockReset()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('closes at once when it is not an editing dialog', async () => {
    const wrapper = await mountDialog({ isDirty: true })

    get('skills-dialog-close').click()
    await flushPromises()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('closes at once when an editing dialog has no unsaved changes', async () => {
    const wrapper = await mountDialog({ mode: 'edit', isDirty: false })

    get('skills-dialog-close').click()
    await flushPromises()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('asks before it discards unsaved changes and stays open on Keep editing', async () => {
    mocks.confirm.mockResolvedValue(false)

    const wrapper = await mountDialog({ mode: 'edit', isDirty: true })

    get('skills-dialog-close').click()
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledWith({
      text: 'Discard your unsaved changes?',
      actions: ['Discard'],
      labelDecline: 'Keep editing',
    })
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('closes after the changes are discarded', async () => {
    mocks.confirm.mockResolvedValue(true)

    const wrapper = await mountDialog({ mode: 'edit', isDirty: true })

    get('skills-dialog-close').click()
    await flushPromises()

    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('guards Escape the same way', async () => {
    mocks.confirm.mockResolvedValue(false)

    await mountDialog({ mode: 'edit', isDirty: true })

    const event = new Event('cancel', { cancelable: true })

    get('skills-dialog').dispatchEvent(event)
    await flushPromises()

    expect(event.defaultPrevented).toBe(true)
    expect(mocks.confirm).toHaveBeenCalledTimes(1)
  })

  it('asks once while a confirmation is open', async () => {
    let answer!: (value: boolean) => void

    mocks.confirm.mockReturnValue(new Promise<boolean>((resolve) => {
      answer = resolve
    }))
    await mountDialog({ mode: 'edit', isDirty: true })

    get('skills-dialog-close').click()
    get('skills-dialog-close').click()
    await flushPromises()

    expect(mocks.confirm).toHaveBeenCalledTimes(1)
    answer(false)
  })

  it('does not close while it is busy', async () => {
    const wrapper = await mountDialog({
      mode: 'edit',
      isDirty: true,
      isBusy: true,
    })

    get('skills-dialog-close').click()
    await flushPromises()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('closes without asking when the owner forces it after a save', async () => {
    const wrapper = await mountDialog({ mode: 'edit', isDirty: true })

    ;(wrapper.vm as unknown as { forceClose: () => void }).forceClose()
    await flushPromises()

    expect(mocks.confirm).not.toHaveBeenCalled()
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('fills the body in edit mode instead of scrolling it', async () => {
    await mountDialog({ mode: 'edit', size: 'workspace' })

    expect(get('skills-dialog-body').className).toContain('overflow-hidden')
    expect(get('skills-dialog-box').className).toContain('max-w-5xl')
  })

  it('scrolls the body in view mode', async () => {
    await mountDialog()

    expect(get('skills-dialog-body').className).toContain('overflow-y-auto')
  })
})

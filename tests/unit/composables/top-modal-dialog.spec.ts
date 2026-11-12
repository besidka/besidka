import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { useTopModalDialog } from '../../../app/composables/top-modal-dialog'

enableAutoUnmount(afterEach)

let topDialog: ReturnType<typeof useTopModalDialog>['topDialog']
let refresh: ReturnType<typeof useTopModalDialog>['refresh']

const Host = defineComponent({
  setup() {
    const composable = useTopModalDialog()

    topDialog = composable.topDialog
    refresh = composable.refresh

    return () => h('div')
  },
})

function createDialog(): HTMLDialogElement {
  const dialog = document.createElement('dialog')

  dialog.className = 'test-dialog'
  document.body.appendChild(dialog)

  return dialog
}

let notify: (dialog: HTMLDialogElement) => void = () => {}
let notifyRemoval: () => void = () => {}

class FakeMutationObserver {
  constructor(callback: MutationCallback) {
    notify = (dialog) => {
      callback(
        [{ type: 'attributes', target: dialog } as unknown as MutationRecord],
        this as unknown as MutationObserver,
      )
    }
    notifyRemoval = () => {
      callback(
        [{ type: 'childList', target: document.body } as unknown as MutationRecord],
        this as unknown as MutationObserver,
      )
    }
  }

  observe() {}

  disconnect() {}
}

function setOpen(dialog: HTMLDialogElement, isOpen: boolean) {
  if (isOpen) {
    dialog.setAttribute('open', '')
  } else {
    dialog.removeAttribute('open')
  }

  notify(dialog)
}

describe('composables/top-modal-dialog', () => {
  beforeEach(() => {
    vi.stubGlobal('MutationObserver', FakeMutationObserver)
    vi.spyOn(HTMLElement.prototype, 'matches').mockImplementation(
      function (this: HTMLElement, selector: string) {
        return selector === ':modal' && this.tagName === 'DIALOG'
      },
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    document.querySelectorAll('dialog.test-dialog').forEach((dialog) => {
      dialog.remove()
    })
  })

  it('is empty while no modal dialog is open', async () => {
    await mountSuspended(Host)

    expect(topDialog.value).toBeNull()
  })

  it('follows the newest open modal dialog and falls back as they close', async () => {
    await mountSuspended(Host)

    const first = createDialog()
    const second = createDialog()

    setOpen(first, true)

    expect(topDialog.value).toBe(first)

    setOpen(second, true)

    expect(topDialog.value).toBe(second)

    setOpen(second, false)

    expect(topDialog.value).toBe(first)

    setOpen(first, false)

    expect(topDialog.value).toBeNull()
  })

  it('forgets an open dialog that is removed without close()', async () => {
    await mountSuspended(Host)

    const first = createDialog()
    const second = createDialog()

    setOpen(first, true)
    setOpen(second, true)
    second.remove()
    notifyRemoval()

    expect(topDialog.value).toBe(first)

    first.remove()
    notifyRemoval()

    expect(topDialog.value).toBeNull()
  })

  it('does no tracking work for removals while no dialog is open', async () => {
    await mountSuspended(Host)

    const unrelated = document.createElement('div')

    document.body.appendChild(unrelated)
    unrelated.remove()
    notifyRemoval()

    expect(topDialog.value).toBeNull()
  })

  it('drops a stale dialog on refresh even without a mutation record', async () => {
    await mountSuspended(Host)

    const dialog = createDialog()

    setOpen(dialog, true)
    dialog.remove()

    expect(topDialog.value).toBe(dialog)

    refresh()

    expect(topDialog.value).toBeNull()
  })

  it('ignores an open dialog that is not modal', async () => {
    vi.spyOn(HTMLElement.prototype, 'matches').mockReturnValue(false)
    await mountSuspended(Host)

    setOpen(createDialog(), true)

    expect(topDialog.value).toBeNull()
  })
})

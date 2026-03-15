interface KeyboardAwareDialogOptions {
  selectText?: boolean
}

function getKeyboardSafeBottom(): number {
  if (!import.meta.client) {
    return 0
  }

  const visualViewport = window.visualViewport

  if (!visualViewport) {
    return window.innerHeight - 12
  }

  return visualViewport.height + visualViewport.offsetTop - 12
}

export function ensureEditableVisible(
  dialog: HTMLDialogElement | null,
  element: HTMLElement | null,
): boolean {
  if (!import.meta.client || !dialog || !element) {
    return false
  }

  const keyboardSafeBottom = getKeyboardSafeBottom()
  const elementRect = element.getBoundingClientRect()

  if (elementRect.bottom <= keyboardSafeBottom) {
    return false
  }

  const modalBox = dialog.querySelector<HTMLElement>('.modal-box')
  const overflowHeight = Math.ceil(elementRect.bottom - keyboardSafeBottom)

  if (modalBox) {
    modalBox.scrollTop += overflowHeight
  }

  element.scrollIntoView({
    block: 'center',
    behavior: 'instant',
  })

  return true
}

export async function openDialogWithFocus(
  dialog: HTMLDialogElement | null,
  element: HTMLInputElement | HTMLTextAreaElement | null,
  options: KeyboardAwareDialogOptions = {},
) {
  if (!dialog || !element) {
    return
  }

  dialog.showModal()

  await nextTick()

  element.focus()

  if (options.selectText) {
    element.select()
  }

  await waitForDeviceKeyboardViewportSettle()

  ensureEditableVisible(dialog, element)
}

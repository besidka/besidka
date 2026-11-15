import { flushPromises } from '@vue/test-utils'
import { vi } from 'vitest'

export function findByTestId(id: string): HTMLElement | null {
  return document.body.querySelector(`[data-testid="${id}"]`)
}

export function getByTestId(id: string): HTMLElement {
  const element = findByTestId(id)

  if (!element) {
    throw new Error(`Missing ${id}`)
  }

  return element
}

export async function clickTestId(id: string) {
  getByTestId(id).click()
  await flushPromises()
}

export async function setTestIdValue(id: string, value: string) {
  const input = getByTestId(id) as HTMLInputElement

  input.value = value
  input.dispatchEvent(new Event('input'))
  await flushPromises()
}

export async function checkTestId(id: string, checked = true) {
  const input = getByTestId(id) as HTMLInputElement

  input.checked = checked
  input.dispatchEvent(new Event('change'))
  await flushPromises()
}

export function stubDialogElement() {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    .mockImplementation(function (this: HTMLDialogElement) {
      this.setAttribute('open', '')
    })
  vi.spyOn(HTMLDialogElement.prototype, 'close')
    .mockImplementation(function (this: HTMLDialogElement) {
      this.removeAttribute('open')
      this.dispatchEvent(new Event('close'))
    })
}

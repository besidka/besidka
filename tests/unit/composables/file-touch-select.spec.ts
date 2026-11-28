import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFileTouchSelect } from '../../../app/composables/file-touch-select'

function createRow(index: number, groupId?: string): HTMLElement {
  const row = document.createElement('div')

  row.setAttribute('data-file-index', String(index))

  if (groupId) {
    const group = document.createElement('div')

    group.className = 'js-project-group'
    group.setAttribute('data-project-group-id', groupId)
    group.appendChild(row)
  }

  return row
}

function touch(type: string, target: HTMLElement) {
  const event = new Event(type, { cancelable: true })

  Object.defineProperty(event, 'touches', {
    value: [{ clientX: 1, clientY: 1 }],
  })
  target.dispatchEvent(event)

  return event
}

describe('useFileTouchSelect', () => {
  const selectRange = vi.fn()
  const selectProjectGroupRange = vi.fn()
  let container: HTMLElement
  let pointedAt: HTMLElement | null

  beforeEach(() => {
    vi.useFakeTimers()
    selectRange.mockReset()
    selectProjectGroupRange.mockReset()
    container = document.createElement('div')
    pointedAt = null
    document.elementFromPoint = () => pointedAt
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('selects the range between the first and last touched row', () => {
    const subject = useFileTouchSelect({ selectRange })

    subject.attachTouchListeners(container)
    pointedAt = createRow(1)
    touch('touchstart', container)

    expect(subject.isTouchSelecting.value).toBe(true)

    pointedAt = createRow(2)

    const move = touch('touchmove', container)

    pointedAt = createRow(4)
    touch('touchmove', container)
    touch('touchend', container)

    expect(move.defaultPrevented).toBe(true)
    expect(selectRange).toHaveBeenCalledWith(1, 4)
    expect(subject.isTouchSelecting.value).toBe(false)
    expect(subject.touchedIndices.value.size).toBe(0)
  })

  it('ignores a click for a moment after a swipe', () => {
    const subject = useFileTouchSelect({ selectRange })

    subject.attachTouchListeners(container)
    pointedAt = createRow(0)
    touch('touchstart', container)
    pointedAt = createRow(1)
    touch('touchmove', container)
    touch('touchend', container)

    expect(subject.touchSwipeHandled.value).toBe(true)

    vi.advanceTimersByTime(100)

    expect(subject.touchSwipeHandled.value).toBe(false)
  })

  it('selects nothing for a tap on one row', () => {
    const subject = useFileTouchSelect({ selectRange })

    subject.attachTouchListeners(container)
    pointedAt = createRow(3)
    touch('touchstart', container)
    touch('touchend', container)

    expect(selectRange).not.toHaveBeenCalled()
    expect(subject.touchSwipeHandled.value).toBe(false)
  })

  it('starts nothing when the touch is not on a row', () => {
    const subject = useFileTouchSelect({ selectRange })

    subject.attachTouchListeners(container)
    pointedAt = document.createElement('div')
    touch('touchstart', container)

    expect(subject.isTouchSelecting.value).toBe(false)
  })

  it('keeps a swipe inside the project group it started in', () => {
    const subject = useFileTouchSelect({
      selectRange,
      selectProjectGroupRange,
    })

    subject.attachTouchListeners(container)
    pointedAt = createRow(0, 'alpha')
    touch('touchstart', container)
    pointedAt = createRow(1, 'beta')
    touch('touchmove', container)
    pointedAt = createRow(2, 'alpha')
    touch('touchmove', container)
    touch('touchend', container)

    expect(selectProjectGroupRange).toHaveBeenCalledWith('alpha', 0, 2)
    expect(selectRange).not.toHaveBeenCalled()
  })

  it('stops listening once detached', () => {
    const subject = useFileTouchSelect({ selectRange })

    subject.attachTouchListeners(container)
    subject.detachTouchListeners(container)
    pointedAt = createRow(1)
    touch('touchstart', container)

    expect(subject.isTouchSelecting.value).toBe(false)
  })

  it('accepts a missing container', () => {
    const subject = useFileTouchSelect({ selectRange })

    expect(() => {
      subject.attachTouchListeners(null)
      subject.detachTouchListeners(null)
    }).not.toThrow()
  })
})

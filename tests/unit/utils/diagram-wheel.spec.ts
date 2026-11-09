import { describe, expect, it } from 'vitest'
import { getDiagramWheelAction } from '../../../app/utils/diagram-wheel'
import type {
  DiagramWheelAction,
  DiagramWheelInput,
} from '../../../app/utils/diagram-wheel'

function wheel(overrides: Partial<DiagramWheelInput>): DiagramWheelInput {
  return {
    deltaX: 0,
    deltaY: 0,
    deltaMode: 0,
    ctrlKey: false,
    ...overrides,
  }
}

function zoomFactor(action: DiagramWheelAction): number {
  if (action.kind !== 'zoom') {
    throw new Error('Expected a zoom action')
  }

  return action.factor
}

describe('getDiagramWheelAction', () => {
  describe('trackpad pinch (ctrlKey with small deltas)', () => {
    it('zooms in for a negative delta by the size of the delta', () => {
      const action = getDiagramWheelAction(wheel({
        deltaY: -4,
        ctrlKey: true,
      }))

      expect(action.kind).toBe('zoom')
      expect(zoomFactor(action)).toBeCloseTo(Math.exp(0.04), 6)
    })

    it('zooms out for a positive delta', () => {
      const action = getDiagramWheelAction(wheel({
        deltaY: 6,
        ctrlKey: true,
      }))

      expect(zoomFactor(action)).toBeCloseTo(Math.exp(-0.06), 6)
    })

    it('compounds to a smooth change over a burst of events', () => {
      const burst = Array.from({ length: 10 }, () => {
        return zoomFactor(getDiagramWheelAction(wheel({
          deltaY: -4,
          ctrlKey: true,
        })))
      })
      const total = burst.reduce((product, factor) => product * factor, 1)

      expect(total).toBeCloseTo(Math.exp(0.4), 6)
      expect(total).toBeLessThan(1.5)
    })

    it('caps the zoom of a single oversized pinch delta', () => {
      const action = getDiagramWheelAction(wheel({
        deltaY: -80,
        ctrlKey: true,
        wheelDeltaY: 240,
      }))

      expect(zoomFactor(action)).toBeCloseTo(Math.exp(0.25), 6)
    })

    it('ignores the horizontal delta of a pinch', () => {
      const action = getDiagramWheelAction(wheel({
        deltaX: 12,
        deltaY: -3,
        ctrlKey: true,
      }))

      expect(action.kind).toBe('zoom')
    })
  })

  describe('two-finger swipe (plain wheel with pixel deltas)', () => {
    it('pans opposite to the wheel deltas', () => {
      expect(getDiagramWheelAction(wheel({ deltaX: 12, deltaY: 6 })))
        .toEqual({ kind: 'pan', x: -12, y: -6 })
    })

    it('pans vertically for a vertical swipe', () => {
      expect(getDiagramWheelAction(wheel({ deltaY: -30 })))
        .toEqual({ kind: 'pan', x: -0, y: 30 })
    })

    it('pans for a fast swipe whose delta is not a wheel notch', () => {
      expect(getDiagramWheelAction(wheel({
        deltaY: 140,
        wheelDeltaY: -420,
      }))).toEqual({ kind: 'pan', x: -0, y: -140 })
    })

    it('never zooms a swipe, whatever the sign of the delta', () => {
      const actions = [-40, -5, 5, 40].map((deltaY) => {
        return getDiagramWheelAction(wheel({ deltaX: 3, deltaY }))
      })

      expect(actions.every(action => action.kind === 'pan')).toBe(true)
    })
  })

  describe('mouse wheel', () => {
    it('zooms one fixed step in for a notch scrolled up', () => {
      const action = getDiagramWheelAction(wheel({
        deltaY: -100,
        wheelDeltaY: 120,
      }))

      expect(zoomFactor(action)).toBeCloseTo(Math.exp(0.1), 6)
    })

    it('zooms one fixed step out for a notch scrolled down', () => {
      const action = getDiagramWheelAction(wheel({
        deltaY: 100,
        wheelDeltaY: -120,
      }))

      expect(zoomFactor(action)).toBeCloseTo(Math.exp(-0.1), 6)
    })

    it('uses the same step for line-based wheels', () => {
      const action = getDiagramWheelAction(wheel({
        deltaY: -3,
        deltaMode: 1,
      }))

      expect(zoomFactor(action)).toBeCloseTo(Math.exp(0.1), 6)
    })

    it('treats a ctrl-held wheel notch as a step, not a huge pinch', () => {
      const action = getDiagramWheelAction(wheel({
        deltaY: -100,
        ctrlKey: true,
        wheelDeltaY: 120,
      }))

      expect(zoomFactor(action)).toBeCloseTo(Math.exp(0.1), 6)
    })

    it('recognises a notch without the legacy wheelDeltaY', () => {
      const action = getDiagramWheelAction(wheel({ deltaY: -100 }))

      expect(zoomFactor(action)).toBeCloseTo(Math.exp(0.1), 6)
    })
  })
})

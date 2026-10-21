import { describe, expect, it } from 'vitest'
import {
  createInputMediaTypePredicate,
  getInputMediaKind,
} from '../../../shared/utils/input-media-types'

describe('getInputMediaKind', () => {
  it('classifies text, image, pdf and other media types', () => {
    expect(getInputMediaKind('text/plain')).toBe('text')
    expect(getInputMediaKind('text/markdown')).toBe('text')
    expect(getInputMediaKind('image/png')).toBe('image')
    expect(getInputMediaKind('application/pdf')).toBe('pdf')
    expect(getInputMediaKind('application/zip')).toBe('other')
    expect(getInputMediaKind('')).toBe('other')
  })

  it('normalizes case and parameters', () => {
    expect(getInputMediaKind('Application/PDF; charset=binary')).toBe('pdf')
    expect(getInputMediaKind(' IMAGE/JPEG ')).toBe('image')
  })
})

describe('createInputMediaTypePredicate', () => {
  it('always allows text', () => {
    const canAttach = createInputMediaTypePredicate([])

    expect(canAttach('text/plain')).toBe(true)
  })

  it('never allows other media types', () => {
    const canAttach = createInputMediaTypePredicate(['image', 'pdf'])

    expect(canAttach('application/zip')).toBe(false)
  })

  it('gates images and PDFs on the input modalities', () => {
    const imageOnly = createInputMediaTypePredicate(['text', 'image'])
    const pdfOnly = createInputMediaTypePredicate(['text', 'pdf'])

    expect(imageOnly('image/png')).toBe(true)
    expect(imageOnly('application/pdf')).toBe(false)
    expect(pdfOnly('image/png')).toBe(false)
    expect(pdfOnly('application/pdf')).toBe(true)
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import { useImagePreviewGuard } from '../../../app/composables/chat-image-preview-guard'

describe('useImagePreviewGuard', () => {
  beforeEach(() => {
    useState<number>('image-preview-guard-count', () => 0).value = 0
  })

  it('is not suppressed before anything activates it', () => {
    const { isSuppressed } = useImagePreviewGuard()

    expect(isSuppressed.value).toBe(false)
  })

  it('becomes suppressed after one activation and clears after release', () => {
    const { isSuppressed, suppressImagePreview, releaseImagePreview }
      = useImagePreviewGuard()

    suppressImagePreview()

    expect(isSuppressed.value).toBe(true)

    releaseImagePreview()

    expect(isSuppressed.value).toBe(false)
  })

  it('stays suppressed through an overlapping activation until every '
    + 'release resolves', () => {
    const { isSuppressed, suppressImagePreview, releaseImagePreview }
      = useImagePreviewGuard()

    suppressImagePreview()
    suppressImagePreview()

    expect(isSuppressed.value).toBe(true)

    releaseImagePreview()

    expect(isSuppressed.value).toBe(true)

    releaseImagePreview()

    expect(isSuppressed.value).toBe(false)
  })

  it('clamps at zero instead of going negative on an extra release', () => {
    const { isSuppressed, releaseImagePreview } = useImagePreviewGuard()

    releaseImagePreview()
    releaseImagePreview()

    expect(isSuppressed.value).toBe(false)

    const { suppressImagePreview } = useImagePreviewGuard()

    suppressImagePreview()

    expect(isSuppressed.value).toBe(true)
  })

  it('shares the same count across independent composable calls', () => {
    const first = useImagePreviewGuard()
    const second = useImagePreviewGuard()

    first.suppressImagePreview()

    expect(second.isSuppressed.value).toBe(true)

    second.releaseImagePreview()

    expect(first.isSuppressed.value).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  buildClientEventAttributes,
  clientPathSchema,
  resolveSurface,
  validateClientEventTarget,
  validateClientEventTrigger,
  validateVideoWatchFields,
} from '../../../../server/utils/landing/client-events'

describe('resolveSurface', () => {
  it('maps paths to surfaces', () => {
    expect(resolveSurface('/')).toBe('home')
    expect(resolveSurface('/profile/keys')).toBe('keys')
    expect(resolveSurface('/guides/gemini-api-key')).toBe('guide')
    expect(resolveSurface('/byok')).toBe('byok')
    expect(resolveSurface('/privacy-policy')).toBe('legal')
  })

  it('returns undefined for missing and unknown paths', () => {
    expect(resolveSurface(undefined)).toBeUndefined()
    expect(resolveSurface('/admin')).toBeUndefined()
    expect(resolveSurface('/guides/')).toBeUndefined()
  })
})

describe('clientPathSchema', () => {
  it('strips one trailing slash before validating', () => {
    expect(clientPathSchema.parse('/guides/x/')).toBe('/guides/x')
    expect(clientPathSchema.parse('/')).toBe('/')
  })

  it('rejects paths outside the allow list', () => {
    expect(clientPathSchema.safeParse('/guides/Bad').success).toBe(false)
    expect(clientPathSchema.safeParse('/guides/a/b').success).toBe(false)
  })
})

describe('validateClientEventTarget', () => {
  it('requires a provider id for key guide events', () => {
    expect(validateClientEventTarget('key_guide_open', 'google'))
      .toBeUndefined()
    expect(validateClientEventTarget('key_guide_open', 'demo'))
      .toBeDefined()
    expect(validateClientEventTarget('key_guide_video_play', undefined))
      .toBeDefined()
  })

  it('accepts demo or a provider id for video_watch', () => {
    expect(validateClientEventTarget('video_watch', 'demo')).toBeUndefined()
    expect(validateClientEventTarget('video_watch', 'google')).toBeUndefined()
    expect(validateClientEventTarget('video_watch', 'toString')).toBeDefined()
  })

  it('does not constrain other events', () => {
    expect(validateClientEventTarget('cta_click', '/signup')).toBeUndefined()
  })
})

describe('validateClientEventTrigger', () => {
  it('accepts auto and user for key_guide_open only', () => {
    expect(validateClientEventTrigger('key_guide_open', 'auto'))
      .toBeUndefined()
    expect(validateClientEventTrigger('key_guide_open', 'user'))
      .toBeUndefined()
    expect(validateClientEventTrigger('key_guide_open', 'autoplay'))
      .toBeDefined()
  })

  it('accepts autoplay and user for video events only', () => {
    for (const name of [
      'video_play',
      'key_guide_video_play',
      'video_watch',
    ] as const) {
      expect(validateClientEventTrigger(name, 'autoplay')).toBeUndefined()
      expect(validateClientEventTrigger(name, 'user')).toBeUndefined()
      expect(validateClientEventTrigger(name, 'auto')).toBeDefined()
    }
  })

  it('does not require or constrain a trigger elsewhere', () => {
    expect(validateClientEventTrigger('key_guide_open', undefined))
      .toBeUndefined()
    expect(validateClientEventTrigger('cta_click', 'auto')).toBeUndefined()
  })
})

describe('validateVideoWatchFields', () => {
  it('lists missing fields for video_watch only', () => {
    expect(validateVideoWatchFields('video_watch', { watchedSeconds: 3 }))
      .toContain('trigger')
    expect(validateVideoWatchFields('video_play', {})).toBeUndefined()
  })

  const completeFields = {
    trigger: 'user' as const,
    watchedSeconds: 10,
    durationSeconds: 10,
    completionPercent: 100,
    endReason: 'ended' as const,
  }

  it('accepts watched seconds up to one second above the duration', () => {
    expect(validateVideoWatchFields('video_watch', completeFields))
      .toBeUndefined()
    expect(validateVideoWatchFields('video_watch', {
      ...completeFields,
      watchedSeconds: 11,
    })).toBeUndefined()
  })

  it('rejects watched seconds beyond the duration tolerance', () => {
    expect(validateVideoWatchFields('video_watch', {
      ...completeFields,
      watchedSeconds: 11.1,
    })).toContain('more watched seconds')
  })
})

describe('buildClientEventAttributes', () => {
  it('omits undefined keys', () => {
    expect(buildClientEventAttributes('cta_click', {})).toEqual({})
    expect(buildClientEventAttributes('cta_click', { path: '/' })).toEqual({
      surface: 'home',
      path: '/',
    })
  })

  it('includes trigger only for video events', () => {
    expect(buildClientEventAttributes('cta_click', { trigger: 'user' }))
      .toEqual({})
    expect(buildClientEventAttributes('video_play', { trigger: 'user' }))
      .toEqual({ trigger: 'user' })
  })

  it('includes the auto and user trigger for key_guide_open', () => {
    expect(buildClientEventAttributes('key_guide_open', { trigger: 'auto' }))
      .toEqual({ trigger: 'auto' })
    expect(buildClientEventAttributes('key_guide_open', { trigger: 'user' }))
      .toEqual({ trigger: 'user' })
  })

  it('includes watch fields only for video_watch', () => {
    const data = {
      target: 'demo',
      path: '/',
      trigger: 'user' as const,
      watchedSeconds: 9.5,
      durationSeconds: 60,
      completionPercent: 20,
      endReason: 'hidden' as const,
    }

    expect(buildClientEventAttributes('video_watch', data)).toEqual({
      target: 'demo',
      surface: 'home',
      path: '/',
      trigger: 'user',
      watchedSeconds: 9.5,
      durationSeconds: 60,
      completionPercent: 20,
      endReason: 'hidden',
    })
    expect(buildClientEventAttributes('video_play', data)).toEqual({
      target: 'demo',
      surface: 'home',
      path: '/',
      trigger: 'user',
    })
  })

  it('rounds watched and duration seconds to a tenth', () => {
    expect(buildClientEventAttributes('video_watch', {
      watchedSeconds: 9.5432,
      durationSeconds: 38.5049,
    })).toEqual({ watchedSeconds: 9.5, durationSeconds: 38.5 })
  })

  it('logs the target of other events only when it is well formed', () => {
    expect(buildClientEventAttributes('cta_click', { target: '/signup#hero' }))
      .toEqual({ target: '/signup#hero' })
    expect(buildClientEventAttributes('cta_click', { target: 'Hero CTA' }))
      .toEqual({})
    expect(buildClientEventAttributes('cta_click', { target: 'a'.repeat(101) }))
      .toEqual({})
    expect(buildClientEventAttributes('github_click', {
      target: '<script>alert(1)</script>',
    })).toEqual({})
  })

  it('logs the validated target of key guide and watch events', () => {
    expect(buildClientEventAttributes('key_guide_open', { target: 'google' }))
      .toEqual({ target: 'google' })
    expect(buildClientEventAttributes('video_watch', { target: 'demo' }))
      .toEqual({ target: 'demo' })
  })

  it('keeps zero-valued watch fields', () => {
    expect(buildClientEventAttributes('video_watch', {
      watchedSeconds: 0,
      completionPercent: 0,
    })).toEqual({ watchedSeconds: 0, completionPercent: 0 })
  })
})

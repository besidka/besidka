import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_CALENDAR_ICON,
  GOOGLE_DRIVE_ICON,
  GOOGLE_GMAIL_ICON,
} from '#shared/utils/google-brand-icons'

const BRAND_ICONS = [
  GOOGLE_DRIVE_ICON,
  GOOGLE_GMAIL_ICON,
  GOOGLE_CALENDAR_ICON,
]

describe('google-brand-icons', () => {
  it('names the multicolor marks of the logos collection', () => {
    expect(GOOGLE_DRIVE_ICON).toBe('logos:google-drive')
    expect(GOOGLE_GMAIL_ICON).toBe('logos:google-gmail')
    expect(GOOGLE_CALENDAR_ICON).toBe('logos:google-calendar')
  })

  it('lists every mark in the client icon bundle', () => {
    const config = readFileSync(resolve('nuxt.config.ts'), 'utf8')

    for (const icon of BRAND_ICONS) {
      expect(config).toContain(`'${icon}'`)
    }
  })

  it('keeps the logos collection out of the pinned icon collections', () => {
    const config = readFileSync(resolve('nuxt.config.ts'), 'utf8')
    const pinned = config.match(/const iconCollections = \[([^\]]*)\]/)

    expect(pinned?.[1]).toBeDefined()
    expect(pinned?.[1]).not.toContain(`'logos'`)
  })
})

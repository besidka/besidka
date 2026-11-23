import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_CALENDAR_ICON,
  GOOGLE_DOCS_ICON,
  GOOGLE_DRIVE_ICON,
  GOOGLE_GMAIL_ICON,
  GOOGLE_G_ICON,
  GOOGLE_SHEETS_ICON,
  GOOGLE_SLIDES_ICON,
} from '#shared/utils/google-brand-icons'

const BRAND_ICONS = [
  GOOGLE_DRIVE_ICON,
  GOOGLE_GMAIL_ICON,
  GOOGLE_CALENDAR_ICON,
  GOOGLE_G_ICON,
]

const WORKSPACE_ICONS = [
  GOOGLE_DOCS_ICON,
  GOOGLE_SHEETS_ICON,
  GOOGLE_SLIDES_ICON,
]

describe('google-brand-icons', () => {
  it('names the multicolor marks of the logos collection', () => {
    expect(GOOGLE_DRIVE_ICON).toBe('logos:google-drive')
    expect(GOOGLE_GMAIL_ICON).toBe('logos:google-gmail')
    expect(GOOGLE_CALENDAR_ICON).toBe('logos:google-calendar')
    expect(GOOGLE_G_ICON).toBe('logos:google-icon')
  })

  it('names marks that exist in the installed logos collection', () => {
    const collection = JSON.parse(readFileSync(
      resolve('node_modules/@iconify-json/logos/icons.json'),
      'utf8',
    )) as { icons: Record<string, unknown> }

    for (const icon of BRAND_ICONS) {
      expect(collection.icons[icon.replace('logos:', '')], icon).toBeDefined()
    }
  })

  it('names the Docs, Sheets and Slides marks of thesvg-color', () => {
    expect(GOOGLE_DOCS_ICON).toBe('thesvg-color:google-docs')
    expect(GOOGLE_SHEETS_ICON).toBe('thesvg-color:google-sheets')
    expect(GOOGLE_SLIDES_ICON).toBe('thesvg-color:google-slides')
  })

  it('names Workspace marks that exist in the installed collection', () => {
    const collection = JSON.parse(readFileSync(
      resolve('node_modules/@iconify-json/thesvg-color/icons.json'),
      'utf8',
    )) as { icons: Record<string, unknown> }

    for (const icon of WORKSPACE_ICONS) {
      expect(
        collection.icons[icon.replace('thesvg-color:', '')],
        icon,
      ).toBeDefined()
    }
  })

  it('keeps the Workspace marks colored, with no currentColor', () => {
    const collection = JSON.parse(readFileSync(
      resolve('node_modules/@iconify-json/thesvg-color/icons.json'),
      'utf8',
    )) as { icons: Record<string, { body: string }> }

    for (const icon of WORKSPACE_ICONS) {
      const { body } = collection.icons[icon.replace('thesvg-color:', '')]!

      expect(body, icon).not.toContain('currentColor')
      expect(body, icon).toMatch(/fill="#[0-9a-f]{3,6}"/i)
    }
  })

  it('lists every mark in the client icon bundle', () => {
    const config = readFileSync(resolve('nuxt.config.ts'), 'utf8')

    for (const icon of [...BRAND_ICONS, ...WORKSPACE_ICONS]) {
      expect(config).toContain(`'${icon}'`)
    }
  })

  it('keeps the logos collection out of the pinned icon collections', () => {
    const config = readFileSync(resolve('nuxt.config.ts'), 'utf8')
    const pinned = config.match(/const iconCollections = \[([^\]]*)\]/)

    expect(pinned?.[1]).toBeDefined()
    expect(pinned?.[1]).not.toContain(`'logos'`)
    expect(pinned?.[1]).not.toContain(`'thesvg-color'`)
  })
})

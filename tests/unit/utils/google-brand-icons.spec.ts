import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_BRAND_COLLECTION,
  GOOGLE_CALENDAR_ICON,
  GOOGLE_DOCS_ICON,
  GOOGLE_DRIVE_ICON,
  GOOGLE_GMAIL_ICON,
  GOOGLE_G_ICON,
  GOOGLE_SHEETS_ICON,
  GOOGLE_SLIDES_ICON,
  isMulticolorBrandIcon,
} from '#shared/utils/google-brand-icons'

const LOGOS_ICONS = [
  GOOGLE_GMAIL_ICON,
  GOOGLE_CALENDAR_ICON,
  GOOGLE_G_ICON,
]

const OFFICIAL_ICONS = [
  GOOGLE_DRIVE_ICON,
  GOOGLE_DOCS_ICON,
  GOOGLE_SHEETS_ICON,
  GOOGLE_SLIDES_ICON,
]

const ADDED_VIEW_BOX = ' viewBox="0 0 192 192"'

const OFFICIAL_SOURCES: Record<string, {
  url: string
  sha256: string
  hasAddedViewBox: boolean
}> = {
  docs: {
    url: 'https://www.gstatic.com/images/branding/productlogos/docs_2026/v1/192px.svg',
    sha256: '2bb529bae5125af70bbb14e1f005756d90af9e7607298a16436683ef728442d0',
    hasAddedViewBox: true,
  },
  sheets: {
    url: 'https://www.gstatic.com/images/branding/productlogos/sheets_2026/v1/192px.svg',
    sha256: '359fd2a4237e2d3526fe7a95e44d0505e6321b2356698512bbb8873b786598f5',
    hasAddedViewBox: false,
  },
  slides: {
    url: 'https://www.gstatic.com/images/branding/productlogos/slides_2026/v1/192px.svg',
    sha256: '3ad971447ab6fc537eb8bb5eae651a0473b137ee70acbbb073a231b84235c0e6',
    hasAddedViewBox: false,
  },
  drive: {
    url: 'https://www.gstatic.com/images/branding/productlogos/drive_2026/v1/192px.svg',
    sha256: '60a6496d705d8bf010ce126469be89889db331622b14d8ae1645a38c2aaa23f5',
    hasAddedViewBox: true,
  },
}

const ASSET_DIRECTORY = resolve('app/assets/google-brand')

function readAsset(name: string): string {
  return readFileSync(join(ASSET_DIRECTORY, `${name}.svg`), 'utf8')
}

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function sourceFilesIn(directory: string): string[] {
  const found: string[] = []

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)

    if (statSync(path).isDirectory()) {
      found.push(...sourceFilesIn(path))
      continue
    }

    if (/\.(vue|ts)$/.test(entry)) {
      found.push(path)
    }
  }

  return found
}

describe('google-brand-icons', () => {
  it('names the multicolor marks of the logos collection', () => {
    expect(GOOGLE_GMAIL_ICON).toBe('logos:google-gmail')
    expect(GOOGLE_CALENDAR_ICON).toBe('logos:google-calendar')
    expect(GOOGLE_G_ICON).toBe('logos:google-icon')
  })

  it('names marks that exist in the installed logos collection', () => {
    const collection = JSON.parse(readFileSync(
      resolve('node_modules/@iconify-json/logos/icons.json'),
      'utf8',
    )) as { icons: Record<string, unknown> }

    for (const icon of LOGOS_ICONS) {
      expect(collection.icons[icon.replace('logos:', '')], icon).toBeDefined()
    }
  })

  it('names the Drive, Docs, Sheets and Slides marks of google-brand', () => {
    expect(GOOGLE_BRAND_COLLECTION).toBe('google-brand')
    expect(GOOGLE_DRIVE_ICON).toBe('google-brand:drive')
    expect(GOOGLE_DOCS_ICON).toBe('google-brand:docs')
    expect(GOOGLE_SHEETS_ICON).toBe('google-brand:sheets')
    expect(GOOGLE_SLIDES_ICON).toBe('google-brand:slides')
  })

  it('has one official file in the local collection for every mark', () => {
    const files = readdirSync(ASSET_DIRECTORY).sort()

    expect(files).toEqual([
      'docs.svg',
      'drive.svg',
      'sheets.svg',
      'slides.svg',
    ])

    for (const icon of OFFICIAL_ICONS) {
      const name = icon.replace(`${GOOGLE_BRAND_COLLECTION}:`, '')

      expect(files, icon).toContain(`${name}.svg`)
    }
  })

  it('keeps every file identical to the recorded Google download', () => {
    for (const [name, source] of Object.entries(OFFICIAL_SOURCES)) {
      const content = readAsset(name)
      const original = source.hasAddedViewBox
        ? content.replace(ADDED_VIEW_BOX, '')
        : content

      expect(sha256(original), `${name} from ${source.url}`)
        .toBe(source.sha256)
    }
  })

  it('has a 192 viewBox, so the icon loader parses every file', () => {
    for (const name of Object.keys(OFFICIAL_SOURCES)) {
      expect(readAsset(name), name).toContain('viewBox="0 0 192 192"')
    }
  })

  it('is plain artwork, with no script, handler or external reference',
    () => {
      for (const name of Object.keys(OFFICIAL_SOURCES)) {
        const content = readAsset(name)

        expect(content, name).not.toMatch(
          /<script|<image|<style|<foreignObject|<use[ >]|@import|\son[a-z]+=|href=/i,
        )
        expect(content.replace('http://www.w3.org/2000/svg', ''), name)
          .not.toMatch(/https?:\/\//i)
      }
    })

  it('keeps the marks colored, with no currentColor', () => {
    for (const name of Object.keys(OFFICIAL_SOURCES)) {
      const content = readAsset(name)

      expect(content, name).not.toContain('currentColor')
      expect(content, name).toMatch(/fill="#[0-9a-f]{3,6}"/i)
    }
  })

  it('registers the folder as a custom collection bundled client side', () => {
    const config = readFileSync(resolve('nuxt.config.ts'), 'utf8')

    expect(config).toContain(`prefix: '${GOOGLE_BRAND_COLLECTION}'`)
    expect(config).toContain(`dir: './app/assets/${GOOGLE_BRAND_COLLECTION}'`)
    expect(config).toContain('includeCustomCollections: true')
  })

  it('lists the logos marks in the client icon bundle', () => {
    const config = readFileSync(resolve('nuxt.config.ts'), 'utf8')

    for (const icon of LOGOS_ICONS) {
      expect(config).toContain(`'${icon}'`)
    }
  })

  it('leaves the retired third-party redraws out of the config', () => {
    const config = readFileSync(resolve('nuxt.config.ts'), 'utf8')

    expect(config).not.toContain('thesvg-color')
    expect(config).not.toContain('logos:google-drive')
  })

  it('keeps the logos collection out of the pinned icon collections', () => {
    const config = readFileSync(resolve('nuxt.config.ts'), 'utf8')
    const pinned = config.match(/const iconCollections = \[([^\]]*)\]/)

    expect(pinned?.[1]).toBeDefined()
    expect(pinned?.[1]).not.toContain(`'logos'`)
    expect(pinned?.[1]).not.toContain(`'${GOOGLE_BRAND_COLLECTION}'`)
  })

  it('is not used by a component as a literal name', () => {
    const offenders: string[] = []

    for (const file of sourceFilesIn(resolve('app'))) {
      const source = readFileSync(file, 'utf8')

      if (/google-brand:|logos:google-/.test(source)) {
        offenders.push(file)
      }
    }

    expect(offenders).toEqual([])
  })

  it('treats logos and google-brand names as multicolor brand marks', () => {
    for (const icon of [...LOGOS_ICONS, ...OFFICIAL_ICONS]) {
      expect(isMulticolorBrandIcon(icon), icon).toBe(true)
    }

    expect(isMulticolorBrandIcon('lucide:plug')).toBe(false)
    expect(isMulticolorBrandIcon(undefined)).toBe(false)
  })
})

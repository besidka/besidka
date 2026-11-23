import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { GOOGLE_SLIDES_ICON } from '../../../shared/utils/google-brand-icons'
import { GOOGLE_FILE_KIND_ICONS } from '../../../shared/utils/google-created-file'

vi.stubGlobal('defineNuxtConfig', <Configuration>(configuration: Configuration) => {
  return configuration
})
vi.stubEnv('NUXT_PUBLIC_BASE_URL', '')

const { default: configuration } = await import('../../../nuxt.config')

const GOOGLE_COMPONENTS_DIRECTORY = join(
  process.cwd(),
  'app/components/Profile/Google',
)
const ICON_NAME_PATTERN = /(?:icon-name|name)="([a-z0-9-]+:[a-z0-9-]+)"/g

function iconNamesIn(directory: string): Map<string, string[]> {
  const found = new Map<string, string[]>()

  for (const file of readdirSync(directory)) {
    if (!file.endsWith('.vue')) {
      continue
    }

    const source = readFileSync(join(directory, file), 'utf8')

    for (const match of source.matchAll(ICON_NAME_PATTERN)) {
      const name = match[1] as string

      found.set(name, [...(found.get(name) ?? []), file])
    }
  }

  return found
}

describe('icons of client-only Google components', () => {
  const iconConfiguration = (configuration as {
    icon: {
      clientBundle: { icons: string[], includeCustomCollections?: boolean }
      customCollections?: { prefix: string }[]
    }
  }).icon
  const clientIcons: string[] = iconConfiguration.clientBundle.icons
  const bundledCollectionPrefixes: string[] = iconConfiguration
    .clientBundle.includeCustomCollections
    ? (iconConfiguration.customCollections ?? []).map((collection) => {
      return `${collection.prefix}:`
    })
    : []

  function isInClientBundle(name: string): boolean {
    return clientIcons.includes(name)
      || bundledCollectionPrefixes.some((prefix) => {
        return name.startsWith(prefix)
      })
  }

  it('are all in the client bundle, so none waits for the icon route',
    () => {
      const used = iconNamesIn(GOOGLE_COMPONENTS_DIRECTORY)

      expect(used.size).toBeGreaterThan(0)

      const missing = [...used.entries()]
        .filter(([name]) => !isInClientBundle(name))
        .map(([name, files]) => `${name} (${files.join(', ')})`)

      expect(missing).toEqual([])
    })

  it('include every logo of a created Google file card, none by a literal',
    () => {
      for (const icon of Object.values(GOOGLE_FILE_KIND_ICONS)) {
        expect(isInClientBundle(icon), icon).toBe(true)
      }

      expect(isInClientBundle(GOOGLE_SLIDES_ICON)).toBe(true)
    })

  it('include the Disconnect icon of the Drive card and the own client',
    () => {
      const used = iconNamesIn(GOOGLE_COMPONENTS_DIRECTORY)

      expect(used.get('lucide:unplug')).toEqual(
        expect.arrayContaining(['Connection.vue', 'OwnClient.vue']),
      )
      expect(clientIcons).toContain('lucide:unplug')
    })
})

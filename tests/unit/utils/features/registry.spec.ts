import { describe, expect, it } from 'vitest'
import {
  EXPERIMENTS_OPT_IN_KEY,
  FEATURE_KEYS,
  FEATURE_REGISTRY,
  getFeatureDefinition,
  isFeatureKey,
  RESERVED_FEATURE_OPT_IN_KEYS,
} from '#shared/utils/features/registry'
import { FEATURE_ROLES as SCHEMA_FEATURE_ROLES } from '~~/server/db/schemas/features'

const definitions = Object.values(FEATURE_REGISTRY)

describe('feature registry', () => {
  it('keys every entry by its own key', () => {
    for (const key of FEATURE_KEYS) {
      expect(FEATURE_REGISTRY[key].key).toBe(key)
    }

    expect(new Set(FEATURE_KEYS).size).toBe(FEATURE_KEYS.length)
  })

  it('uses dotted lower-case keys', () => {
    for (const key of FEATURE_KEYS) {
      expect(key).toMatch(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*$/)
    }
  })

  it('points every child at an existing parent that prefixes it', () => {
    for (const definition of definitions) {
      if (!definition.parent) {
        continue
      }

      expect(isFeatureKey(definition.parent), definition.key).toBe(true)
      expect(definition.key.startsWith(`${definition.parent.split('.')[0]}.`))
        .toBe(true)
    }
  })

  it('requires an opt-in for every feature that spends user keys', () => {
    for (const definition of definitions) {
      if (definition.spend !== 'none') {
        expect(definition.optIn, definition.key).toBe('required')
      }
    }
  })

  it('allows variants only on features that spend nothing (C4)', () => {
    for (const definition of definitions) {
      if (definition.variants?.length) {
        expect(definition.spend, definition.key).toBe('none')
      }
    }
  })

  it('never defines the reserved experiments key as a flag (C3)', () => {
    expect(EXPERIMENTS_OPT_IN_KEY).toBe('experiments')

    for (const reserved of RESERVED_FEATURE_OPT_IN_KEYS) {
      expect(isFeatureKey(reserved)).toBe(false)
      expect(getFeatureDefinition(reserved)).toBeUndefined()
    }
  })

  it('seeds every flag as internal, off, admin-only', () => {
    for (const definition of definitions) {
      expect(definition.stage, definition.key).toBe('internal')
      expect(definition.default, definition.key).toBe(false)
      expect(definition.allowRoles, definition.key).toEqual(['admin'])
    }
  })

  it('exposes the side panel demo to the client', () => {
    expect(FEATURE_REGISTRY['ui.side-panel-demo'].exposeToClient).toBe(true)
  })

  it('keeps the shared roles in step with the schema enum', () => {
    expect(definitions.flatMap((definition) => {
      return definition.allowRoles
    }).every((role) => {
      return SCHEMA_FEATURE_ROLES.includes(role)
    })).toBe(true)
  })

  it('shows every feature that needs an opt-in in Labs', () => {
    const hidden = definitions.filter((definition) => {
      return definition.optIn === 'required' && !definition.exposeToClient
    })

    expect(hidden).toEqual([])
  })

  it('turns documents off wherever the renderer binding is missing', () => {
    expect(FEATURE_REGISTRY.documents.requires.bindings)
      .toEqual(['DOC_RENDERER'])
    expect(FEATURE_REGISTRY['documents.mcp'].requires.bindings)
      .toEqual(['DOC_RENDERER'])
  })

  it('gates Office attachments on the renderer binding', () => {
    const definition = FEATURE_REGISTRY['files.office']

    expect(definition.available).toBe(true)
    expect(definition.stage).toBe('internal')
    expect(definition.default).toBe(false)
    expect(definition.spend).toBe('none')
    expect(definition.requires.bindings).toEqual(['DOC_RENDERER'])
  })

  it('makes documents over MCP available so create_document can run', () => {
    expect(FEATURE_REGISTRY['documents.mcp'].available).toBe(true)
  })

  it('requires an opt-in on every Google flag and keeps it internal', () => {
    for (const key of [
      'google.drive',
      'google.calendar',
      'google.byo',
      'google.gmail',
    ] as const) {
      expect(FEATURE_REGISTRY[key]).toEqual(expect.objectContaining({
        stage: 'internal',
        default: false,
        allowRoles: ['admin'],
        spend: 'none',
        optIn: 'required',
        exposeToClient: true,
      }))
    }
  })

  it('ships every Google flag', () => {
    expect(FEATURE_REGISTRY['google.drive'].available).toBe(true)
    expect(FEATURE_REGISTRY['google.byo'].available).toBe(true)
    expect(FEATURE_REGISTRY['google.gmail'].available).toBe(true)
    expect(FEATURE_REGISTRY['google.calendar'].available).toBe(true)
  })

  it('lists the own-client, Gmail and Calendar flags in Labs for admins only',
    () => {
      expect(FEATURE_REGISTRY['google.byo'].adminOnly).toBe(true)
      expect(FEATURE_REGISTRY['google.gmail'].adminOnly).toBe(true)
      expect(FEATURE_REGISTRY['google.calendar'].adminOnly).toBe(true)
      expect(FEATURE_REGISTRY['google.drive'].adminOnly).toBeUndefined()
    })

  it('nests Gmail and Calendar under the bring-your-own Google client', () => {
    expect(FEATURE_REGISTRY['google.drive'].parent).toBeUndefined()
    expect(FEATURE_REGISTRY['google.calendar'].parent).toBe('google.byo')
    expect(FEATURE_REGISTRY['google.byo'].parent).toBe('google.drive')
    expect(FEATURE_REGISTRY['google.gmail'].parent).toBe('google.byo')
  })

  it('treats prototype keys as unknown', () => {
    expect(isFeatureKey('constructor')).toBe(false)
    expect(getFeatureDefinition('toString')).toBeUndefined()
  })
})

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

  it('makes documents over MCP available so create_document can run', () => {
    expect(FEATURE_REGISTRY['documents.mcp'].available).toBe(true)
  })

  it('treats prototype keys as unknown', () => {
    expect(isFeatureKey('constructor')).toBe(false)
    expect(getFeatureDefinition('toString')).toBeUndefined()
  })
})

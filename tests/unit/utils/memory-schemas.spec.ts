import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  memoryByteLength,
  memoryEntryInputSchema,
  memoryEntryPatchSchema,
  memorySettingsPatchShape,
  refineMemorySettingsPatch,
} from '../../../shared/utils/memory-schemas'

const validEntry = {
  category: 'topics' as const,
  title: 'Cloudflare Workers',
  description: 'Works on Cloudflare Workers with D1',
  body: 'Prefers Workers over containers.',
}

const settingsSchema = z
  .object(memorySettingsPatchShape)
  .superRefine(refineMemorySettingsPatch)

describe('memoryByteLength', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(memoryByteLength('abc')).toBe(3)
    expect(memoryByteLength('привіт')).toBe(12)
  })
})

describe('memoryEntryInputSchema', () => {
  it('accepts a valid entry', () => {
    expect(memoryEntryInputSchema.safeParse(validEntry).success).toBe(true)
  })

  it('accepts a slug, project id and explicit sensitivity', () => {
    const result = memoryEntryInputSchema.safeParse({
      ...validEntry,
      projectId: 'project-1',
      slug: 'cloudflare-workers',
      sensitivity: 'special',
      sensitiveCategory: 'health',
      origin: 'user',
    })

    expect(result.success).toBe(true)
  })

  it('rejects a multi-line description', () => {
    const result = memoryEntryInputSchema.safeParse({
      ...validEntry,
      description: 'first line\nsecond line',
    })

    expect(result.success).toBe(false)
  })

  it('rejects a multi-line title', () => {
    const result = memoryEntryInputSchema.safeParse({
      ...validEntry,
      title: 'first line\nsecond line',
    })

    expect(result.success).toBe(false)
  })

  it('accepts a single-line title', () => {
    const result = memoryEntryInputSchema.safeParse({
      ...validEntry,
      title: 'Single line title',
    })

    expect(result.success).toBe(true)
  })

  it('accepts a 100-character description and rejects 101', () => {
    expect(memoryEntryInputSchema.safeParse({
      ...validEntry,
      description: 'a'.repeat(100),
    }).success).toBe(true)
    expect(memoryEntryInputSchema.safeParse({
      ...validEntry,
      description: 'a'.repeat(101),
    }).success).toBe(false)
  })

  it('counts the body in bytes so Cyrillic text hits the cap early', () => {
    const fitsByCharacters = 'я'.repeat(1500)

    expect(fitsByCharacters.length).toBeLessThan(2048)
    expect(memoryByteLength(fitsByCharacters)).toBeGreaterThan(2048)
    expect(memoryEntryInputSchema.safeParse({
      ...validEntry,
      body: fitsByCharacters,
    }).success).toBe(false)
    expect(memoryEntryInputSchema.safeParse({
      ...validEntry,
      body: 'я'.repeat(1024),
    }).success).toBe(true)
    expect(memoryEntryInputSchema.safeParse({
      ...validEntry,
      body: 'a'.repeat(2048),
    }).success).toBe(true)
    expect(memoryEntryInputSchema.safeParse({
      ...validEntry,
      body: 'a'.repeat(2049),
    }).success).toBe(false)
  })

  it('caps profile and preferences bodies at 1024 bytes', () => {
    const oversizedForAlwaysInjected = 'a'.repeat(1025)

    for (const category of ['profile', 'preferences'] as const) {
      expect(memoryEntryInputSchema.safeParse({
        ...validEntry,
        category,
        body: oversizedForAlwaysInjected,
      }).success).toBe(false)
      expect(memoryEntryInputSchema.safeParse({
        ...validEntry,
        category,
        body: 'a'.repeat(1024),
      }).success).toBe(true)
    }

    expect(memoryEntryInputSchema.safeParse({
      ...validEntry,
      category: 'topics',
      body: oversizedForAlwaysInjected,
    }).success).toBe(true)
  })

  it('validates the slug pattern', () => {
    for (const slug of ['Upper', 'with space', '-edge', 'double--dash']) {
      expect(memoryEntryInputSchema.safeParse({
        ...validEntry,
        slug,
      }).success).toBe(false)
    }

    expect(memoryEntryInputSchema.safeParse({
      ...validEntry,
      slug: 'a'.repeat(65),
    }).success).toBe(false)
  })

  it('requires special sensitivity for a sensitive category', () => {
    expect(memoryEntryInputSchema.safeParse({
      ...validEntry,
      sensitiveCategory: 'health',
    }).success).toBe(false)
    expect(memoryEntryInputSchema.safeParse({
      ...validEntry,
      sensitivity: 'none',
      sensitiveCategory: 'health',
    }).success).toBe(false)
    expect(memoryEntryInputSchema.safeParse({
      ...validEntry,
      sensitiveCategory: null,
    }).success).toBe(true)
  })
})

describe('memoryEntryPatchSchema', () => {
  it('rejects an empty patch', () => {
    expect(memoryEntryPatchSchema.safeParse({}).success).toBe(false)
  })

  it('accepts a partial patch', () => {
    expect(memoryEntryPatchSchema.safeParse({
      title: 'New title',
    }).success).toBe(true)
    expect(memoryEntryPatchSchema.safeParse({
      body: 'New body',
    }).success).toBe(true)
  })

  it('applies the always-injected cap when category and body are both sent',
    () => {
      expect(memoryEntryPatchSchema.safeParse({
        category: 'profile',
        body: 'a'.repeat(1025),
      }).success).toBe(false)
      expect(memoryEntryPatchSchema.safeParse({
        category: 'areas',
        body: 'a'.repeat(1025),
      }).success).toBe(true)
    })

  it('checks the sensitive-category rule only when both are present', () => {
    expect(memoryEntryPatchSchema.safeParse({
      sensitiveCategory: 'health',
    }).success).toBe(true)
    expect(memoryEntryPatchSchema.safeParse({
      sensitivity: 'none',
      sensitiveCategory: 'health',
    }).success).toBe(false)
    expect(memoryEntryPatchSchema.safeParse({
      sensitivity: 'special',
      sensitiveCategory: 'health',
    }).success).toBe(true)
  })
})

describe('memorySettingsPatchShape', () => {
  it('accepts an empty payload and the plain fields', () => {
    expect(settingsSchema.safeParse({}).success).toBe(true)
    expect(settingsSchema.safeParse({
      memoryEnabled: true,
      memoryExtractionEnabled: true,
      chatSearchEnabled: false,
      aboutMe: null,
    }).success).toBe(true)
  })

  it.each([true, false])(
    'strips a legacy memoryIncludeSensitive of %s',
    (legacyValue) => {
      const parsed = settingsSchema.safeParse({
        memoryEnabled: true,
        memoryIncludeSensitive: legacyValue,
      })

      expect(parsed.success).toBe(true)
      expect(parsed.data).toEqual({ memoryEnabled: true })
      expect(Object.keys(parsed.data ?? {})).not.toContain(
        'memoryIncludeSensitive',
      )
    },
  )

  it('accepts only a boolean memoryExtractionEnabled', () => {
    expect(settingsSchema.safeParse({
      memoryExtractionEnabled: false,
    }).success).toBe(true)
    expect(settingsSchema.safeParse({
      memoryExtractionEnabled: 'yes',
    }).success).toBe(false)
    expect(settingsSchema.safeParse({
      memoryExtractionEnabled: null,
    }).success).toBe(false)
  })

  it('caps aboutMe at 4000 characters', () => {
    expect(settingsSchema.safeParse({
      aboutMe: 'a'.repeat(4000),
    }).success).toBe(true)
    expect(settingsSchema.safeParse({
      aboutMe: 'a'.repeat(4001),
    }).success).toBe(false)
  })

  it('rejects an unknown gateway id', () => {
    expect(settingsSchema.safeParse({
      profileMemoryModel: 'model',
      profileMemoryGateway: 'not-a-gateway',
    }).success).toBe(false)
  })
})

describe('refineMemorySettingsPatch', () => {
  it('rejects a gateway without a model', () => {
    expect(settingsSchema.safeParse({
      profileMemoryGateway: 'vercel',
    }).success).toBe(false)
    expect(settingsSchema.safeParse({
      projectMemoryGateway: 'openrouter',
      projectMemoryModel: null,
    }).success).toBe(false)
  })

  it('accepts a model alone and a model with its gateway', () => {
    expect(settingsSchema.safeParse({
      profileMemoryModel: 'claude-sonnet-5-5',
    }).success).toBe(true)
    expect(settingsSchema.safeParse({
      profileMemoryModel: 'openai/gpt-5',
      profileMemoryGateway: 'vercel',
    }).success).toBe(true)
  })

  it('accepts clearing a pair with nulls', () => {
    expect(settingsSchema.safeParse({
      projectMemoryModel: null,
      projectMemoryGateway: null,
    }).success).toBe(true)
  })

  it('checks both scopes independently', () => {
    const result = settingsSchema.safeParse({
      profileMemoryModel: 'openai/gpt-5',
      profileMemoryGateway: 'vercel',
      projectMemoryGateway: 'cloudflare',
    })

    expect(result.success).toBe(false)

    if (!result.success) {
      expect(result.error.issues.map(issue => issue.path[0]))
        .toEqual(['projectMemoryGateway'])
    }
  })
})

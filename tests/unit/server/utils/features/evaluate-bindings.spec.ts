import { describe, expect, it, vi } from 'vitest'
import type { FeatureDefinition } from '#shared/utils/features/registry'

const definition: FeatureDefinition = {
  key: 'needs-binding',
  title: 'Needs a binding',
  description: 'Test entry.',
  stage: 'internal',
  default: true,
  allowRoles: ['admin'],
  spend: 'none',
  optIn: 'none',
  requires: { bindings: ['SANDBOX'], keyKinds: [] },
  exposeToClient: true,
}

vi.mock('#shared/utils/features/registry', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('#shared/utils/features/registry')
  >()

  return {
    ...original,
    getFeatureDefinition: (key: string) => {
      return key === definition.key ? definition : undefined
    },
  }
})

const config = {
  featuresDisabled: '',
  featuresHostMode: 'byok' as const,
  featuresRolloutEnabled: false,
  adminEmails: '',
  requireAdminTwoFactor: false,
}

describe('evaluateFeature required bindings', () => {
  it('is off with HOST_MODE when a required binding is missing', async () => {
    const { evaluateFeature } = await import(
      '~~/server/utils/features/evaluate'
    )

    await expect(evaluateFeature('needs-binding', {
      userState: null,
      rules: {},
      config,
      hasBinding: () => false,
    })).resolves.toMatchObject({ value: false, reason: 'HOST_MODE' })
  })

  it('reads the Worker env when no binding checker is passed', async () => {
    const { evaluateFeature } = await import(
      '~~/server/utils/features/evaluate'
    )

    await expect(evaluateFeature('needs-binding', {
      userState: null,
      rules: {},
      config,
    })).resolves.toMatchObject({ value: false, reason: 'HOST_MODE' })
  })

  it('falls through to the default when the binding exists', async () => {
    const { evaluateFeature } = await import(
      '~~/server/utils/features/evaluate'
    )

    await expect(evaluateFeature('needs-binding', {
      userState: null,
      rules: {},
      config,
      hasBinding: (name) => {
        return name === 'SANDBOX'
      },
    })).resolves.toMatchObject({ value: true, reason: 'ANONYMOUS' })
  })
})

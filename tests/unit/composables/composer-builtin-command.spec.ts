import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import {
  useAvailableBuiltinCommands,
  useComposerBuiltinCommand,
} from '../../../app/composables/composer-builtin-command'

const { featuresState } = vi.hoisted(() => {
  return {
    featuresState: {
      value: null as null | {
        features: Record<string, { active: boolean }>
        isAdmin: boolean
      },
    },
  }
})

mockNuxtImport('useFeature', () => {
  return (key: string) => computed(() => {
    const active = featuresState.value?.features[key]?.active === true

    return { enabled: active, active, variant: null }
  })
})

beforeEach(() => {
  featuresState.value = null
  useComposerBuiltinCommand().clear()
})

describe('useComposerBuiltinCommand', () => {
  it('holds one command and builds its part', () => {
    const state = useComposerBuiltinCommand()

    expect(state.part.value).toBeNull()

    state.set('cost')

    expect(useComposerBuiltinCommand().command.value).toBe('cost')
    expect(state.part.value).toEqual({
      type: 'data-command-invocation',
      data: { command: 'cost' },
    })

    state.clear()

    expect(state.command.value).toBeNull()
  })
})

describe('useAvailableBuiltinCommands', () => {
  it('offers nothing before the features are known', () => {
    expect(useAvailableBuiltinCommands().value).toEqual([])
  })

  it('offers every built-in with the commands flag on', () => {
    featuresState.value = {
      features: { 'skills.commands': { active: true } },
      isAdmin: false,
    }

    expect(useAvailableBuiltinCommands().value.map(command => command.name))
      .toEqual(['cost', 'debug', 'stats'])
  })

  it('offers nothing with the commands flag off', () => {
    featuresState.value = {
      features: { 'skills.commands': { active: false } },
      isAdmin: false,
    }

    expect(useAvailableBuiltinCommands().value).toEqual([])
  })
})

import type { Theme } from '@besidka/artifacts-protocol'
import { PALETTE_TOKENS } from './palette.generated.ts'

const PALETTE_ALIASES: Record<string, string> = {
  'bg': 'var(--color-base-100)',
  'fg': 'var(--color-base-content)',
  'muted': 'color-mix(in oklab, var(--color-base-content) 60%, transparent)',
  'border': 'var(--color-base-300)',
  'accent': 'var(--color-accent)',
  'surface': 'var(--color-base-200)',
  'danger': 'var(--color-error)',
  'danger-bg': 'color-mix(in oklab, var(--color-error) 15%, var(--color-base-100))',
  'shadow': 'rgb(0 0 0 / 0.1)',
}

export function paletteDeclarations(theme: Theme): string {
  const tokens = Object.entries(PALETTE_TOKENS[theme]).map(([name, value]) => {
    return `${name}: ${value};`
  })
  const aliases = Object.entries(PALETTE_ALIASES).map(([name, value]) => {
    return `--besidka-${name}: ${value};`
  })

  return [...tokens, ...aliases].join(' ')
}

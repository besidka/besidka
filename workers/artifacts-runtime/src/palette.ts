import type { Theme } from '@besidka/artifacts-protocol'

export const PALETTE: Record<Theme, Record<string, string>> = {
  light: {
    'bg': '#ffffff',
    'fg': '#1f2328',
    'muted': '#59636e',
    'border': '#d1d9e0',
    'accent': '#0969da',
    'surface': '#f6f8fa',
    'danger': '#cf222e',
    'danger-bg': '#ffebe9',
  },
  dark: {
    'bg': '#0d1117',
    'fg': '#e6edf3',
    'muted': '#9198a1',
    'border': '#3d444d',
    'accent': '#4493f8',
    'surface': '#151b23',
    'danger': '#ff7b72',
    'danger-bg': '#2d1214',
  },
}

export function paletteDeclarations(theme: Theme): string {
  return Object.entries(PALETTE[theme]).map(([name, value]) => {
    return `--besidka-${name}: ${value};`
  }).join(' ')
}

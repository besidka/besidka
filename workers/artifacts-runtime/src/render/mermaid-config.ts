import type { Theme } from '@besidka/artifacts-protocol'

export const MERMAID_DEFAULT_LAYOUT = 'dagre'

export interface RuntimeMermaidConfig {
  startOnLoad: false
  securityLevel: 'strict'
  theme: 'dark' | 'default'
  layout: typeof MERMAID_DEFAULT_LAYOUT
  state: { layout: typeof MERMAID_DEFAULT_LAYOUT }
}

/**
 * Mermaid 12 defaults to the ELK layout, which the runtime does not ship
 * (elkjs is EPL-2.0 or GPL-3.0). Dagre is MIT and was the default before.
 */
export function createMermaidConfig(theme: Theme): RuntimeMermaidConfig {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme === 'dark' ? 'dark' : 'default',
    layout: MERMAID_DEFAULT_LAYOUT,
    state: { layout: MERMAID_DEFAULT_LAYOUT },
  }
}

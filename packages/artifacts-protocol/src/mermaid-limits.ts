export const MERMAID_MAX_EDGES = 500

export const MERMAID_MAX_TEXT_SIZE = 50_000

export const DIAGRAM_LIMIT_CODES = [
  'mermaid-edge-limit',
  'mermaid-text-limit',
] as const

export type DiagramLimitCode = typeof DIAGRAM_LIMIT_CODES[number]

export interface DiagramLimit {
  code: DiagramLimitCode
  limit: number
  found?: number
}

const EDGE_LIMIT_PATTERN = /^Edge limit exceeded\. \d+ edges found/

const SPLIT_ADVICE = 'Split it into smaller diagrams.'

/**
 * Mermaid stops counting at the limit, so its own message always reports
 * `limit` edges found and the real total is unknown: only the text size is
 * measured before rendering and carries `found`.
 */
export function detectMermaidLimit(
  message: string,
  source: string,
): DiagramLimit | null {
  if (source.length > MERMAID_MAX_TEXT_SIZE) {
    return {
      code: 'mermaid-text-limit',
      limit: MERMAID_MAX_TEXT_SIZE,
      found: source.length,
    }
  }

  if (EDGE_LIMIT_PATTERN.test(message)) {
    return { code: 'mermaid-edge-limit', limit: MERMAID_MAX_EDGES }
  }

  return null
}

export function describeDiagramLimit(diagramLimit: DiagramLimit): string {
  if (diagramLimit.code === 'mermaid-text-limit') {
    const size = diagramLimit.found === undefined
      ? 'its source is too long'
      : `its source is ${diagramLimit.found.toLocaleString('en-US')} characters`

    return `This diagram is too large to draw: ${size}, the limit is ${diagramLimit.limit.toLocaleString('en-US')} characters. ${SPLIT_ADVICE}`
  }

  return `This diagram is too large to draw: it has more than ${diagramLimit.limit.toLocaleString('en-US')} connections, the limit is ${diagramLimit.limit.toLocaleString('en-US')}. ${SPLIT_ADVICE}`
}

export function isDiagramLimitCode(value: unknown): value is DiagramLimitCode {
  return (DIAGRAM_LIMIT_CODES as readonly unknown[]).includes(value)
}

export function buildDiagramLimitFixPrompt(
  title: string,
  diagramLimit: DiagramLimit,
): string {
  const measure = diagramLimit.code === 'mermaid-text-limit'
    ? `its source is ${diagramLimit.found?.toLocaleString('en-US') ?? 'too many'} characters and the limit is ${diagramLimit.limit.toLocaleString('en-US')} characters`
    : `it has more than ${diagramLimit.limit.toLocaleString('en-US')} connections and the limit is ${diagramLimit.limit.toLocaleString('en-US')}`

  return `The Mermaid diagram in "${title}" is too large to draw: ${measure}. The limit is fixed and cannot be changed, so do not change any Mermaid configuration. Split the diagram into several smaller Mermaid diagrams (for example one per section or group of related nodes) or simplify it by merging or dropping minor nodes and connections, so that each diagram stays well under the limit.`
}

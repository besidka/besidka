import type { ResearchTraceEntry } from '#shared/types/research.d'

const MAX_RESEARCH_TRACE_ENTRIES = 100
const MAX_RESEARCH_TRACE_ENTRY_LENGTH = 500

export function clampResearchTrace(
  entries: ResearchTraceEntry[],
): ResearchTraceEntry[] {
  const clamped: ResearchTraceEntry[] = []

  for (const entry of entries) {
    const text = entry.text.trim().slice(0, MAX_RESEARCH_TRACE_ENTRY_LENGTH)

    if (!text) {
      continue
    }

    clamped.push({ kind: entry.kind, text })

    if (clamped.length >= MAX_RESEARCH_TRACE_ENTRIES) {
      break
    }
  }

  return clamped
}

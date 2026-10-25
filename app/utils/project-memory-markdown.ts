import type { MemoryEntryGroup } from '#shared/types/memory-api.d'
import { getMemoryCategoryLabel } from './memory-step'

const LEGACY_SECTION_HEADING = 'Earlier project memory (not converted yet)'

const INLINE_SIGNIFICANT_CHARACTERS = /[\\*_`[\]<>{}]/g

const MDC_COMPONENT_START = /:(?=[a-z])/gi

const LINE_START_BLOCK_MARKER = /^(\s*)([#>-])/

export function escapeMemoryMarkdown(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(INLINE_SIGNIFICANT_CHARACTERS, '\\$&')
    .replace(MDC_COMPONENT_START, '\\:')
    .replace(LINE_START_BLOCK_MARKER, '$1\\$2')
}

export function formatProjectMemoryMarkdown(
  groups: MemoryEntryGroup[],
  legacyMemory: string | null,
): string | null {
  const sections = groups
    .filter((group) => {
      return group.entries.length > 0
    })
    .map((group) => {
      const bullets = group.entries.map((entry) => {
        const title = escapeMemoryMarkdown(entry.title)
        const body = escapeMemoryMarkdown(entry.body)

        return `- **${title}** — ${body}`
      })

      return [
        `**${getMemoryCategoryLabel(group.category)}**`,
        ...bullets,
      ].join('\n')
    })
  const legacy = legacyMemory?.trim()

  if (legacy && sections.length === 0) {
    return legacy
  }

  if (legacy) {
    sections.push(`**${LEGACY_SECTION_HEADING}**\n\n${legacy}`)
  }

  return sections.length > 0 ? sections.join('\n\n') : null
}

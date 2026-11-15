import { describe, expect, it } from 'vitest'
import {
  BESIDKA_TOOL_NAME_PREFIX,
  REASONING_STEP_ICON_COLLECTIONS,
  getConnectorLetter,
  getToolPartDocumentFormat,
  resolveReasoningStepSource,
} from '../../../app/utils/reasoning-step-icons'
import type { ReasoningStepIcon } from '../../../app/utils/reasoning-step-icons'

function source(
  toolName: string,
  extra: Partial<Parameters<typeof resolveReasoningStepSource>[0]> = {},
) {
  return resolveReasoningStepSource({
    toolName,
    title: `title of ${toolName}`,
    ...extra,
  })
}

describe('resolveReasoningStepSource', () => {
  it('shows the search vendor that ran the search', () => {
    expect(source('web_search_brave').icon)
      .toEqual({ kind: 'provider', providerId: 'brave' })
    expect(source('web_search_exa').icon)
      .toEqual({ kind: 'provider', providerId: 'exa' })

    for (const provider of ['google', 'anthropic', 'openai', 'xai', 'deepseek']) {
      expect(source('web_search_preview', { searchProvider: provider }).icon)
        .toEqual({ kind: 'provider', providerId: provider })
    }

    expect(source('web_search', { searchProvider: 'deepseek' }).icon)
      .toEqual({ kind: 'provider', providerId: 'deepseek' })
  })

  it('shows a globe while the search provider is unknown', () => {
    expect(source('web_search_preview').icon)
      .toEqual({ kind: 'iconify', name: 'lucide:globe' })
    expect(source('web_search_preview', { searchProvider: 'vercel' }).icon)
      .toEqual({ kind: 'iconify', name: 'lucide:globe' })
    expect(source('web_search', { searchProvider: null }).icon)
      .toEqual({ kind: 'iconify', name: 'lucide:globe' })
  })

  it('shows the file type of a document and names its format', () => {
    const cases = [
      ['docx', 'lucide:file-text', 'DOCX'],
      ['xlsx', 'lucide:sheet', 'XLSX'],
      ['pptx', 'lucide:presentation', 'PPTX'],
      ['pdf', 'lucide:file-type', 'PDF'],
    ] as const

    for (const [format, icon, label] of cases) {
      expect(source('create_document', {
        documentFormat: format,
        isPending: true,
      })).toEqual({
        icon: { kind: 'iconify', name: icon },
        label: `Creating ${label}`,
      })
      expect(source('create_document', { documentFormat: format }).label)
        .toBe(`Created ${label}`)
    }
  })

  it('keeps the title of a failed or waiting document and of an unknown format', () => {
    expect(source('create_document', {
      documentFormat: 'docx',
      isFailed: true,
      title: 'Document call failed',
    }).label).toBe('Document call failed')
    expect(source('create_document', {
      documentFormat: 'docx',
      isAwaitingApproval: true,
      title: 'Waiting for approval: create_document',
    }).label).toBe('Waiting for approval: create_document')
    expect(source('create_document', { title: 'Creating a document' }))
      .toEqual({
        icon: { kind: 'iconify', name: 'lucide:file-text' },
        label: 'Creating a document',
      })
  })

  it('maps every other built-in tool to an icon and keeps its title', () => {
    const cases: Array<[string, string]> = [
      ['memory_list', 'lucide:book-user'],
      ['memory_read', 'lucide:book-user'],
      ['memory_write', 'lucide:book-user'],
      ['memory_forget', 'lucide:book-user'],
      ['activate_skill', 'lucide:sparkles'],
      ['read_skill_file', 'lucide:sparkles'],
      ['search_chats', 'lucide:messages-square'],
      ['read_chat', 'lucide:messages-square'],
      ['search_project_knowledge', 'lucide:folder-search'],
      ['read_project_knowledge', 'lucide:folder-search'],
      ['create_artifact', 'lucide:app-window'],
      ['update_artifact', 'lucide:app-window'],
      ['code_execution', 'lucide:square-terminal'],
      ['generate_image', 'lucide:image'],
      ['something_unknown', 'lucide:wrench'],
    ]

    for (const [toolName, icon] of cases) {
      expect(source(toolName)).toEqual({
        icon: { kind: 'iconify', name: icon },
        label: `title of ${toolName}`,
      })
    }
  })

  it('uses the Besidka mark for Besidka\'s own tools', () => {
    expect(source(`${BESIDKA_TOOL_NAME_PREFIX}list_chats`))
      .toEqual({
        icon: { kind: 'besidka' },
        label: 'title of besidka__list_chats',
      })
  })

  it('uses the connector icon of the owner\'s connector', () => {
    expect(source('mcp__notion__search_pages', {
      connectorId: 'abc123',
      connectorTitle: 'Notion',
      allowConnectorIcon: true,
    })).toEqual({
      icon: { kind: 'connector', connectorId: 'abc123', letter: 'N' },
      label: 'title of mcp__notion__search_pages',
    })
  })

  it('shows a generic plug where the connector is not allowed or unknown', () => {
    const plug: ReasoningStepIcon = {
      kind: 'iconify',
      name: 'lucide:plug',
    }

    expect(source('mcp__notion__search', {
      connectorId: 'abc123',
      allowConnectorIcon: false,
    }).icon).toEqual(plug)
    expect(source('mcp__gone__search', { allowConnectorIcon: true }).icon)
      .toEqual(plug)
    expect(source('mcp__gone__search', {
      connectorId: null,
      allowConnectorIcon: true,
    }).icon).toEqual(plug)
  })

  it('only names icons from the four pinned collections', () => {
    const toolNames = [
      'web_search_preview',
      'create_document',
      'memory_write',
      'activate_skill',
      'search_chats',
      'search_project_knowledge',
      'create_artifact',
      'code_execution',
      'generate_image',
      'unknown',
      'mcp__x__y',
    ]

    for (const toolName of toolNames) {
      for (const format of [null, 'docx', 'xlsx', 'pptx', 'pdf']) {
        const { icon } = source(toolName, { documentFormat: format })

        if (icon.kind !== 'iconify') {
          continue
        }

        const [collection] = icon.name.split(':')

        expect([...REASONING_STEP_ICON_COLLECTIONS]).toContain(collection)
      }
    }
  })
})

describe('getToolPartDocumentFormat', () => {
  it('reads a known format from the input', () => {
    expect(getToolPartDocumentFormat({ input: { format: 'pptx' } }))
      .toBe('pptx')
  })

  it('is null while the input streams or when the format is unknown', () => {
    expect(getToolPartDocumentFormat({ input: undefined })).toBeNull()
    expect(getToolPartDocumentFormat({ input: {} })).toBeNull()
    expect(getToolPartDocumentFormat({ input: { format: 'rtf' } })).toBeNull()
    expect(getToolPartDocumentFormat(null)).toBeNull()
    expect(getToolPartDocumentFormat('docx')).toBeNull()
  })
})

describe('getConnectorLetter', () => {
  it('uses the first letter, upper-cased', () => {
    expect(getConnectorLetter('  notion')).toBe('N')
    expect(getConnectorLetter('Бесідка')).toBe('Б')
  })

  it('falls back to a question mark', () => {
    expect(getConnectorLetter('')).toBe('?')
    expect(getConnectorLetter(undefined)).toBe('?')
  })
})

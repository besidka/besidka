import { describe, expect, it } from 'vitest'
import { GOOGLE_CALENDAR_TOOL_SCOPES } from '#shared/utils/google-calendar-tools'
import { GOOGLE_DRIVE_WRITE_TOOL_NAMES } from '#shared/utils/google-drive-tools'
import { GOOGLE_DRIVE_WRITE_TOOL_SCOPES } from '#shared/utils/google-drive-write'
import { GOOGLE_BYO_TOOL_SCOPES } from '#shared/utils/google-gmail-tools'
import {
  GOOGLE_SCOPES,
  GOOGLE_SCOPE_CAPABILITIES,
  hasScopes,
} from '#shared/utils/google-scopes'
import {
  GOOGLE_ALWAYS_ALLOW_READS_PER_MESSAGE,
  GOOGLE_ALWAYS_ALLOW_WRITES_PER_HOUR,
  GOOGLE_ALWAYS_ALLOW_WRITES_PER_MESSAGE,
  GOOGLE_SERVICES,
  GOOGLE_TOOL_APPROVAL_LABELS,
  GOOGLE_TOOL_ALWAYS_ALLOW_HINTS,
  GOOGLE_TOOL_CATALOG,
  GOOGLE_TOOL_MODE_LABELS,
  GOOGLE_TOOL_PERMISSION_MODES,
  findGoogleCatalogTool,
  getGoogleServiceTools,
  getGoogleToolAlwaysAllowHint,
  getGoogleToolAlwaysAllowWarning,
  getGoogleToolApprovalLabel,
  getGoogleToolModes,
  isGoogleToolAlwaysAllowable,
  isGoogleToolPermissionMode,
  readGoogleToolPermissionMode,
} from '#shared/utils/google-tool-catalog'
import { FEATURE_REGISTRY } from '#shared/utils/features/registry'
import { buildGoogleByoTools } from '~~/server/utils/google/byo-tools'
import { createGoogleReferenceIndex } from '~~/server/utils/google/chat-references'
import { buildGoogleCalendarTools } from '~~/server/utils/google/calendar-tools'
import { buildGoogleDriveTools } from '~~/server/utils/google/drive-tools'
import { buildGoogleDriveWriteTools } from '~~/server/utils/google/drive-write-tools'
import type { GoogleSendTools } from '~~/server/utils/tool-approval/google-send-candidates'

const ALL_SCOPES = Object.values(GOOGLE_SCOPES)

const logger = { set: () => undefined, warn: () => undefined }

const stubStores = {
  db: {} as never,
  kv: {} as never,
  userId: 1,
  chatGrantHashes: {},
  logger: logger as never,
}

async function buildAllTools(): Promise<GoogleSendTools[]> {
  return [
    await buildGoogleDriveTools({
      ...stubStores,
      event: { context: {} } as never,
    }),
    await buildGoogleByoTools({
      ...stubStores,
      grantedScopes: ALL_SCOPES,
    }),
    await buildGoogleDriveWriteTools({
      ...stubStores,
      grantedScopes: ALL_SCOPES,
      index: createGoogleReferenceIndex([]),
    }),
    await buildGoogleCalendarTools({
      ...stubStores,
      grantedScopes: ALL_SCOPES,
    }),
  ]
}

describe('google tool catalog', () => {
  it('lists exactly the tools the four builders offer', async () => {
    const built = await buildAllTools()
    const builtNames = built.flatMap((tools) => {
      return Object.keys(tools.tools)
    })

    expect(GOOGLE_TOOL_CATALOG.map(tool => tool.name).sort())
      .toEqual(builtNames.sort())
  })

  it('names each tool once', () => {
    const names = GOOGLE_TOOL_CATALOG.map(tool => tool.name)

    expect(new Set(names).size).toBe(names.length)
  })

  it('gives every tool the kind its approval entry declares', async () => {
    const built = await buildAllTools()

    for (const tools of built) {
      for (const [name, entry] of tools.entries) {
        const catalogEntry = GOOGLE_TOOL_CATALOG.find((tool) => {
          return tool.name === name
        })

        expect(catalogEntry?.kind, name).toBe(entry.descriptor.access)
      }
    }
  })

  it('maps every tool to a capability that grants its scopes', () => {
    const scopesByTool = {
      ...GOOGLE_BYO_TOOL_SCOPES,
      ...GOOGLE_CALENDAR_TOOL_SCOPES,
      ...Object.fromEntries(GOOGLE_DRIVE_WRITE_TOOL_NAMES.map((name) => {
        return [name, GOOGLE_DRIVE_WRITE_TOOL_SCOPES]
      })),
    }

    for (const tool of GOOGLE_TOOL_CATALOG) {
      const required = scopesByTool[tool.name]

      if (!required) {
        expect(tool.client, tool.name).toBe('besidka')
        expect(tool.neededCapability, tool.name).toBe('drive-picked')

        continue
      }

      const needsDriveRead = tool.neededCapability === 'drive-write'
      const granted = [
        ...GOOGLE_SCOPE_CAPABILITIES[tool.neededCapability].scopes,
        ...(needsDriveRead
          ? GOOGLE_SCOPE_CAPABILITIES['drive-read'].scopes
          : []),
      ]

      expect(hasScopes(granted, required), tool.name).toBe(true)
      expect(tool.client, tool.name).toBe('byo')
    }
  })

  it('allows each tool capability on the client the tool runs on', () => {
    for (const tool of GOOGLE_TOOL_CATALOG) {
      expect(
        GOOGLE_SCOPE_CAPABILITIES[tool.neededCapability].clients,
        tool.name,
      ).toContain(tool.client)
    }
  })

  it('names a registered feature flag for every tool', () => {
    for (const tool of GOOGLE_TOOL_CATALOG) {
      expect(FEATURE_REGISTRY[tool.flag], tool.name).toBeDefined()
    }
  })

  it('has tools for each service', () => {
    for (const service of GOOGLE_SERVICES) {
      expect(getGoogleServiceTools(service).length).toBeGreaterThan(0)
    }
  })

  it('shows Needs approval only for reads that can be allowed in a chat',
    () => {
      const labelsByName = Object.fromEntries(
        GOOGLE_TOOL_CATALOG.map((tool) => {
          return [tool.name, getGoogleToolApprovalLabel(tool)]
        }),
      )

      expect(labelsByName).toEqual({
        google__drive_list_picked: GOOGLE_TOOL_APPROVAL_LABELS.needsApproval,
        google__drive_read_file: GOOGLE_TOOL_APPROVAL_LABELS.needsApproval,
        google__drive_save_file: GOOGLE_TOOL_APPROVAL_LABELS.asksEveryTime,
        google__drive_search: GOOGLE_TOOL_APPROVAL_LABELS.needsApproval,
        google__drive_read_found_file:
          GOOGLE_TOOL_APPROVAL_LABELS.asksEveryTime,
        google__drive_list_folder: GOOGLE_TOOL_APPROVAL_LABELS.needsApproval,
        google__drive_create_folder:
          GOOGLE_TOOL_APPROVAL_LABELS.asksEveryTime,
        google__drive_rename: GOOGLE_TOOL_APPROVAL_LABELS.asksEveryTime,
        google__drive_move: GOOGLE_TOOL_APPROVAL_LABELS.asksEveryTime,
        google__gmail_search: GOOGLE_TOOL_APPROVAL_LABELS.needsApproval,
        google__gmail_read_thread: GOOGLE_TOOL_APPROVAL_LABELS.asksEveryTime,
        google__gmail_create_draft: GOOGLE_TOOL_APPROVAL_LABELS.asksEveryTime,
        google__calendar_list_events:
          GOOGLE_TOOL_APPROVAL_LABELS.needsApproval,
        google__calendar_free_busy: GOOGLE_TOOL_APPROVAL_LABELS.needsApproval,
        google__calendar_create_event:
          GOOGLE_TOOL_APPROVAL_LABELS.asksEveryTime,
      })
    })

  describe('permission modes', () => {
    it('offers Blocked, Needs approval and Always allow', () => {
      expect([...GOOGLE_TOOL_PERMISSION_MODES])
        .toEqual(['blocked', 'ask', 'allow'])
      expect(isGoogleToolPermissionMode('allow')).toBe(true)
      expect(isGoogleToolPermissionMode('ask')).toBe(true)
      expect(isGoogleToolPermissionMode('blocked')).toBe(true)
      expect(isGoogleToolPermissionMode(undefined)).toBe(false)
    })

    it('allows Always allow only for the tools of the own client', () => {
      const allowable = GOOGLE_TOOL_CATALOG
        .filter(tool => isGoogleToolAlwaysAllowable(tool))
        .map(tool => tool.name)
        .sort()

      expect(allowable).toEqual([
        'google__calendar_create_event',
        'google__calendar_free_busy',
        'google__calendar_list_events',
        'google__drive_create_folder',
        'google__drive_list_folder',
        'google__drive_move',
        'google__drive_read_found_file',
        'google__drive_rename',
        'google__drive_search',
        'google__gmail_create_draft',
        'google__gmail_read_thread',
        'google__gmail_search',
      ])
      expect(GOOGLE_TOOL_CATALOG.every((tool) => {
        return isGoogleToolAlwaysAllowable(tool) === (tool.client === 'byo')
      })).toBe(true)
    })

    it('takes a tool name too, and never allows an unknown name', () => {
      expect(isGoogleToolAlwaysAllowable('google__gmail_search')).toBe(true)
      expect(isGoogleToolAlwaysAllowable('google__drive_read_file'))
        .toBe(false)
      expect(isGoogleToolAlwaysAllowable('google__drive_save_file'))
        .toBe(false)
      expect(isGoogleToolAlwaysAllowable('gmail_search')).toBe(false)
      expect(isGoogleToolAlwaysAllowable('GOOGLE__GMAIL_SEARCH')).toBe(false)
      expect(isGoogleToolAlwaysAllowable('')).toBe(false)
    })

    it('offers Always allow in the modes of an allowable tool only', () => {
      for (const tool of GOOGLE_TOOL_CATALOG) {
        expect([...getGoogleToolModes(tool)], tool.name).toEqual(
          isGoogleToolAlwaysAllowable(tool)
            ? ['blocked', 'ask', 'allow']
            : ['blocked', 'ask'],
        )
      }
    })

    it('reads no stored value as ask', () => {
      expect(readGoogleToolPermissionMode('google__gmail_search', undefined))
        .toBe('ask')
      expect(readGoogleToolPermissionMode('google__gmail_search', 'ask'))
        .toBe('ask')
      expect(readGoogleToolPermissionMode('google__gmail_search', 'blocked'))
        .toBe('blocked')
    })

    it('reads allow as allow for an allowable tool only', () => {
      expect(readGoogleToolPermissionMode('google__gmail_search', 'allow'))
        .toBe('allow')
      expect(readGoogleToolPermissionMode('google__drive_read_file', 'allow'))
        .toBe('ask')
      expect(readGoogleToolPermissionMode('google__drive_save_file', 'allow'))
        .toBe('ask')
      expect(readGoogleToolPermissionMode('google__unknown', 'allow'))
        .toBe('ask')
    })

    it('reads an unknown stored value as blocked', () => {
      expect(readGoogleToolPermissionMode('google__gmail_search', 'x'))
        .toBe('blocked')
      expect(readGoogleToolPermissionMode('google__drive_read_file', 'x'))
        .toBe('blocked')
      expect(readGoogleToolPermissionMode('google__gmail_search', ''))
        .toBe('blocked')
    })

    it('says why Always allow is off for a tool of Besidka\'s own client', () => {
      expect(getGoogleToolAlwaysAllowHint())
        .toBe(GOOGLE_TOOL_ALWAYS_ALLOW_HINTS.appReview)
      expect(GOOGLE_TOOL_ALWAYS_ALLOW_HINTS.appReview).toBe(
        'Needs approval: this connection goes through Google\'s app review.',
      )
    })

    it('warns under each allowable tool and under no other', () => {
      const warnings = Object.fromEntries(GOOGLE_TOOL_CATALOG.map((tool) => {
        return [tool.name, getGoogleToolAlwaysAllowWarning(tool)]
      }))

      expect(warnings).toEqual({
        google__drive_list_picked: null,
        google__drive_read_file: null,
        google__drive_save_file: null,
        google__drive_search: 'Always allow lets the model read this '
          + 'without asking, including text written by other people.',
        google__drive_read_found_file: 'Always allow lets the model open the '
          + 'files a search found without asking, including everything other '
          + 'people wrote in them.',
        google__drive_list_folder: 'Always allow lets the model read this '
          + 'without asking, including text written by other people.',
        google__drive_create_folder: 'Always allow lets the model create, '
          + 'rename and move Drive items without asking. Google\'s '
          + 'permission for Drive also allows deleting and sharing; Besidka '
          + 'has no code that deletes or shares.',
        google__drive_rename: 'Always allow lets the model create, rename '
          + 'and move Drive items without asking. Google\'s permission for '
          + 'Drive also allows deleting and sharing; Besidka has no code '
          + 'that deletes or shares.',
        google__drive_move: 'Always allow lets the model create, rename and '
          + 'move Drive items without asking. Google\'s permission for Drive '
          + 'also allows deleting and sharing; Besidka has no code that '
          + 'deletes or shares.',
        google__gmail_search: 'Always allow lets the model read this '
          + 'without asking, including text written by other people.',
        google__gmail_read_thread: 'Always allow lets the model open whole '
          + 'email threads without asking, including everything other '
          + 'people wrote in them.',
        google__gmail_create_draft: 'Always allow lets the model create '
          + 'drafts without asking. Google\'s permission for drafts also '
          + 'allows sending mail; Besidka has no code that sends mail.',
        google__calendar_list_events: 'Always allow lets the model read this '
          + 'without asking, including text written by other people.',
        google__calendar_free_busy: 'Always allow lets the model read this '
          + 'without asking, including text written by other people.',
        google__calendar_create_event: 'Always allow lets the model create '
          + 'events without asking.',
      })
    })

    it('has a label for every mode and the three caps', () => {
      expect(GOOGLE_TOOL_MODE_LABELS).toEqual({
        blocked: 'Blocked',
        ask: 'Needs approval',
        allow: 'Always allow',
      })
      expect(GOOGLE_ALWAYS_ALLOW_READS_PER_MESSAGE).toBe(5)
      expect(GOOGLE_ALWAYS_ALLOW_WRITES_PER_MESSAGE).toBe(10)
      expect(GOOGLE_ALWAYS_ALLOW_WRITES_PER_HOUR).toBe(30)
    })

    it('finds a catalog tool by its exposed name only', () => {
      expect(findGoogleCatalogTool('google__gmail_search')?.service)
        .toBe('gmail')
      expect(findGoogleCatalogTool('gmail_search')).toBeNull()
    })
  })
})

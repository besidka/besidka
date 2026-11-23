import { describe, expect, it } from 'vitest'
import { GOOGLE_CALENDAR_TOOL_SCOPES } from '#shared/utils/google-calendar-tools'
import { GOOGLE_BYO_TOOL_SCOPES } from '#shared/utils/google-gmail-tools'
import {
  GOOGLE_SCOPES,
  GOOGLE_SCOPE_CAPABILITIES,
  hasScopes,
} from '#shared/utils/google-scopes'
import {
  GOOGLE_SERVICES,
  GOOGLE_TOOL_APPROVAL_LABELS,
  GOOGLE_TOOL_CATALOG,
  getGoogleServiceTools,
  getGoogleToolApprovalLabel,
} from '#shared/utils/google-tool-catalog'
import { FEATURE_REGISTRY } from '#shared/utils/features/registry'
import { buildGoogleByoTools } from '~~/server/utils/google/byo-tools'
import { buildGoogleCalendarTools } from '~~/server/utils/google/calendar-tools'
import { buildGoogleDriveTools } from '~~/server/utils/google/drive-tools'
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
    await buildGoogleCalendarTools({
      ...stubStores,
      grantedScopes: ALL_SCOPES,
    }),
  ]
}

describe('google tool catalog', () => {
  it('lists exactly the tools the three builders offer', async () => {
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
    }

    for (const tool of GOOGLE_TOOL_CATALOG) {
      const required = scopesByTool[tool.name]

      if (!required) {
        expect(tool.client, tool.name).toBe('besidka')
        expect(tool.neededCapability, tool.name).toBe('drive-picked')

        continue
      }

      expect(
        hasScopes(
          GOOGLE_SCOPE_CAPABILITIES[tool.neededCapability].scopes,
          required,
        ),
        tool.name,
      ).toBe(true)
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
})

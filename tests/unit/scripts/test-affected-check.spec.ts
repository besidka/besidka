import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SPACER_SUITES,
  getAffectedTests,
} from '../../../scripts/test-affected-check.mjs'

const OUT_OF_FLOW_COMPONENT_PREFIXES: string[] = [
  'app/components/Chat/Artifact/BridgeConfirm.client.vue',
  'app/components/Chat/Artifact/CodeView.client.vue',
  'app/components/Chat/Artifact/Detail.client.vue',
  'app/components/Chat/Artifact/Frame.client.vue',
  'app/components/Chat/Artifact/ReportButton.client.vue',
  'app/components/Chat/Artifact/ShareModal.client.vue',
  'app/components/Chat/CodeExecution/Detail.vue',
  'app/components/Chat/ContextMenu.client.vue',
  'app/components/Chat/ContextPanel',
  'app/components/Chat/Document/',
  'app/components/Chat/DocumentPreview.vue',
  'app/components/Chat/GoogleFileDownload.vue',
  'app/components/Chat/GoogleFileHeaderAction.vue',
  'app/components/Chat/GoogleFilePreview.vue',
  'app/components/Chat/ImagePreview.client.vue',
  'app/components/Chat/ShareModal.client.vue',
  'app/components/Chat/SkillPreview.client.vue',
  'app/components/Chat/TextFileModal.client.vue',
  'app/components/ChatInput/Files/Modal',
  'app/components/ChatInput/Files/DropZone.client.vue',
  'app/components/ChatInput/ModelsTrigger/',
  'app/components/ChatInput/ToolsMenu/',
  'app/components/ChatInput/ArtifactPicker.client.vue',
  'app/components/ChatInput/ConnectorPicker.client.vue',
  'app/components/ChatInput/ProjectPicker.client.vue',
  'app/components/ChatInput/SkillPicker.client.vue',
]

function listComponents(directory: string): string[] {
  return readdirSync(directory, { recursive: true })
    .map(entry => `${directory}/${String(entry).split('\\').join('/')}`)
    .filter(file => file.endsWith('.vue'))
    .sort()
}

function selectsAllSpacerSuites(file: string): boolean {
  const affected = getAffectedTests([file])

  if (affected === 'all') {
    return true
  }

  return SPACER_SUITES.every(suite => affected.includes(suite))
}

describe('test-affected-check spacer suites', () => {
  it('lists the unit spec and the three e2e specs', () => {
    expect(SPACER_SUITES).toEqual([
      'tests/unit/composables/chat-scroll-spacer.spec.ts',
      'tests/e2e/chat/scroll-spacer.spec.ts',
      'tests/e2e/chat/composer-overlays-spacer.spec.ts',
      'tests/e2e/chat/approval-scroll.spec.ts',
    ])
  })

  it.each([
    'app/composables/chat-scroll-spacer.ts',
    'app/composables/chat.ts',
    'app/composables/visual-viewport-inset.ts',
    'app/components/ChatInput.client.vue',
    'app/components/Chat/Message.vue',
    'app/components/Chat/Reasoning/ApprovalStep.vue',
    'app/components/Chat/Reasoning/GmailDraft.vue',
    'app/components/Chat/Reasoning/CalendarEvent.vue',
    'app/components/Chat/Artifact/Card.vue',
    'app/components/Chat/Document.vue',
    'app/components/Chat/GoogleFile.vue',
    'app/utils/artifact-parts.ts',
    'shared/utils/google-created-file.ts',
    'app/components/Chat/DriveFiles.vue',
    'app/components/Chat/ConnectorsNotice.vue',
    'app/components/Chat/OmittedContextFiles.vue',
    'app/components/ChatInput/Files/Attached/Preview.client.vue',
    'app/components/ChatInput/SettingTile.vue',
    'app/components/ChatInput/CommandPicker.vue',
  ])('selects the spacer suites for %s', (file) => {
    expect(selectsAllSpacerSuites(file)).toBe(true)
  })

  it('selects the spacer suites for every in-flow chat component', () => {
    const inFlowComponents = [
      ...listComponents('app/components/Chat'),
      ...listComponents('app/components/ChatInput'),
    ].filter((file) => {
      return !OUT_OF_FLOW_COMPONENT_PREFIXES.some((prefix) => {
        return file.startsWith(prefix)
      })
    })
    const unselected = inFlowComponents.filter((file) => {
      return !selectsAllSpacerSuites(file)
    })

    expect(
      unselected,
      'These components render in the message list or the composer but do '
      + 'not select the spacer suites. Map them in '
      + 'scripts/test-affected-check.mjs, or add them to '
      + 'OUT_OF_FLOW_COMPONENT_PREFIXES when they never change a message or '
      + 'the composer height.',
    ).toEqual([])
  })
})

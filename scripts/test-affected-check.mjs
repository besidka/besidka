#!/usr/bin/env node

/**
 * Check whether changed files affect tests of a given type.
 *
 * Can be used in two ways:
 *   1. Imported — getChangedFiles(), getAffectedTests(), filterTestsByType()
 *   2. Direct run — writes has-tests=true|false to $GITHUB_OUTPUT
 *
 * Usage (direct):
 *   node scripts/test-affected-check.mjs \
 *      [--base=main] [--type=unit|integration|e2e|all]
 */

/* eslint-disable no-console */

import { execSync } from 'node:child_process'
import { existsSync, appendFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const COOKIE_CONSENT_MODULE_TEST_DIR = 'modules/cookie-consent/test/'

export function getChangedFiles(base = 'HEAD') {
  try {
    let gitCommand

    if (base === 'HEAD') {
      gitCommand = 'git diff --name-only HEAD'
        + ' && git ls-files --others --exclude-standard'
    } else {
      gitCommand = `git diff --name-only ${base}...HEAD`
    }

    const output = execSync(
      gitCommand,
      { encoding: 'utf-8', shell: true },
    )

    const files = output.split('\n').filter(Boolean)

    return [...new Set(files)]
  } catch {
    console.warn(
      'Could not get git diff, running all tests',
    )

    return []
  }
}

export function listE2ESpecFiles() {
  const e2eDirectory = 'tests/e2e'

  if (!existsSync(e2eDirectory)) {
    return []
  }

  return readdirSync(e2eDirectory, { recursive: true })
    .map(entry => entry.split('\\').join('/'))
    .filter((entry) => {
      return entry.endsWith('.spec.ts')
        && !entry.split('/').includes('todo')
    })
    .map(entry => `${e2eDirectory}/${entry}`)
    .sort()
}

export function getAffectedTests(changedFiles) {
  const affectedTests = new Set()
  const filesModuleTests = [
    'tests/unit/components/Chat/Files.spec.ts',
    'tests/unit/components/ChatInput/Files/Attached/Preview.client.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal.client.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select.client.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/Grid/View.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/Grid/ActionsMenu.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/List/View.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/ProjectGroups.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Upload.client.spec.ts',
    'tests/unit/composables/chat-files.spec.ts',
    'tests/unit/composables/xls-convert.spec.ts',
    'tests/unit/workers/xls-convert.spec.ts',
    'tests/unit/utils/xls-convert.spec.ts',
    'tests/unit/composables/file-manager.spec.ts',
    'tests/unit/composables/file-manager-project-groups.spec.ts',
    'tests/unit/utils/files.spec.ts',
    'tests/unit/utils/file-delivery-hints.spec.ts',
    'tests/unit/utils/file-delivery.spec.ts',
    'tests/unit/utils/office-files.spec.ts',
    'tests/unit/server/utils/files/office-upload-check.spec.ts',
    'tests/unit/server/utils/files/office-text.spec.ts',
    'tests/unit/server/utils/files/derived-keys-delete-sites.spec.ts',
    'tests/unit/server/utils/chats/file-delivery-check.spec.ts',
    'tests/integration/api/chats-office-attachments.spec.ts',
    'tests/unit/utils/file-manager-sources.spec.ts',
    'tests/unit/utils/shared-files.spec.ts',
    'tests/unit/utils/upload-with-progress.spec.ts',
    'tests/integration/api/files-upload.spec.ts',
    'tests/integration/api/files-upload-office.spec.ts',
    'tests/integration/api/files-delete.spec.ts',
    'tests/integration/api/files-index.spec.ts',
    'tests/integration/api/files-index-source.spec.ts',
    'tests/integration/api/files-index-project-id.spec.ts',
    'tests/integration/api/files-projects.spec.ts',
    'tests/integration/server/file-governance.spec.ts',
    'tests/integration/server/assistant-files.spec.ts',
    'tests/integration/server/reconstruct-generated-image-parts.spec.ts',
    'tests/integration/server/file-download.spec.ts',
    'tests/integration/server/image-generation.spec.ts',
    'tests/integration/server/convert-files-for-ai.spec.ts',
    'tests/integration/server/convert-files-for-ai-office.spec.ts',
    'tests/integration/server/assistant-files-office-carry.spec.ts',
    'tests/integration/server/chat-deletion-cleanup.spec.ts',
    'tests/integration/server/cache-invalidation.spec.ts',
    'tests/integration/server/file-retention.spec.ts',
    'tests/integration/server/file-retention-cleanup-plugin.spec.ts',
    'tests/unit/components/Confirmation.spec.ts',
    'tests/unit/composables/confirmation.spec.ts',
    'tests/e2e/chat/files.spec.ts',
    'tests/e2e/chat/files-carousel-scroll.spec.ts',
    'tests/e2e/chat/office-attachments.spec.ts',
    'tests/e2e/shared/context-menu-image-hover.spec.ts',
  ]
  const topModalDialogTests = [
    'tests/unit/composables/top-modal-dialog.spec.ts',
    'tests/unit/components/ui/Messages.spec.ts',
  ]
  const chatInputToolsTests = [
    'tests/unit/components/ChatInput.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/WebSearchSection.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/ReasoningSection.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/StepsSection.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/Segmented.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/Content.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/Reveal.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/ToggleRow.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/Section.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/InfoNote.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/ActionRowWithInfo.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/InlineButton.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/CodeExecutionSection.spec.ts',
    'tests/unit/utils/code-execution-ui.spec.ts',
    'tests/unit/composables/reveal-guard.spec.ts',
    'tests/unit/composables/tools-menu-focus-rescue.spec.ts',
    'tests/unit/components/ChatInput/SettingTile.spec.ts',
    'tests/unit/components/ChatInput/Files/Attached/Preview.client.spec.ts',
    'tests/unit/utils/chat-input-tiles.spec.ts',
    'tests/unit/utils/reasoning-icons.spec.ts',
    'tests/unit/utils/web-search-price.spec.ts',
    'tests/unit/composables/scroll-edge-fade.spec.ts',
  ]
  const markdownTextareaTests = [
    'tests/unit/composables/markdown-textarea.spec.ts',
    'tests/unit/utils/knowledge-html-to-markdown.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/unit/components/Projects/InstructionsCard.spec.ts',
    'tests/unit/utils/pasted-text.spec.ts',
    'tests/unit/components/ChatInput/Files/Attached/TextCard.spec.ts',
    'tests/unit/components/ChatInput/Files/Attached/Preview.client.spec.ts',
    'tests/unit/components/Chat/TextFileModal.client.spec.ts',
    'tests/e2e/chat/chat-input-markdown.spec.ts',
  ]
  const documentRendererTests = [
    'tests/unit/packages/doc-renderer/spec.spec.ts',
    'tests/unit/packages/doc-renderer/render.spec.ts',
    'tests/unit/packages/doc-renderer/validate.spec.ts',
    'tests/unit/packages/doc-renderer/formula.spec.ts',
    'tests/unit/packages/doc-renderer/provenance.spec.ts',
    'tests/unit/packages/doc-renderer/package-boundaries.spec.ts',
    'tests/unit/packages/doc-renderer/notices.spec.ts',
    'tests/unit/packages/doc-renderer/hardening.spec.ts',
    'tests/unit/packages/doc-renderer/extract.spec.ts',
    'tests/unit/packages/doc-renderer/extract-docx.spec.ts',
    'tests/unit/packages/doc-renderer/extract-xlsx.spec.ts',
    'tests/unit/packages/doc-renderer/extract-pptx.spec.ts',
    'tests/unit/packages/doc-renderer/extract-hostile.spec.ts',
    'tests/unit/packages/doc-renderer/xml-truncation.spec.ts',
    'tests/unit/utils/shared-files.spec.ts',
    'tests/unit/utils/knowledge-zip.spec.ts',
  ]
  const storageQuotaTests = [
    'tests/unit/server/utils/storage/usage.spec.ts',
    'tests/unit/server/utils/files/connector-images.spec.ts',
    'tests/unit/server/mcp/tools/delete-connector-images.spec.ts',
    'tests/unit/server/utils/storage/errors.spec.ts',
    'tests/unit/server/utils/storage/guard.spec.ts',
    'tests/integration/api/storage.spec.ts',
    'tests/unit/server/utils/artifacts/store.spec.ts',
    'tests/unit/server/utils/ai/artifact-tools.spec.ts',
    'tests/unit/server/utils/mcp/private/artifacts.spec.ts',
    'tests/unit/server/utils/files/persist-file.spec.ts',
    'tests/unit/utils/knowledge/quota.spec.ts',
    'tests/unit/utils/knowledge/ingest.spec.ts',
    'tests/integration/api/files-upload.spec.ts',
    'tests/integration/api/projects-knowledge-items.spec.ts',
    'tests/integration/api/documents.spec.ts',
    'tests/integration/api/chats-documents.spec.ts',
    'tests/unit/server/utils/documents/create-document-tool.spec.ts',
    'tests/unit/server/utils/mcp/private-documents.spec.ts',
    'tests/unit/server/utils/mcp/private-files.spec.ts',
    'tests/unit/server/utils/mcp/private-settings-storage.spec.ts',
    'tests/unit/server/mcp/tools/get-settings.spec.ts',
    'tests/unit/composables/artifacts-library.spec.ts',
    'tests/unit/utils/ai/image-generation-errors.spec.ts',
    'tests/unit/utils/code-execution/persist-container-files.spec.ts',
    'tests/unit/server/utils/skills/import/commit.spec.ts',
    'tests/unit/server/utils/skills/versions/create.spec.ts',
    'tests/unit/server/utils/skills/versions/save.spec.ts',
    'tests/unit/server/utils/skills/versions/statements.spec.ts',
    'tests/unit/server/api/v1/skills/update-check.spec.ts',
  ]
  const storagePageTests = [
    'tests/unit/pages/profile/storage.spec.ts',
    'tests/unit/utils/storage-categories.spec.ts',
    'tests/unit/layouts/profile.spec.ts',
    'tests/unit/components/Search/Modal.spec.ts',
  ]
  const artifactsRuntimeTests = [
    'tests/unit/packages/artifacts-protocol/jsonrpc.spec.ts',
    'tests/unit/packages/artifacts-protocol/connection.spec.ts',
    'tests/unit/packages/artifacts-protocol/host.spec.ts',
    'tests/unit/packages/artifacts-protocol/mermaid-limits.spec.ts',
    'tests/unit/packages/artifacts-protocol/diagram-menus.spec.ts',
    'tests/unit/workers/artifacts-runtime/diagram-limit.spec.ts',
    'tests/unit/workers/artifacts-runtime/diagram-parity.spec.ts',
    'tests/unit/workers/artifacts-runtime/kit-menu.spec.ts',
    'tests/unit/workers/artifacts-runtime/kit-theme.spec.ts',
    'tests/unit/workers/artifacts-runtime/mermaid-view.spec.ts',
    'tests/unit/workers/artifacts-runtime/render.spec.ts',
    'tests/unit/workers/artifacts-runtime/bridge.spec.ts',
    'tests/unit/workers/artifacts-runtime/build.spec.ts',
    'tests/unit/workers/artifacts-runtime/kit.spec.ts',
    'tests/unit/workers/artifacts-runtime/design.spec.ts',
    'tests/e2e-artifacts/code-blocks.spec.ts',
    'tests/e2e-artifacts/design-system.spec.ts',
    'tests/e2e-artifacts/clipboard-gesture-spike.spec.ts',
    'tests/e2e-artifacts/html-script-errors.spec.ts',
    'tests/e2e-artifacts/no-raw-flash.spec.ts',
    'tests/e2e-artifacts/realm-isolation.spec.ts',
    'tests/e2e-artifacts/runtime-sandbox.spec.ts',
    'tests/unit/workers/artifacts-runtime/script-location.spec.ts',
  ]
  const artifactsBridgeServerTests = [
    'tests/integration/api/artifact-complete.spec.ts',
    'tests/integration/api/artifact-bridge-models.spec.ts',
    'tests/unit/server/utils/ai/resolve-cheapest-model.spec.ts',
  ]
  const artifactsCoreTests = [
    ...artifactsBridgeServerTests,
    'tests/unit/server/utils/artifacts/store.spec.ts',
    'tests/unit/server/utils/artifacts/access.spec.ts',
    'tests/unit/server/utils/artifacts/viewer-storage-retention.spec.ts',
    'tests/unit/server/utils/artifacts/viewer-storage-request.spec.ts',
    'tests/unit/server/utils/artifacts/viewer-storage-limit.spec.ts',
    'tests/integration/api/artifacts.spec.ts',
    'tests/integration/api/artifact-storage.spec.ts',
    'tests/integration/server/artifact-storage-sweep-plugin.spec.ts',
    'tests/unit/server/capabilities/conformance.spec.ts',
    'tests/unit/server/utils/chats/lifecycle.spec.ts',
    'tests/integration/api/chats-history.spec.ts',
    'tests/unit/utils/account/purge-user-data.spec.ts',
  ]
  const artifactsSharesTests = [
    'tests/unit/server/utils/artifacts/shares.spec.ts',
    'tests/unit/server/utils/artifacts/access.spec.ts',
    'tests/integration/api/artifact-shares.spec.ts',
    'tests/integration/api/shared-artifacts.spec.ts',
  ]
  const artifactsSharedChatTests = [
    'tests/integration/api/shared-artifacts.spec.ts',
    'tests/unit/server/api/shared-context.spec.ts',
    'tests/unit/components/Chat/Artifact/ReportButton.client.spec.ts',
  ]
  const artifactsUiTests = [
    'tests/unit/components/Chat/Artifact/Card.spec.ts',
    'tests/unit/components/Chat/Artifact/Detail.client.spec.ts',
    'tests/unit/components/Chat/Artifact/CodeView.client.spec.ts',
    'tests/unit/composables/chunked-code-highlight.spec.ts',
    'tests/unit/components/Chat/Artifact/Frame.client.spec.ts',
    'tests/unit/components/Chat/ContextPanel.spec.ts',
    'tests/unit/composables/artifacts.spec.ts',
    'tests/unit/composables/artifact-storage.spec.ts',
    'tests/unit/composables/artifact-bridge.spec.ts',
    'tests/unit/components/Chat/Artifact/BridgeConfirm.client.spec.ts',
    'tests/unit/utils/artifact-export.spec.ts',
    'tests/unit/utils/artifact-parts.spec.ts',
    'tests/unit/utils/artifact-bridge.spec.ts',
    'tests/unit/utils/artifact-fix-prompt.spec.ts',
    'tests/unit/components/Chat/Artifact/ShareModal.client.spec.ts',
    'tests/e2e/chat/artifacts-panel.spec.ts',
    'tests/e2e/chat/artifact-actions.spec.ts',
    'tests/e2e/shared/artifact-share.spec.ts',
    'tests/e2e/shared/artifact-panel-share.spec.ts',
    'tests/unit/pages/chats/artifacts/index.spec.ts',
    'tests/unit/components/History/ArtifactRow.spec.ts',
    'tests/unit/components/History/PageShell.spec.ts',
    'tests/unit/composables/artifacts-library.spec.ts',
    'tests/e2e/history/artifacts-library.spec.ts',
  ]
  const artifactsLibraryTests = [
    'tests/unit/pages/chats/artifacts/index.spec.ts',
    'tests/unit/components/Artifact/KindFilter.spec.ts',
    'tests/unit/components/History/FilterButtons.spec.ts',
    'tests/unit/components/History/ArtifactRow.spec.ts',
    'tests/unit/components/History/PageShell.spec.ts',
    'tests/unit/composables/artifacts-library.spec.ts',
    'tests/unit/server/utils/artifacts/queries.spec.ts',
    'tests/unit/components/Search/Modal.spec.ts',
    'tests/unit/components/Chat/ContextPanel.spec.ts',
    'tests/integration/api/artifacts.spec.ts',
    'tests/e2e/history/artifacts-library.spec.ts',
    'tests/e2e/chat/artifact-actions.spec.ts',
  ]
  const sharedHistoryTests = [
    'tests/unit/pages/chats/shared/index.spec.ts',
    'tests/unit/composables/shared-artifacts.spec.ts',
    'tests/unit/components/History/BoxTabs.spec.ts',
    'tests/unit/components/History/PageShell.spec.ts',
    'tests/integration/api/artifact-shared-list.spec.ts',
  ]
  const artifactsShareUiTests = [
    'tests/unit/pages/artifacts/[token].spec.ts',
    'tests/unit/components/Artifact/ReportModal.client.spec.ts',
    'tests/unit/components/Chat/Artifact/ReportButton.client.spec.ts',
    'tests/unit/components/Chat/Artifact/ShareModal.client.spec.ts',
    'tests/unit/components/Chat/Artifact/Detail.client.spec.ts',
    'tests/unit/components/Chat/Artifact/Frame.client.spec.ts',
    'tests/unit/composables/artifact-storage.spec.ts',
    'tests/unit/composables/artifact-bridge.spec.ts',
    'tests/unit/utils/artifact-share-page.spec.ts',
    'tests/unit/utils/artifact-share-location.spec.ts',
    'tests/unit/utils/scroll-within.spec.ts',
    'tests/unit/plugins/cloudflare-web-analytics.client.spec.ts',
    'tests/e2e/shared/artifact-share.spec.ts',
    'tests/e2e/shared/artifact-panel-share.spec.ts',
    'tests/unit/components/Shared/ExitLink.spec.ts',
    'tests/e2e/shared/shared-exit-link.spec.ts',
  ]
  const sharedExitLinkTests = [
    'tests/unit/components/Shared/ExitLink.spec.ts',
    'tests/e2e/shared/shared-exit-link.spec.ts',
  ]
  const artifactsAdminReportsTests = [
    'tests/unit/pages/admin/artifact-reports.spec.ts',
    'tests/unit/components/Admin/ArtifactReportDetail.client.spec.ts',
    'tests/unit/components/Admin/ArtifactTakedownForm.spec.ts',
    'tests/unit/components/Search/Modal.spec.ts',
  ]
  const artifactsChatTests = [
    'tests/unit/server/utils/ai/artifact-tools.spec.ts',
    'tests/unit/server/utils/artifacts/message-parts.spec.ts',
    'tests/unit/server/utils/artifacts/context.spec.ts',
    'tests/integration/api/chats-artifacts.spec.ts',
    'tests/unit/server/utils/chats/persist-user-message.spec.ts',
    'tests/unit/utils/chats/request-schema.spec.ts',
    'tests/unit/utils/message-metadata.spec.ts',
    'tests/unit/utils/ai/tool-loop.spec.ts',
    'tests/unit/utils/ai/search-answer-continuation.spec.ts',
    'tests/unit/composables/chat.spec.ts',
  ]
  const documentsChatTests = [
    'tests/integration/api/chats-documents.spec.ts',
    'tests/integration/api/documents.spec.ts',
    'tests/integration/api/documents-library.spec.ts',
    'tests/integration/api/files-kind-filter.spec.ts',
    'tests/integration/api/shared-documents.spec.ts',
    'tests/unit/components/Chat/Document.spec.ts',
    'tests/unit/components/Chat/DocumentPreview.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/KindFilter.spec.ts',
    'tests/unit/composables/document-flow.spec.ts',
    'tests/unit/composables/document-render.spec.ts',
    'tests/unit/server/capabilities/documents.spec.ts',
    'tests/unit/server/utils/documents/claim.spec.ts',
    'tests/unit/server/utils/documents/cleanup.spec.ts',
    'tests/unit/server/utils/documents/create-document-tool.spec.ts',
    'tests/unit/server/utils/documents/message-parts.spec.ts',
    'tests/unit/server/utils/documents/share.spec.ts',
    'tests/unit/server/utils/documents/store.spec.ts',
    'tests/unit/server/mcp/tools/create-document.spec.ts',
    'tests/unit/server/utils/mcp/private-documents.spec.ts',
    'tests/unit/utils/document-parts.spec.ts',
    'tests/unit/utils/document-ui.spec.ts',
    'tests/unit/workers/document-render.spec.ts',
    'tests/unit/server/utils/documents/rate-limit.spec.ts',
    'tests/unit/server/utils/documents/link-message.spec.ts',
    'tests/unit/server/utils/documents/stored-spec.spec.ts',
    'tests/unit/utils/documents/file-name.spec.ts',
    'tests/unit/utils/documents/library-helpers.spec.ts',
    'tests/unit/utils/documents/ai-generated.spec.ts',
    'tests/unit/components/Chat/Document/Blocks.spec.ts',
    'tests/unit/components/Chat/Document/Slide.spec.ts',
    'tests/unit/utils/chats/share-pii-check.spec.ts',
    'tests/unit/utils/chats/request-schema.spec.ts',
    'tests/unit/utils/message-metadata.spec.ts',
    'tests/unit/composables/chat.spec.ts',
    'tests/unit/server/utils/chats/persist-user-message.spec.ts',
    'tests/unit/server/utils/chats/context/build-chat-context.spec.ts',
    'tests/unit/server/utils/chats/share-public-parts.spec.ts',
    'tests/unit/utils/ai/tool-loop.spec.ts',
    'tests/unit/components/Chat/ContextPanel.spec.ts',
    'tests/integration/api/chats-shares-branch.spec.ts',
    'tests/integration/api/chats-branch.spec.ts',
    'tests/integration/server/chat-share.spec.ts',
    'tests/integration/api/chats-history.spec.ts',
  ]
  const documentsFileManagerTests = [
    'tests/unit/components/ChatInput/Files/Modal.client.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select.client.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/KindFilter.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/Grid/View.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/List/View.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/ProjectGroups.spec.ts',
    'tests/unit/composables/file-manager.spec.ts',
    'tests/unit/utils/file-manager-sources.spec.ts',
    'tests/integration/api/files-kind-filter.spec.ts',
    'tests/integration/api/files-index-source.spec.ts',
    'tests/integration/api/files-index-document-id.spec.ts',
  ]
  const documentsLibraryTests = [
    'tests/unit/pages/chats/documents/index.spec.ts',
    'tests/unit/components/History/DocumentRow.spec.ts',
    'tests/unit/components/History/BoxTabs.spec.ts',
    'tests/unit/components/History/FilterButtons.spec.ts',
    'tests/unit/components/History/PageShell.spec.ts',
    'tests/unit/components/Search/Modal.spec.ts',
    'tests/unit/components/Chat/DocumentPreview.spec.ts',
    'tests/unit/composables/documents-library.spec.ts',
    'tests/unit/utils/documents/library-helpers.spec.ts',
    'tests/integration/api/documents-library.spec.ts',
  ]
  const documentRendererWorkerTests = [
    'tests/unit/workers/doc-renderer/index.spec.ts',
    'tests/unit/workers/doc-renderer/bundle.spec.ts',
    'tests/unit/utils/documents/renderer.spec.ts',
    'tests/unit/workflows/production-satellites.spec.ts',
    'tests/unit/config/wrangler-previews.spec.ts',
  ]
  const artifactsAttachTests = [
    'tests/unit/components/ChatInput/ArtifactPicker.client.spec.ts',
    'tests/unit/components/Artifact/KindFilter.spec.ts',
    'tests/unit/components/Chat/ArtifactAttachments.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/Content.spec.ts',
    'tests/unit/components/History/ArtifactRow.spec.ts',
    'tests/unit/components/Chat/Artifact/Detail.client.spec.ts',
    'tests/unit/composables/artifacts-library.spec.ts',
    'tests/unit/utils/chat-input-tiles.spec.ts',
    'tests/unit/utils/artifact-attachments.spec.ts',
    'tests/unit/utils/chats/request-schema.spec.ts',
    'tests/unit/server/utils/artifacts/attachments.spec.ts',
    'tests/unit/server/utils/artifacts/chat-artifacts.spec.ts',
    'tests/unit/server/utils/artifacts/context.spec.ts',
    'tests/unit/server/utils/chats/share-public-parts.spec.ts',
    'tests/unit/server/utils/chats/context/build-chat-context.spec.ts',
    'tests/integration/api/chats-new-artifacts.spec.ts',
    'tests/integration/api/chats-new.spec.ts',
    'tests/integration/api/chats-artifacts.spec.ts',
    'tests/integration/api/chats-shares-branch.spec.ts',
    'tests/e2e/chat/artifact-attach.spec.ts',
  ]
  const mailAlertsTests = [
    'tests/unit/utils/mail-alert-protocol.spec.ts',
    'tests/unit/workers/mail-alerts/classify.spec.ts',
    'tests/unit/workers/mail-alerts/main.spec.ts',
    'tests/unit/server/utils/mail-alerts/notify.spec.ts',
    'tests/unit/server/api/v1/internal/mail-alert/index.post.spec.ts',
    'tests/unit/server/utils/features/schedule-notify.spec.ts',
  ]
  const profileSettingsTests = [
    'tests/integration/api/profile-settings.spec.ts',
    'tests/integration/api/profile-settings-legal-notices.spec.ts',
    'tests/integration/api/profile-settings-extraction-restamp.spec.ts',
    'tests/unit/composables/user-setting.spec.ts',
    'tests/unit/plugins/user-settings-sync.client.spec.ts',
    'tests/unit/composables/notification-prompt.spec.ts',
    'tests/unit/utils/memory/about-me-migration.spec.ts',
    'tests/unit/pages/profile/preferences.spec.ts',
    'tests/unit/pages/chats-new.spec.ts',
    'tests/unit/db/default-reasoning-level-migration.spec.ts',
    'tests/unit/pages/profile/labs.spec.ts',
  ]
  const preferencesPageTests = [
    'tests/unit/pages/profile/preferences.spec.ts',
    'tests/unit/pages/profile/settings.spec.ts',
    'tests/unit/layouts/profile.spec.ts',
    'tests/unit/composables/user-setting.spec.ts',
    'tests/e2e/profile/preferences.spec.ts',
  ]
  const oauthAuthServerTests = [
    'tests/unit/composables/auth-oauth-query.spec.ts',
    'tests/unit/middleware/00.auth.global.oauth.spec.ts',
    'tests/unit/components/OAuth/ScopePicker.spec.ts',
    'tests/unit/components/OAuth/ScopeLabel.spec.ts',
    'tests/unit/utils/auth-oauth.spec.ts',
    'tests/unit/utils/auth-rate-limit-oauth.spec.ts',
    'tests/unit/utils/account/purge-user-oauth-data.spec.ts',
    'tests/unit/utils/account/revoke-user-oauth-grants.spec.ts',
    'tests/unit/utils/account/notify-oauth-app-connected.spec.ts',
    'tests/unit/utils/account/security-emails.spec.ts',
    'tests/unit/utils/oauth/registration-limits.spec.ts',
    'tests/unit/utils/oauth/client-scope-upgrade.spec.ts',
    'tests/unit/utils/oauth/stored-scopes.spec.ts',
    'tests/unit/utils/oauth/narrow-consent-scopes.spec.ts',
    'tests/unit/utils/oauth/revoke-superseded-clients.spec.ts',
    'tests/unit/utils/oauth/protected-resource-metadata.spec.ts',
    'tests/unit/server/routes/well-known/oauth-protected-resource.spec.ts',
    'tests/integration/server/oauth-grant-sweep-plugin.spec.ts',
    'tests/unit/server/routes/auth.md.spec.ts',
    'tests/integration/api/profiles-connected-apps.spec.ts',
    'tests/integration/api/profiles-connected-apps-authorization-request.spec.ts',
    'tests/integration/api/profiles-connected-apps-consent.spec.ts',
    'tests/integration/api/profiles-connected-apps-list.spec.ts',
    'tests/integration/api/profiles-connected-apps-scopes.spec.ts',
    'tests/integration/api/profiles-connected-apps-revoke-bulk.spec.ts',
    'tests/unit/server/utils/mcp/auth.spec.ts',
    'tests/unit/server/middleware/mcp-request-guard.spec.ts',
    'tests/unit/utils/connected-apps.spec.ts',
    'tests/unit/components/Profile/ConnectedApps/PermissionsEditor.spec.ts',
    'tests/unit/pages/profile/connected-apps.spec.ts',
  ]
  const mcpArtifactTests = [
    'tests/unit/server/mcp/tools/list-artifacts.spec.ts',
    'tests/unit/server/mcp/tools/get-artifact.spec.ts',
    'tests/unit/server/mcp/tools/list-artifact-shares.spec.ts',
    'tests/unit/server/mcp/tools/create-artifact.spec.ts',
    'tests/unit/server/mcp/tools/update-artifact.spec.ts',
    'tests/unit/server/mcp/tools/revoke-artifact-shares.spec.ts',
    'tests/unit/server/mcp/tools/share-artifact.spec.ts',
    'tests/unit/server/mcp/tools/delete-artifacts.spec.ts',
    'tests/unit/server/utils/mcp/private/artifacts.spec.ts',
    'tests/unit/server/utils/mcp/tool-scopes.spec.ts',
  ]
  const mcpConnectorTests = [
    'tests/unit/server/mcp/tools/list-connectors.spec.ts',
    'tests/unit/server/mcp/tools/get-connector.spec.ts',
    'tests/unit/server/mcp/tools/add-connector.spec.ts',
    'tests/unit/server/mcp/tools/update-connector-tools.spec.ts',
    'tests/unit/server/mcp/tools/delete-connectors.spec.ts',
    'tests/unit/server/utils/mcp/private/connectors.spec.ts',
    'tests/unit/server/utils/connectors/store.spec.ts',
    'tests/unit/utils/connectors-text.spec.ts',
    'tests/unit/server/utils/mcp/private-access.spec.ts',
    'tests/unit/server/utils/mcp/tool-scopes.spec.ts',
    'tests/unit/server/utils/besidka-tools/parity.spec.ts',
    'tests/unit/config/mcp-surface.spec.ts',
    'tests/unit/components/OAuth/ScopeLabel.spec.ts',
    'tests/unit/components/OAuth/ScopePicker.spec.ts',
    'tests/integration/api/profiles-connected-apps-consent.spec.ts',
    'tests/integration/api/connectors-oauth-flow.spec.ts',
  ]
  const mcpGoogleConnectionTests = [
    'tests/unit/server/mcp/tools/list-google-connections.spec.ts',
    'tests/unit/server/mcp/tools/disconnect-google.spec.ts',
    'tests/unit/server/utils/mcp/private/google.spec.ts',
    'tests/unit/server/utils/besidka-tools/google-connections.spec.ts',
    'tests/unit/server/utils/mcp/private-access.spec.ts',
    'tests/unit/server/utils/mcp/tool-scopes.spec.ts',
    'tests/unit/server/utils/besidka-tools/parity.spec.ts',
    'tests/unit/server/utils/besidka-tools/chat-adapter.spec.ts',
    'tests/integration/api/chats-besidka-tools.spec.ts',
    'tests/unit/config/mcp-surface.spec.ts',
    'tests/unit/scripts/mcp-version-guard.spec.ts',
  ]
  const mcpSkillTests = [
    'tests/unit/server/mcp/tools/list-skills.spec.ts',
    'tests/unit/server/mcp/tools/get-skill.spec.ts',
    'tests/unit/server/mcp/tools/create-skill.spec.ts',
    'tests/unit/server/mcp/tools/update-skill.spec.ts',
    'tests/unit/server/mcp/tools/rename-skill.spec.ts',
    'tests/unit/server/mcp/tools/delete-skills.spec.ts',
    'tests/unit/server/utils/mcp/private/skills.spec.ts',
    'tests/unit/server/utils/skills/versions/settings.spec.ts',
    'tests/unit/server/utils/skills/versions/save.spec.ts',
    'tests/unit/server/utils/mcp/tool-scopes.spec.ts',
    'tests/unit/server/utils/mcp/private-access.spec.ts',
    'tests/unit/server/utils/besidka-tools/parity.spec.ts',
    'tests/unit/composables/skills-library.spec.ts',
    'tests/unit/utils/skills/frontmatter.spec.ts',
    'tests/unit/config/mcp-surface.spec.ts',
    'tests/unit/components/OAuth/ScopeLabel.spec.ts',
    'tests/unit/components/OAuth/ScopePicker.spec.ts',
    'tests/integration/api/profiles-connected-apps-consent.spec.ts',
  ]
  const besidkaToolsTests = [
    'tests/unit/server/utils/besidka-tools/parity.spec.ts',
    'tests/unit/server/utils/besidka-tools/summary.spec.ts',
    'tests/unit/server/utils/besidka-tools/summaries.spec.ts',
    'tests/unit/server/utils/besidka-tools/mcp-adapter.spec.ts',
    'tests/unit/server/utils/mcp/tool-scopes.spec.ts',
    'tests/unit/server/capabilities/conformance.spec.ts',
    'tests/unit/config/mcp-surface.spec.ts',
  ]
  const besidkaToolPermissionsTests = [
    'tests/unit/utils/besidka-tool-permissions.spec.ts',
    'tests/unit/utils/features/besidka-tools-registry.spec.ts',
    'tests/unit/server/utils/besidka-tools/permissions.spec.ts',
    'tests/integration/api/besidka-tools-permissions.spec.ts',
    'tests/unit/server/utils/tool-approval/continuation.spec.ts',
    'tests/unit/components/Profile/BesidkaTools/Permissions.spec.ts',
    'tests/unit/pages/profile/labs.spec.ts',
    'tests/unit/components/Search/Modal.spec.ts',
  ]
  const besidkaToolsChatTests = [
    'tests/unit/server/utils/ai/tool-index-prefetch.spec.ts',
    'tests/unit/server/utils/besidka-tools/chat-adapter.spec.ts',
    'tests/unit/server/utils/ai/tool-index.spec.ts',
    'tests/unit/server/utils/besidka-tools/chat-settings.spec.ts',
    'tests/integration/api/chats-besidka-tools.spec.ts',
    'tests/integration/api/besidka-tools-permissions.spec.ts',
    'tests/unit/server/utils/tool-approval/send.spec.ts',
    'tests/unit/server/utils/tool-approval/continuation.spec.ts',
    'tests/unit/composables/composer-besidka-tools.spec.ts',
    'tests/unit/components/ChatInput/ConnectorPicker.client.spec.ts',
    'tests/unit/utils/tool-approval-step.spec.ts',
    'tests/unit/utils/reasoning.spec.ts',
    'tests/unit/components/Chat/Reasoning.spec.ts',
    'tests/integration/api/chats-test-endpoint.spec.ts',
    'tests/unit/composables/composer-connectors.spec.ts',
    'tests/integration/api/chats-tool-approval-continuation.spec.ts',
    'tests/unit/components/Chat/Reasoning.approvals.spec.ts',
    'tests/unit/utils/reasoning-step-icons.spec.ts',
    'tests/unit/components/Chat/ContextPanelApprovals.spec.ts',
    'tests/unit/components/Profile/BesidkaTools/Permissions.spec.ts',
    'tests/integration/api/chats-tool-approval-grants.spec.ts',
    'tests/unit/components/Chat/Reasoning/ApprovalStep.spec.ts',
    'tests/unit/utils/memory/extract-input.spec.ts',
  ]
  const mcpUiParityTests = [
    'tests/unit/server/mcp/tools/list-my-features.spec.ts',
    'tests/unit/server/mcp/tools/list-feature-flags.spec.ts',
    'tests/unit/server/mcp/tools/list-feature-access.spec.ts',
    'tests/unit/server/mcp/tools/set-feature-access.spec.ts',
    'tests/unit/server/utils/mcp/private/features.spec.ts',
    'tests/unit/server/utils/mcp/admin-scopes.spec.ts',
    'tests/unit/server/mcp/tools/branch-chat.spec.ts',
    'tests/unit/server/mcp/tools/create-file.spec.ts',
    'tests/unit/server/mcp/tools/create-document.spec.ts',
    'tests/unit/server/mcp/tools/delete-chat-message.spec.ts',
    'tests/unit/server/mcp/tools/delete-chats.spec.ts',
    'tests/unit/server/mcp/tools/delete-files.spec.ts',
    'tests/unit/server/mcp/tools/delete-project.spec.ts',
    'tests/unit/server/mcp/tools/delete-project-knowledge-items.spec.ts',
    'tests/unit/server/mcp/tools/get-chat.spec.ts',
    'tests/unit/server/mcp/tools/get-debug-info.spec.ts',
    'tests/unit/server/mcp/tools/get-settings.spec.ts',
    'tests/unit/server/mcp/tools/list-chats.spec.ts',
    'tests/unit/server/mcp/tools/list-files.spec.ts',
    'tests/unit/server/mcp/tools/list-memory.spec.ts',
    'tests/unit/server/mcp/tools/list-shared-chats.spec.ts',
    'tests/unit/server/mcp/tools/move-chats-to-project.spec.ts',
    'tests/unit/server/mcp/tools/read-file.spec.ts',
    'tests/unit/server/mcp/tools/rename-file.spec.ts',
    'tests/unit/server/mcp/tools/reset-memory.spec.ts',
    'tests/unit/server/mcp/tools/revoke-chat-shares.spec.ts',
    'tests/unit/server/mcp/tools/update-chat.spec.ts',
    'tests/unit/server/mcp/tools/update-project.spec.ts',
    'tests/unit/server/mcp/tools/update-project-knowledge-item.spec.ts',
    'tests/unit/server/mcp/tools/update-settings.spec.ts',
    'tests/unit/server/utils/mcp/private-chat-actions.spec.ts',
    'tests/unit/server/utils/mcp/private-chats-read.spec.ts',
    'tests/unit/server/utils/mcp/private/debug-info.spec.ts',
    'tests/unit/server/api/chats-support-info.spec.ts',
    'tests/unit/server/utils/mcp/private-documents.spec.ts',
    'tests/unit/server/utils/mcp/private-files.spec.ts',
    'tests/unit/server/utils/mcp/private-projects-manage.spec.ts',
    'tests/unit/server/utils/mcp/private-settings.spec.ts',
    'tests/unit/server/utils/chats/generation-in-progress.spec.ts',
    'tests/unit/server/utils/chats/lifecycle.spec.ts',
    'tests/unit/server/utils/chats/share-management.spec.ts',
    'tests/unit/server/utils/files/delete-files.spec.ts',
    'tests/unit/utils/projects/lifecycle.spec.ts',
    'tests/unit/utils/projects/memory-toggle.spec.ts',
    'tests/unit/utils/oauth/client-scope-upgrade.spec.ts',
    'tests/unit/utils/oauth/stored-scopes.spec.ts',
  ]
  const memoryContractTests = [
    'tests/unit/utils/memory-policy.spec.ts',
    'tests/unit/utils/memory-schemas.spec.ts',
    'tests/unit/utils/memory/about-me-migration.spec.ts',
  ]
  const memoryJevTests = [
    'tests/unit/utils/memory/jev-check.spec.ts',
    'tests/integration/api/memory-jev.spec.ts',
  ]
  const jevInjectionScreeningTests = [
    'tests/unit/utils/jev/injection-screening.spec.ts',
    'tests/unit/utils/knowledge/unscreened.spec.ts',
    'tests/unit/utils/knowledge/sweep.spec.ts',
    'tests/integration/api/projects-knowledge-injection-screening.spec.ts',
    'tests/integration/api/projects-knowledge-real-pack.spec.ts',
    'tests/integration/api/chats-external-search.spec.ts',
  ]
  const jevRerankTests = [
    'tests/unit/utils/jev/rerank.spec.ts',
    'tests/unit/utils/memory/tools/search-chats-rerank.spec.ts',
    'tests/unit/utils/knowledge/rerank.spec.ts',
    'tests/integration/api/jev-rerank.spec.ts',
  ]
  const skillSelectionTests = [
    'tests/unit/server/utils/skills/jev/prefilter.spec.ts',
    'tests/unit/server/utils/skills/jev/questions.spec.ts',
    'tests/unit/server/utils/skills/jev/selection.spec.ts',
    'tests/unit/server/utils/skills/runtime/send.spec.ts',
  ]
  const jevFoundationTests = [
    ...skillSelectionTests,
    'tests/unit/utils/jev/client.spec.ts',
    'tests/unit/utils/jev/logging.spec.ts',
    'tests/unit/utils/jev/roles.spec.ts',
    ...jevRerankTests,
    'tests/unit/utils/jev-policy.spec.ts',
    'tests/integration/api/chats-share-check.spec.ts',
    ...memoryJevTests,
    ...jevInjectionScreeningTests,
  ]
  const autoWebSearchTests = [
    'tests/unit/utils/chats/auto-web-search.spec.ts',
    'tests/integration/api/chats-auto-web-search.spec.ts',
    'tests/integration/api/chats-new-auto-web-search.spec.ts',
    'tests/unit/composables/auto-web-search.spec.ts',
    'tests/unit/components/Chat/AutoWebSearchChip.spec.ts',
    'tests/unit/utils/auto-web-search.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/WebSearchSection.spec.ts',
    'tests/unit/utils/chat-input-tiles.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu.spec.ts',
    'tests/unit/composables/chat.spec.ts',
    'tests/unit/pages/chats-new.spec.ts',
  ]
  const typesafeRolesUiTests = [
    'tests/unit/components/Profile/Keys/TypesafeChecks.spec.ts',
    'tests/unit/components/Profile/Keys/MemoryChecksInfo.spec.ts',
    'tests/unit/components/Profile/Memory/ExtraChecks.spec.ts',
    'tests/unit/composables/typesafe-roles.spec.ts',
    'tests/unit/pages/profile/keys.spec.ts',
  ]
  const memoryComplianceTests = [
    'tests/unit/utils/memory/compliance.spec.ts',
    'tests/unit/utils/memory/compliance-evasion.spec.ts',
    'tests/unit/utils/memory/sensitivity.spec.ts',
    'tests/unit/utils/chats/share-pii-check.spec.ts',
    ...memoryJevTests,
  ]
  const memoryModelTests = [
    'tests/unit/utils/memory/resolve-model.spec.ts',
    'tests/unit/utils/memory/catalog-usability.spec.ts',
    'tests/unit/utils/project-memory.spec.ts',
  ]
  const memoryPurgeTests = [
    'tests/unit/utils/account/purge-user-data.spec.ts',
  ]
  const projectKnowledgeContractTests = [
    'tests/unit/utils/project-knowledge-policy.spec.ts',
    'tests/unit/utils/project-knowledge-budget.spec.ts',
    'tests/unit/utils/project-knowledge-schemas.spec.ts',
    'tests/unit/utils/project-knowledge-path.spec.ts',
    'tests/unit/utils/knowledge-hash.spec.ts',
  ]
  const projectKnowledgeServerTests = [
    'tests/unit/utils/knowledge/storage-keys.spec.ts',
    'tests/unit/utils/knowledge/purge.spec.ts',
    'tests/unit/utils/knowledge/quota.spec.ts',
  ]
  const projectKnowledgeRetrievalTests = [
    'tests/unit/utils/knowledge/search.spec.ts',
    'tests/unit/utils/knowledge/tools.spec.ts',
    'tests/unit/utils/knowledge/pre-retrieval.spec.ts',
    'tests/unit/utils/knowledge/send-data.spec.ts',
    'tests/unit/utils/knowledge/context.spec.ts',
    'tests/unit/utils/knowledge/previous-mode.spec.ts',
    'tests/integration/api/chats-project-knowledge.spec.ts',
    ...jevRerankTests,
  ]
  const knowledgeCoreTests = [
    'tests/unit/utils/knowledge/items.spec.ts',
    'tests/unit/utils/knowledge/version.spec.ts',
    'tests/unit/utils/knowledge/text-store.spec.ts',
    'tests/unit/utils/knowledge/chunk.spec.ts',
    'tests/unit/utils/knowledge/pack.spec.ts',
    'tests/unit/utils/knowledge/pack-lease.spec.ts',
  ]
  const knowledgeIngestTests = [
    'tests/unit/utils/knowledge/access.spec.ts',
    'tests/unit/utils/knowledge/ingest.spec.ts',
    'tests/integration/api/projects-knowledge-ownership.spec.ts',
    'tests/integration/api/projects-knowledge-items.spec.ts',
    'tests/integration/api/projects-knowledge-notes.spec.ts',
    'tests/integration/api/projects-knowledge-injection-screening.spec.ts',
    'tests/integration/api/projects-knowledge-commit.spec.ts',
    'tests/integration/api/projects-knowledge-summary.spec.ts',
    'tests/integration/api/projects-knowledge-real-pack.spec.ts',
    'tests/integration/api/projects-knowledge-limits.spec.ts',
    'tests/unit/utils/knowledge/body.spec.ts',
    'tests/unit/utils/knowledge/rate-limit.spec.ts',
  ]
  const knowledgeRetentionTests = [
    'tests/unit/utils/knowledge/linked-files.spec.ts',
    'tests/unit/utils/knowledge/sweep.spec.ts',
    'tests/unit/utils/knowledge/unscreened.spec.ts',
    'tests/integration/server/knowledge-retention.spec.ts',
    'tests/integration/server/project-knowledge-sweep-plugin.spec.ts',
    'tests/integration/server/chat-deletion-cleanup.spec.ts',
    'tests/integration/api/files-delete.spec.ts',
    'tests/integration/api/files-index-project-id.spec.ts',
    'tests/integration/api/files-projects.spec.ts',
    'tests/integration/api/projects.spec.ts',
  ]
  const memoryEntriesTests = [
    'tests/unit/utils/memory/entries.spec.ts',
    'tests/unit/utils/memory/entry-slug.spec.ts',
    'tests/integration/api/memory-entries.spec.ts',
    'tests/integration/api/memory-entries-sources.spec.ts',
    'tests/unit/utils/memory/about-me-migration.spec.ts',
    'tests/integration/api/profile-settings.spec.ts',
    'tests/integration/api/memory-rate-limit.spec.ts',
    'tests/unit/utils/memory/instruct.spec.ts',
    'tests/integration/api/memory-instruct.spec.ts',
    ...memoryJevTests,
  ]
  const memoryInstructTests = [
    'tests/unit/utils/memory/instruct.spec.ts',
    'tests/integration/api/memory-instruct.spec.ts',
    'tests/unit/utils/memory-instruct-diff.spec.ts',
    'tests/unit/components/Profile/Memory/Instruct/Box.spec.ts',
    'tests/unit/components/Profile/Memory/Instruct/Preview.spec.ts',
    'tests/unit/components/Profile/Memory/Entries.spec.ts',
    'tests/unit/components/Projects/MemoryCard.spec.ts',
    ...memoryJevTests,
  ]
  const memoryIndexTests = [
    'tests/unit/utils/memory-tokens.spec.ts',
    'tests/unit/utils/memory/index-builder.spec.ts',
    'tests/unit/utils/memory/runtime-settings.spec.ts',
    'tests/unit/utils/memory/chat-context.spec.ts',
    'tests/unit/utils/memory/about-me-migration.spec.ts',
    'tests/unit/utils/memory/persist-redaction.spec.ts',
  ]
  const memoryChatDeletionTests = [
    'tests/unit/utils/memory/chat-deletion.spec.ts',
    'tests/integration/api/chats-history.spec.ts',
  ]
  const memoryToolTests = [
    'tests/unit/utils/memory/tools/memory-tools.spec.ts',
    'tests/unit/utils/memory/tools/web-search-write-lock.spec.ts',
    'tests/unit/utils/memory/tools/enabled.spec.ts',
    'tests/unit/utils/ai/memory-tools.spec.ts',
    'tests/integration/api/chats-memory.spec.ts',
    ...memoryIndexTests,
    ...memoryJevTests,
  ]
  const memoryStepTests = [
    'tests/unit/utils/memory-step.spec.ts',
    'tests/unit/components/Chat/Reasoning/MemoryStep.spec.ts',
    'tests/unit/components/Chat/Reasoning.spec.ts',
  ]
  const memoryExtractionTests = [
    'tests/unit/utils/memory/extract-apply.spec.ts',
    'tests/unit/utils/memory/extract-input.spec.ts',
    'tests/unit/utils/memory/extract-runtime.spec.ts',
    'tests/unit/utils/memory/extract-sweep.spec.ts',
    'tests/unit/utils/memory/extract.spec.ts',
    'tests/unit/utils/memory/extract-prefilter.spec.ts',
    'tests/unit/utils/projects/memory-entries.spec.ts',
    'tests/unit/utils/projects/memory-refresh.spec.ts',
    'tests/unit/utils/projects/memory-card.spec.ts',
    'tests/unit/utils/projects/memory-account.spec.ts',
    'tests/unit/utils/projects/memory-sweep-settle.spec.ts',
    'tests/unit/utils/projects/memory-toggle.spec.ts',
    'tests/unit/utils/memory/project-auto-update.spec.ts',
    'tests/unit/utils/project-memory-auto-update.spec.ts',
    'tests/unit/utils/memory/forward-only-memory-resume.spec.ts',
    'tests/unit/utils/memory/extract-manual.spec.ts',
    'tests/unit/utils/project-memory-refresh.spec.ts',
    'tests/unit/utils/memory/extract-grounding.spec.ts',
    'tests/unit/utils/memory/extract-text.spec.ts',
    'tests/unit/utils/memory/backfill.spec.ts',
    'tests/unit/utils/memory/backfill-estimate.spec.ts',
    'tests/unit/utils/memory/backfill-sweep.spec.ts',
    'tests/unit/utils/memory/extract-error.spec.ts',
    'tests/unit/utils/memory-import-prompt.spec.ts',
    'tests/integration/api/memory-backfill.spec.ts',
    'tests/integration/api/memory-import.spec.ts',
    'tests/integration/server/memory-extraction-sweep-plugin.spec.ts',
    'tests/integration/server/memory-backfill-sweep-plugin.spec.ts',
    'tests/integration/api/memory-extract-now.spec.ts',
    'tests/integration/api/profile-settings-extraction-restamp.spec.ts',
    'tests/unit/utils/memory/instruct.spec.ts',
    'tests/integration/api/memory-instruct.spec.ts',
    'tests/integration/api/chats-memory-exclusion.spec.ts',
    ...memoryJevTests,
  ]
  const memoryChatExclusionTests = [
    'tests/integration/api/chats-memory-exclusion.spec.ts',
    'tests/integration/api/chats-new.spec.ts',
    'tests/integration/api/chats-branch.spec.ts',
    'tests/unit/utils/memory/extract-sweep.spec.ts',
    'tests/unit/utils/memory/extract-manual.spec.ts',
    'tests/unit/utils/memory/backfill.spec.ts',
    'tests/unit/utils/projects/memory-refresh.spec.ts',
    'tests/unit/utils/memory/tools/search-chats.spec.ts',
    'tests/unit/utils/memory/tools/read-chat.spec.ts',
    'tests/unit/composables/chat-memory-exclusion.spec.ts',
    'tests/unit/components/History/ActionsDropdown.spec.ts',
    'tests/unit/components/History/ChatRow.spec.ts',
    'tests/unit/components/Sidebar/Development.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu.spec.ts',
  ]
  const imageGenerationTests = [
    'tests/unit/utils/model.spec.ts',
    'tests/unit/utils/image-generation-cost.spec.ts',
    'tests/unit/utils/ai/image-generation-xai.spec.ts',
    'tests/unit/utils/ai/image-generation-openai.spec.ts',
    'tests/unit/utils/ai/image-generation-errors.spec.ts',
    'tests/unit/utils/ai/image-provenance.spec.ts',
    'tests/unit/composables/chat-input.spec.ts',
    'tests/unit/composables/chat-input-url-detection.spec.ts',
    'tests/unit/composables/chat-image-preview-guard.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/ReasoningSection.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/WebSearchSection.spec.ts',
    'tests/unit/utils/chat-input-tiles.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu.spec.ts',
    'tests/e2e/chat/exa-search-level.spec.ts',
    'tests/integration/server/image-generation.spec.ts',
    'tests/integration/server/image-generation-lock.spec.ts',
    'tests/integration/server/assistant-files.spec.ts',
    'tests/integration/api/chats-message-id-stream.spec.ts',
  ]
  const modelsTriggerPattern
    = /^(app\/components\/ChatInput\/ModelsTrigger(\.vue|\/.+\.vue)|app\/utils\/models-picker\.ts|app\/types\/models-picker\.d\.ts|app\/composables\/(visual-viewport-inset|scroll-edge-fade)\.ts)$/
  const modelsTriggerTests = [
    'tests/unit/components/ChatInput/ModelsTrigger.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger.research.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger.keys.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger.sheet.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/Search.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/ProviderRail.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/ModelItem.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/ModelDetail.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/FilterDropdown.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/FilterSection.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/GatewayModelDetail.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/GatewayModelItem.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/GatewayProviderRail.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/GatewayRail.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/GatewayModelList.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/Panel.spec.ts',
    'tests/unit/utils/models-picker.spec.ts',
    'tests/unit/composables/visual-viewport-inset.spec.ts',
    'tests/e2e/chat/models-picker.spec.ts',
  ]
  const userKeysTests = [
    'tests/unit/composables/user-keys.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/unit/composables/chat-input.spec.ts',
    ...modelsTriggerTests,
  ]
  const modelSelectionTests = [
    'tests/unit/composables/model.spec.ts',
    'tests/unit/composables/selected-model-info.spec.ts',
    'tests/unit/composables/chat-input.spec.ts',
    'tests/unit/composables/chat-research.spec.ts',
  ]
  const modelCatalogTests = [
    'tests/unit/providers/merge.spec.ts',
    'tests/unit/providers/anthropic.spec.ts',
    'tests/unit/providers/xai.spec.ts',
    'tests/unit/providers/deepseek.spec.ts',
    'tests/unit/providers/moonshotai.spec.ts',
    'tests/unit/providers/qwen.spec.ts',
    'tests/unit/providers/default-model.spec.ts',
    'tests/unit/providers/ordering.spec.ts',
    'tests/unit/providers/helper-models.spec.ts',
    'tests/unit/providers/reasoning-control-state.spec.ts',
    'tests/unit/scripts/audit-curated-models.spec.ts',
    'tests/unit/scripts/detect-model-successors.spec.ts',
    'tests/unit/scripts/propose-model-successors-rehearsal.spec.ts',
    'tests/unit/utils/model.spec.ts',
    'tests/unit/utils/cost-map.spec.ts',
    ...modelsTriggerTests,
    'tests/e2e/chat/scroll-spacer.spec.ts',
  ]
  const providerReasoningWiringTests = [
    'tests/unit/utils/providers/deepseek.spec.ts',
    'tests/unit/utils/providers/moonshotai.spec.ts',
    'tests/unit/utils/providers/openai.spec.ts',
    'tests/unit/utils/providers/google.spec.ts',
    'tests/unit/utils/providers/xai.spec.ts',
    'tests/unit/utils/providers/anthropic.spec.ts',
    'tests/unit/server/utils/ai/anthropic-thinking-binding.spec.ts',
    'tests/unit/utils/providers/qwen.spec.ts',
    'tests/unit/utils/reasoning-levels.spec.ts',
    'tests/unit/providers/reasoning-control-state.spec.ts',
  ]
  const moonshotWebSearchTests = [
    'tests/unit/utils/providers/moonshotai-web-search.spec.ts',
    'tests/unit/utils/providers/moonshotai.spec.ts',
    'tests/unit/providers/moonshotai.spec.ts',
    'tests/unit/utils/ai/tool-loop.spec.ts',
  ]
  const deepseekWebSearchTests = [
    'tests/unit/utils/providers/deepseek-web-search.spec.ts',
    'tests/unit/utils/providers/deepseek.spec.ts',
    'tests/unit/providers/deepseek.spec.ts',
    'tests/unit/utils/ai/tool-loop.spec.ts',
  ]
  const chatStreamBranchTests = [
    'tests/unit/composables/chat.spec.ts',
    'tests/unit/utils/filter-ui-message-stream.spec.ts',
    'tests/integration/api/chats-branch.spec.ts',
    'tests/integration/api/chats-duplicate-message.spec.ts',
    'tests/integration/api/chats-message-id-stream.spec.ts',
    'tests/integration/api/chats-single-step-characterization.spec.ts',
    'tests/integration/api/chats-tool-loop.spec.ts',
    'tests/unit/utils/ai/tool-loop.spec.ts',
    'tests/unit/utils/ai/search-answer-continuation.spec.ts',
    'tests/unit/utils/ai/current-date-instruction.spec.ts',
    'tests/unit/utils/ai/native-search-instruction.spec.ts',
    'tests/integration/api/chats-google-leading-assistant-placeholder.spec.ts',
    'tests/integration/api/chats-model-context-real-sanitizer.spec.ts',
    'tests/integration/server/model-turns.spec.ts',
    'tests/integration/api/chats-external-search-validation.spec.ts',
    'tests/integration/api/chats-external-search.spec.ts',
    'tests/integration/api/chats-gateway.spec.ts',
    'tests/integration/api/chats-cloudflare-search-answer.spec.ts',
  ]
  const chatTestEndpointTests = [
    'tests/integration/api/chats-test-endpoint.spec.ts',
    'tests/e2e/chat/context-menu-image.spec.ts',
    'tests/e2e/chat/context-menu-image-desktop.spec.ts',
    'tests/e2e/chat/gateway-image-generation.spec.ts',
    'tests/e2e/chat/image-generation-single-message.spec.ts',
    'tests/e2e/chat/mermaid-diagram.spec.ts',
    'tests/e2e/chat/chat-input-markdown.spec.ts',
  ]
  const mermaidDiagramTests = [
    'tests/unit/utils/markdown-fences.spec.ts',
    'tests/unit/composables/diagram-renderer.spec.ts',
    'tests/unit/utils/diagram-fonts.spec.ts',
    'tests/unit/utils/diagram-export-color.spec.ts',
    'tests/unit/utils/diagram-export-drawio.spec.ts',
    'tests/unit/utils/diagram-export-fonts.spec.ts',
    'tests/unit/utils/diagram-export-png.spec.ts',
    'tests/unit/utils/diagram-export-svg.spec.ts',
    'tests/unit/utils/diagram-export-theme.spec.ts',
    'tests/unit/composables/diagram-export.spec.ts',
    'tests/unit/utils/pele-examples.spec.ts',
    'tests/unit/utils/diagram-theme-contrast.spec.ts',
    'tests/unit/workers/diagram.worker.spec.ts',
    'tests/unit/composables/markdown-source.spec.ts',
    'tests/unit/components/prose/PreStream.spec.ts',
    'tests/unit/components/prose/MermaidDiagram.spec.ts',
    'tests/unit/components/prose/MermaidViewer.client.spec.ts',
    'tests/unit/components/prose/MermaidActionMenu.spec.ts',
    'tests/unit/components/prose/MermaidEditor.spec.ts',
    'tests/unit/components/Chat/MarkdownSource.spec.ts',
    'tests/unit/utils/sanitize-diagram-svg.spec.ts',
    'tests/unit/utils/diagram-wheel.spec.ts',
    'tests/unit/workers/artifacts-runtime/diagram-parity.spec.ts',
    'tests/e2e/chat/mermaid-diagram.spec.ts',
  ]
  const codeHighlightingTests = [
    'tests/unit/scripts/shiki-token-parity.spec.ts',
    'tests/unit/components/prose/CodeStream.spec.ts',
    'tests/unit/components/prose/PreStream.spec.ts',
    'tests/unit/utils/clipboard-html.spec.ts',
    'tests/e2e/chat/code-highlighting.spec.ts',
  ]
  const historyProjectsTests = [
    'tests/unit/components/History/PageShell.spec.ts',
    'tests/unit/components/History/ActionsDropdown.spec.ts',
    'tests/unit/components/History/ChatRow.spec.ts',
    'tests/unit/components/History/ArtifactBadge.spec.ts',
    'tests/integration/api/chats-history-artifact-count.spec.ts',
    'tests/unit/components/Projects/ActionsDropdown.spec.ts',
    'tests/unit/composables/dropdown-placement.spec.ts',
    'tests/unit/composables/history.spec.ts',
    'tests/unit/composables/history-race.spec.ts',
    'tests/unit/composables/history-load-more-race.spec.ts',
    'tests/unit/composables/projects.spec.ts',
    'tests/unit/composables/project-picker.spec.ts',
    'tests/unit/composables/projects-rename.spec.ts',
    'tests/unit/composables/projects-rename-sort.spec.ts',
    'tests/unit/composables/project-chats.spec.ts',
    'tests/unit/components/History/ChatSections.spec.ts',
    'tests/unit/pages/chats-new.spec.ts',
    'tests/unit/pages/chats/history/index.spec.ts',
    'tests/unit/pages/projects-index.spec.ts',
    'tests/unit/pages/chats/projects/[id].spec.ts',
    'tests/unit/utils/date-groups.spec.ts',
    'tests/unit/utils/project-activity.spec.ts',
    'tests/unit/utils/project-instructions.spec.ts',
    'tests/unit/utils/project-memory.spec.ts',
    'tests/unit/utils/project-memory-lease.spec.ts',
    'tests/unit/components/Projects/InstructionsCard.spec.ts',
    'tests/unit/components/Projects/MemoryCard.spec.ts',
    'tests/unit/components/Chat/ProjectInstructions.spec.ts',
    'tests/integration/api/chats-history.spec.ts',
    'tests/integration/api/chats-new.spec.ts',
    'tests/integration/api/projects.spec.ts',
    'tests/integration/api/projects-memory.spec.ts',
    'tests/integration/api/chats-project-instructions.spec.ts',
    'tests/integration/pages/history-cache.spec.ts',
    'tests/e2e/history/dropdown-touch.spec.ts',
    'tests/e2e/projects/picker.spec.ts',
    'tests/e2e/search/pin.spec.ts',
  ]

  const contextMenuTests = [
    'tests/unit/components/Chat/ContextMenu.client.spec.ts',
    'tests/unit/components/Chat/Message.spec.ts',
    'tests/e2e/chat/context-menu.spec.ts',
    'tests/e2e/chat/context-menu-image.spec.ts',
    'tests/e2e/chat/context-menu-image-desktop.spec.ts',
    'tests/e2e/shared/context-menu-clipping.spec.ts',
    'tests/e2e/shared/context-menu-image-hover.spec.ts',
    'tests/unit/utils/markdown-plain.spec.ts',
    'tests/unit/utils/clipboard-html.spec.ts',
  ]

  const messageUsageTests = [
    'tests/unit/utils/message-format.spec.ts',
    'tests/unit/utils/message-metadata.spec.ts',
    'tests/unit/utils/message-usage.spec.ts',
    'tests/unit/utils/cost-map.spec.ts',
    'tests/unit/utils/google-search-cost.spec.ts',
    'tests/unit/utils/web-search-cost.spec.ts',
    'tests/unit/utils/search-usage.spec.ts',
    'tests/unit/components/Chat/ContextMenu.client.spec.ts',
    'tests/unit/utils/markdown-plain.spec.ts',
  ]

  const gatewaySharedTests = [
    'tests/unit/utils/message-metadata.spec.ts',
    'tests/unit/utils/provider-meta.spec.ts',
    'tests/unit/utils/gateways.spec.ts',
    'tests/unit/composables/model.spec.ts',
    'tests/unit/utils/message-usage.spec.ts',
    'tests/unit/utils/gateway-capabilities.spec.ts',
    'tests/unit/utils/gateway-model-id.spec.ts',
    'tests/unit/utils/gateway-pricing.spec.ts',
  ]

  const modelTurnsTests = [
    'tests/integration/server/model-turns.spec.ts',
    'tests/integration/api/chats-google-leading-assistant-placeholder.spec.ts',
    'tests/integration/api/chats-model-context-real-sanitizer.spec.ts',
  ]

  const gatewayChatTests = [
    'tests/integration/api/chats-gateway.spec.ts',
    'tests/integration/api/chats-gateway-images.spec.ts',
    'tests/integration/api/chats-title.spec.ts',
  ]

  const gatewayCatalogTests = [
    'tests/unit/utils/gateways/vercel.spec.ts',
    'tests/unit/utils/gateways/openrouter.spec.ts',
    'tests/unit/utils/gateways/cloudflare.spec.ts',
    'tests/unit/utils/gateways/index.spec.ts',
    'tests/unit/utils/gateway-catalog-normalize.spec.ts',
    'tests/integration/api/gateways-models.spec.ts',
    'tests/unit/composables/gateway-catalog.spec.ts',
    'tests/integration/api/chats-cloudflare-search-answer.spec.ts',
  ]

  const chatShareTests = [
    'tests/integration/server/chat-share.spec.ts',
    'tests/integration/server/rewrite-share-file-urls.spec.ts',
    'tests/integration/api/chats-shares-branch.spec.ts',
    'tests/integration/api/chats-shares-handoff.spec.ts',
    'tests/integration/api/chats-share-create.spec.ts',
    'tests/integration/api/chats-share-check.spec.ts',
    'tests/unit/utils/chats/share-pii-check.spec.ts',
    'tests/unit/utils/share-pii.spec.ts',
    'tests/integration/api/chats-share-revoke.spec.ts',
    'tests/integration/api/chats-share-reshare-slug.spec.ts',
    'tests/integration/api/shared-chat-view.spec.ts',
    'tests/integration/api/shared-chat-avatar.spec.ts',
    'tests/unit/composables/chat-share.spec.ts',
    'tests/unit/components/Chat/ShareModal.client.spec.ts',
    'tests/unit/composables/ios-in-app-browser.spec.ts',
    'tests/unit/utils/og-description.spec.ts',
    'tests/e2e/shared/context-menu-clipping.spec.ts',
  ]

  const cookieConsentTests = [
    'tests/unit/composables/preference-storage.spec.ts',
    'tests/unit/components/Cookies/Banner.client.spec.ts',
    'tests/unit/components/Cookies/Choices.spec.ts',
    'tests/unit/components/Cookies/RememberPrompt.client.spec.ts',
    'tests/unit/components/LandingFooter.spec.ts',
    'tests/unit/utils/consents.spec.ts',
    'tests/unit/utils/consents-rate-limit.spec.ts',
    'tests/unit/utils/consents-db.spec.ts',
    'tests/unit/utils/auth.spec.ts',
    'tests/unit/config/cookie-consent.spec.ts',
    'tests/unit/composables/auth-last-login-method.spec.ts',
    'tests/unit/composables/notification-prompt.spec.ts',
    'tests/unit/composables/theme-toggle.spec.ts',
    'tests/unit/plugins/cloudflare-web-analytics.client.spec.ts',
    'tests/unit/plugins/cookie-consent-gate.client.spec.ts',
    'modules/cookie-consent/test/cleanup.spec.ts',
    'modules/cookie-consent/test/consent-plugin.spec.ts',
    'modules/cookie-consent/test/consent.spec.ts',
    'modules/cookie-consent/test/focus-trap.spec.ts',
    'modules/cookie-consent/test/ui.spec.ts',
    'tests/integration/api/consents.spec.ts',
    'tests/e2e/cookies/consent.spec.ts',
    'tests/e2e/settings/theme.spec.ts',
  ]

  const sessionRecoveryTests = [
    'tests/unit/composables/auth.spec.ts',
    'tests/unit/composables/chat-draft.spec.ts',
    'tests/unit/pages/chats-new.spec.ts',
    'tests/unit/plugins/session-revalidate.client.spec.ts',
  ]

  const accountDeletionTests = [
    'tests/unit/utils/account/purge-user-data.spec.ts',
    'tests/unit/utils/account/purge-feature-access.spec.ts',
    'tests/unit/utils/account/security-emails.spec.ts',
    'tests/unit/utils/auth.spec.ts',
    'tests/unit/composables/auth.spec.ts',
    'tests/unit/pages/profile/security.spec.ts',
  ]

  const featureAccessTests = [
    'tests/unit/composables/features.spec.ts',
    'tests/unit/plugins/features.spec.ts',
    'tests/unit/server/api/v1/features/index.get.spec.ts',
    'tests/unit/server/utils/db/features-schema.spec.ts',
    'tests/unit/server/utils/features/evaluate.spec.ts',
    'tests/unit/server/utils/features/evaluate-bindings.spec.ts',
    'tests/unit/server/utils/features/evaluate-variants.spec.ts',
    'tests/unit/server/utils/features/exposure.spec.ts',
    'tests/unit/server/utils/features/guards.spec.ts',
    'tests/unit/server/utils/features/background.spec.ts',
    'tests/unit/utils/features/registry.spec.ts',
    'tests/unit/utils/features/skills-registry.spec.ts',
    'tests/unit/utils/features/rollout-gate.spec.ts',
    'tests/unit/utils/features/schedule-schemas.spec.ts',
    'tests/unit/server/utils/features/schedules.spec.ts',
    'tests/unit/server/utils/features/schedule-notify.spec.ts',
    'tests/unit/utils/account/purge-feature-access.spec.ts',
    'tests/unit/utils/account/purge-user-data.spec.ts',
    'tests/integration/api/profiles-features.spec.ts',
    'tests/unit/pages/profile/labs.spec.ts',
    'tests/unit/server/mcp/tools/list-my-features.spec.ts',
    'tests/unit/server/mcp/tools/list-feature-flags.spec.ts',
    'tests/unit/server/mcp/tools/list-feature-access.spec.ts',
    'tests/unit/server/mcp/tools/set-feature-access.spec.ts',
    'tests/unit/server/utils/mcp/private/features.spec.ts',
    'tests/unit/server/utils/mcp/admin-scopes.spec.ts',
    'tests/unit/server/utils/mcp/tool-scopes.spec.ts',
    'tests/unit/utils/auth-oauth.spec.ts',
    'tests/integration/api/profiles-connected-apps-consent.spec.ts',
    'tests/unit/components/OAuth/ScopePicker.spec.ts',
    'tests/unit/components/OAuth/ScopeLabel.spec.ts',
  ]

  const featureLabsTests = [
    'tests/integration/api/profiles-features.spec.ts',
    'tests/unit/pages/profile/labs.spec.ts',
    'tests/unit/composables/feature-opt-in.spec.ts',
    'tests/unit/utils/labs.spec.ts',
    'tests/unit/server/utils/features/opt-ins.spec.ts',
    'tests/unit/utils/features/registry.spec.ts',
    'tests/unit/layouts/profile.spec.ts',
    'tests/unit/components/Search/Modal.spec.ts',
  ]

  const featureAdminTests = [
    'tests/unit/server/utils/features/admin.spec.ts',
    'tests/integration/api/admin-features.spec.ts',
    'tests/integration/server/feature-audit-sweep-plugin.spec.ts',
    'tests/integration/server/feature-schedule-applier-plugin.spec.ts',
    'tests/unit/server/utils/features/schedules.spec.ts',
    'tests/unit/server/utils/features/schedule-notify.spec.ts',
    'tests/unit/utils/features/schedule-schemas.spec.ts',
    'tests/unit/utils/features/rollout-gate.spec.ts',
    'tests/unit/components/Admin/FeatureSchedules.spec.ts',
    'tests/unit/pages/admin/features/[flag].spec.ts',
    'tests/unit/utils/admin-features.spec.ts',
    'tests/unit/components/Search/Modal.spec.ts',
    'tests/unit/config/seo.spec.ts',
    'tests/e2e/admin-features.spec.ts',
  ]

  const capabilityContractTests = [
    'tests/unit/server/capabilities/conformance.spec.ts',
    'tests/unit/server/utils/platform/blob-store.spec.ts',
  ]

  const accountSecurityHubTests = [
    'tests/unit/pages/profile/security.spec.ts',
    'tests/unit/components/Profile/Security/LinkedAccounts.spec.ts',
    'tests/unit/components/Profile/Security/Sessions.spec.ts',
    'tests/unit/components/Profile/Security/Passkeys.spec.ts',
    'tests/integration/api/profiles-sessions.spec.ts',
  ]

  const localDateTests = [
    'tests/unit/components/ui/LocalDate.spec.ts',
    'tests/unit/utils/local-date.spec.ts',
    'tests/unit/components/Profile/Security/Sessions.spec.ts',
    'tests/unit/components/Profile/Security/LinkedAccounts.spec.ts',
    'tests/unit/components/Profile/Security/Passkeys.spec.ts',
  ]

  const projectKnowledgeClientTests = [
    'tests/unit/workers/knowledge-extract.spec.ts',
    'tests/unit/utils/knowledge-html-to-markdown.spec.ts',
    'tests/unit/utils/knowledge-upload-plan.spec.ts',
    'tests/unit/utils/knowledge-folder.spec.ts',
    'tests/unit/utils/knowledge-title.spec.ts',
    'tests/unit/utils/knowledge-zip.spec.ts',
    'tests/unit/utils/project-knowledge-ui.spec.ts',
    'tests/unit/utils/reasoning.spec.ts',
    'tests/unit/composables/knowledge-extract.spec.ts',
    'tests/unit/composables/project-knowledge.spec.ts',
    'tests/unit/composables/knowledge-upload.spec.ts',
    'tests/unit/composables/project-knowledge-model.spec.ts',
    'tests/unit/composables/project-knowledge-folders.spec.ts',
    'tests/unit/components/Profile/Memory/CacheInfo.spec.ts',
    'tests/unit/components/Projects/Knowledge/Panel.spec.ts',
    'tests/unit/components/Projects/Knowledge/Item.spec.ts',
    'tests/unit/components/Projects/Knowledge/ItemList.spec.ts',
    'tests/unit/components/Projects/Knowledge/ItemEditSheet.spec.ts',
    'tests/unit/components/Projects/Knowledge/NoteEditor.spec.ts',
    'tests/unit/components/Projects/Knowledge/UploadSheet.spec.ts',
    'tests/unit/components/Projects/Knowledge/LibraryPicker.spec.ts',
    'tests/unit/components/Projects/Knowledge/ModeSelector.spec.ts',
    'tests/unit/components/Projects/Knowledge/CapacityMeter.spec.ts',
    'tests/unit/components/Projects/Knowledge/Menu.spec.ts',
  ]

  const memoryTabTests = [
    'tests/unit/pages/profile/memory.spec.ts',
    'tests/unit/components/Profile/Memory/ModelPicker.spec.ts',
    'tests/unit/components/Profile/Memory/Controls.spec.ts',
    'tests/unit/components/Profile/Memory/NeverKept.spec.ts',
    'tests/unit/components/Profile/Memory/Entries/Essentials.spec.ts',
    'tests/unit/components/Profile/Memory/Entries/BackfillSheet.spec.ts',
    'tests/e2e/profile/dark-touch-hover-contrast.spec.ts',
    'tests/unit/components/Profile/Memory/Entries/ImportSheet.spec.ts',
    'tests/unit/components/Profile/Memory/CacheInfo.spec.ts',
    'tests/unit/components/Profile/Memory/ExtraChecks.spec.ts',
    'tests/unit/composables/memory-backfill.spec.ts',
    'tests/unit/utils/memory-backfill.spec.ts',
    'tests/unit/utils/memory-legacy-about-me.spec.ts',
    'tests/unit/utils/memory-about-me.spec.ts',
    'tests/unit/utils/prompt-cache-estimate.spec.ts',
    'tests/unit/utils/memory-index-estimate.spec.ts',
    'tests/unit/utils/memory-recommended-models.spec.ts',
    'tests/unit/components/Profile/Memory/Models.spec.ts',
    'tests/unit/components/Profile/Memory/Entries.spec.ts',
    'tests/unit/components/Profile/Memory/Entries/DetailModal.spec.ts',
    'tests/unit/components/Profile/Memory/Entries/Empty.spec.ts',
    'tests/unit/components/Profile/Memory/Entries/Group.spec.ts',
    'tests/unit/components/Profile/Memory/Entries/Row.spec.ts',
    'tests/unit/components/Profile/Memory/Entries/Project.spec.ts',
    'tests/unit/components/Profile/Memory/Entries/Projects.spec.ts',
    'tests/unit/components/Profile/Memory/Entries/Toolbar.spec.ts',
    'tests/unit/composables/memory-settings.spec.ts',
    'tests/unit/composables/memory-projects.spec.ts',
    'tests/unit/utils/memory-entry-labels.spec.ts',
    'tests/unit/utils/memory-model-filter.spec.ts',
    'tests/unit/layouts/profile.spec.ts',
    'tests/unit/components/Projects/MemoryCard.spec.ts',
    'tests/unit/components/Profile/Memory/Instruct/Box.spec.ts',
    'tests/unit/components/Profile/Memory/Instruct/Preview.spec.ts',
  ]

  const accountEmailPasswordTests = [
    'tests/unit/pages/profile/email.spec.ts',
    'tests/unit/pages/profile/password.spec.ts',
  ]

  const twoFactorTests = [
    'tests/unit/components/ui/Form/Otp.spec.ts',
    'tests/unit/pages/(auth)/2fa.spec.ts',
    'tests/unit/pages/(auth)/signin.spec.ts',
    'tests/e2e/auth/signin.spec.ts',
    'tests/unit/components/Profile/Security/TwoFactor.spec.ts',
    'tests/unit/components/Profile/Security/BackupCodes.spec.ts',
    'tests/unit/components/Profile/Security/Passkeys.spec.ts',
    'tests/unit/pages/profile/security.spec.ts',
    'tests/unit/utils/qr-code.spec.ts',
    'tests/unit/utils/webauthn.spec.ts',
  ]

  const landingTests = [
    'tests/unit/utils/landing-video-range.spec.ts',
    'tests/unit/server/routes/videos/[name].spec.ts',
    'tests/unit/utils/video.spec.ts',
    'tests/unit/utils/landing/stats.spec.ts',
    'tests/unit/utils/landing/analytics-events.spec.ts',
    'tests/unit/utils/landing/client-events.spec.ts',
    'tests/unit/composables/video-watch-analytics.spec.ts',
    'tests/unit/components/landing/StatCard.spec.ts',
    'tests/unit/components/landing/StatGrid.spec.ts',
    'tests/unit/components/landing/VideoPlayer.client.spec.ts',
    'tests/unit/assets/css/video-player-theme.spec.ts',
    'tests/unit/components/Video/Shell.spec.ts',
    'tests/unit/composables/video-timeline.spec.ts',
    'tests/unit/composables/video-player-preferences.spec.ts',
    'tests/unit/composables/video-speed.spec.ts',
    'tests/unit/composables/video-quality.spec.ts',
    'tests/unit/plugins/video-legacy-plyr-cleanup.client.spec.ts',
    'tests/unit/components/landing/CtaButtons.spec.ts',
    'tests/unit/components/landing/FeatureGrid.spec.ts',
    'tests/unit/components/landing/MessageBubble.spec.ts',
    'tests/unit/components/landing/Carousel.spec.ts',
    'tests/unit/components/landing/FaqAccordion.spec.ts',
    'tests/unit/components/content/HomeStats.spec.ts',
    'tests/unit/components/content/HomeVideo.spec.ts',
    'tests/unit/components/content/HomeBubble.spec.ts',
    'tests/unit/components/content/HomeComparison.spec.ts',
    'tests/integration/api/events-ingest.spec.ts',
    'tests/integration/api/stats.spec.ts',
    'tests/integration/server/landing-cache-refresh.spec.ts',
    'tests/integration/server/landing-stats.spec.ts',
  ]

  const utmAttributionTests = [
    'tests/unit/utils/utm.spec.ts',
    'tests/unit/utils/analytics/activation.spec.ts',
    'tests/unit/utils/analytics/chat-activation.spec.ts',
    'tests/unit/utils/landing/analytics-events.spec.ts',
    'tests/unit/utils/auth.spec.ts',
    'tests/unit/composables/utm-attribution.spec.ts',
    'tests/unit/composables/landing-analytics.spec.ts',
    'tests/unit/composables/key-guide-analytics.spec.ts',
    'tests/unit/composables/video-watch-analytics.spec.ts',
    'tests/unit/utils/analytics/key-events.spec.ts',
    'tests/unit/utils/landing/client-events.spec.ts',
    'tests/integration/api/events-ingest.spec.ts',
    'tests/integration/api/chats-message-id-stream.spec.ts',
    'tests/integration/api/profile-keys-qwen.spec.ts',
    'tests/integration/api/profile-keys-cloudflare-gateway.spec.ts',
    'tests/integration/api/profile-keys-vercel-gateway.spec.ts',
    'tests/integration/api/profile-keys-openrouter.spec.ts',
    'tests/integration/api/profile-keys-key-events.spec.ts',
    'tests/e2e/attribution/utm-signup.spec.ts',
  ]

  const authNextRedirectTests = [
    'tests/unit/utils/auth-redirect.spec.ts',
    'tests/unit/middleware/00.auth.global.spec.ts',
    'tests/unit/pages/(auth)/signin.spec.ts',
    'tests/unit/pages/(auth)/signup.spec.ts',
    'tests/unit/pages/(auth)/2fa.spec.ts',
    'tests/unit/pages/profile/keys.spec.ts',
    'tests/unit/pages/guides/[slug].spec.ts',
  ]

  const keyGuideTests = [
    'tests/unit/components/content/KeyGuideArticle.spec.ts',
    'tests/unit/utils/external-url.spec.ts',
    'tests/unit/utils/iso-datetime.spec.ts',
    'tests/unit/utils/video.spec.ts',
    'tests/unit/components/landing/VideoPlayer.client.spec.ts',
    'tests/unit/pages/guides/[slug].spec.ts',
    'tests/unit/utils/landing-jsonld.spec.ts',
    'tests/unit/utils/auth-redirect.spec.ts',
    'tests/unit/components/LandingFooter.spec.ts',
    'tests/unit/config/seo-pages.spec.ts',
    'tests/unit/content/key-guides.spec.ts',
  ]

  const pushNotificationTests = [
    'tests/unit/composables/push-notifications.spec.ts',
    'tests/unit/composables/notification-prompt.spec.ts',
    'tests/unit/utils/push.spec.ts',
    'tests/unit/utils/push-encryption.spec.ts',
    'tests/unit/service-worker/push.spec.ts',
    'tests/unit/service-worker/sw.spec.ts',
    'tests/unit/plugins/push-navigation.client.spec.ts',
    'tests/unit/service-worker/internal-navigation.spec.ts',
    'tests/e2e/push/navigation-handoff.spec.ts',
    'tests/unit/utils/cross-site-guard.spec.ts',
    'tests/integration/api/push-subscriptions.spec.ts',
    'tests/integration/api/push-status.spec.ts',
    'tests/integration/server/push-subscription-sweep-plugin.spec.ts',
    'tests/integration/api/chats-message-id-stream.spec.ts',
    'tests/unit/pages/chats-new.spec.ts',
    'tests/unit/layouts/chat.spec.ts',
    'tests/unit/components/Sidebar/PushToggle.spec.ts',
    'tests/unit/components/Sidebar/AuthCta.spec.ts',
    'tests/unit/composables/push-toggle.spec.ts',
    'tests/unit/pages/profile/preferences.spec.ts',
    'tests/unit/components/ui/Alert.spec.ts',
  ]

  const emailTests = [
    'tests/integration/server/email.spec.ts',
    'tests/integration/server/email-templates.spec.ts',
    'tests/unit/utils/email-template.spec.ts',
  ]

  const legalAdminTests = [
    'tests/unit/server/utils/legal/admin.spec.ts',
    'tests/unit/server/utils/legal/consent-version.spec.ts',
    'tests/unit/server/utils/legal/purge.spec.ts',
    'tests/unit/utils/legal/notice-sweep.spec.ts',
    'tests/unit/db/legal-approvals-migration.spec.ts',
    'tests/unit/pages/admin/legal.spec.ts',
    'tests/integration/api/admin-legal.spec.ts',
    'tests/integration/api/admin-features.spec.ts',
    'tests/unit/utils/account/purge-user-data.spec.ts',
  ]

  const legalNoticeEmailTests = [
    'tests/unit/utils/legal/notice-sweep.spec.ts',
    'tests/unit/utils/legal/notice-email.spec.ts',
    'tests/integration/server/legal-notice-sweep-plugin.spec.ts',
    'tests/integration/server/email-templates.spec.ts',
    'tests/integration/server/email.spec.ts',
    'tests/unit/utils/email-template.spec.ts',
    'tests/unit/content/account-email-list.spec.ts',
  ]

  const authSecurityTests = [
    'tests/unit/utils/auth-rate-limit.spec.ts',
    'tests/unit/utils/auth-rate-limit-kv-errors.spec.ts',
    'tests/unit/utils/auth-init.spec.ts',
    'tests/unit/server/utils/auth-instance.spec.ts',
    'tests/unit/server/middleware/evlog-auth.spec.ts',
    'tests/integration/server/session.spec.ts',
    'tests/unit/utils/auth-captcha.spec.ts',
    'tests/unit/utils/auth-captcha-plugin.spec.ts',
    'tests/unit/utils/auth-hosts.spec.ts',
    'tests/unit/utils/auth-secondary-storage.spec.ts',
    'tests/unit/server/auth/session-database-fallback.spec.ts',
    'tests/unit/db/accounts-provider-account-id.spec.ts',
  ]

  const keysApiTests = [
    'tests/unit/server/utils/keys-rate-limit.spec.ts',
    'tests/integration/api/profile-keys-qwen.spec.ts',
    'tests/integration/api/profile-keys-brave.spec.ts',
    'tests/integration/api/profile-keys-exa.spec.ts',
    'tests/integration/api/profile-keys-typesafe.spec.ts',
    'tests/integration/api/profile-keys-summary.spec.ts',
    'tests/integration/api/profile-keys-cloudflare-gateway.spec.ts',
    'tests/integration/api/profile-keys-vercel-gateway.spec.ts',
    'tests/integration/api/profile-keys-openrouter.spec.ts',
    'tests/integration/api/profile-keys-key-events.spec.ts',
    'tests/unit/utils/analytics/key-events.spec.ts',
    'tests/unit/components/Profile/Keys/Card.spec.ts',
    'tests/unit/components/Profile/Keys/ProviderKeyCard.spec.ts',
    'tests/unit/components/Profile/Keys/CloudflareGateway.spec.ts',
    'tests/unit/components/Profile/Keys/SearchProvidersInfo.spec.ts',
    'tests/unit/components/Profile/Keys/MemoryChecksInfo.spec.ts',
    'tests/unit/components/Profile/Keys/GatewaysInfo.spec.ts',
    'tests/unit/components/Profile/Keys/Guide.spec.ts',
    'tests/unit/components/Profile/Keys/GuideVideo.client.spec.ts',
    'tests/unit/components/content/KeyGuideArticle.spec.ts',
    'tests/unit/pages/profile/keys.spec.ts',
    'tests/unit/components/ProviderIcon.spec.ts',
    'tests/unit/utils/provider-meta.spec.ts',
    'tests/e2e/profile/key-guides.spec.ts',
  ]
  const profileKeyGuideTests = [
    'tests/unit/content/key-guides.spec.ts',
    'tests/unit/components/content/KeyGuideArticle.spec.ts',
    'tests/unit/utils/iso-datetime.spec.ts',
    'tests/unit/config/content-frontmatter.spec.ts',
    'tests/unit/pages/guides/[slug].spec.ts',
    'tests/unit/composables/key-guide-analytics.spec.ts',
    'tests/unit/composables/video-watch-analytics.spec.ts',
    'tests/unit/composables/video-timeline.spec.ts',
    'tests/unit/components/Video/Shell.spec.ts',
    'tests/unit/composables/video-speed.spec.ts',
    'tests/unit/composables/video-quality.spec.ts',
    'tests/unit/assets/css/video-player-theme.spec.ts',
    'tests/unit/utils/key-guide-video.spec.ts',
    'tests/unit/components/Profile/Keys/Guide.spec.ts',
    'tests/unit/components/Profile/Keys/GuideVideo.client.spec.ts',
    'tests/unit/components/Profile/Keys/ProviderKeyCard.spec.ts',
    'tests/unit/components/Profile/Keys/CloudflareGateway.spec.ts',
    'tests/unit/pages/profile/keys.spec.ts',
    'tests/unit/server/routes/videos/[name].spec.ts',
    'tests/integration/api/events-ingest.spec.ts',
    'tests/e2e/profile/key-guides.spec.ts',
  ]

  const turnstileTests = [
    'tests/unit/composables/turnstile.spec.ts',
    'tests/unit/components/Auth/Turnstile.client.spec.ts',
    'tests/unit/components/Auth/OAuthNotice.spec.ts',
    'tests/unit/components/Auth/CheckEmail.spec.ts',
    'tests/unit/composables/captcha.spec.ts',
    'tests/unit/pages/(auth)/signin.spec.ts',
    'tests/unit/pages/(auth)/signup.spec.ts',
    'tests/unit/pages/(auth)/reset-password.spec.ts',
  ]

  const postAuthRedirectTests = [
    'tests/unit/utils/auth-redirect.spec.ts',
    'tests/unit/middleware/00.auth.global.spec.ts',
    'tests/unit/composables/social-oauth.spec.ts',
    'tests/unit/pages/(auth)/signin.spec.ts',
    'tests/unit/pages/(auth)/signup.spec.ts',
    'tests/unit/pages/(auth)/2fa.spec.ts',
    'tests/e2e/auth/signin.spec.ts',
  ]

  const connectorsSafeFetchTests = [
    'tests/unit/utils/connectors-policy.spec.ts',
    'tests/unit/server/utils/connectors/add.spec.ts',
    'tests/unit/server/utils/net/safe-url.spec.ts',
    'tests/unit/server/utils/net/safe-fetch.spec.ts',
    'tests/unit/server/utils/skills/import/github-safe-url-gate.spec.ts',
    'tests/unit/server/utils/skills/import/github.spec.ts',
    'tests/unit/server/utils/skills/import/github-resolve.spec.ts',
  ]

  const googleContractsTests = [
    'tests/unit/utils/google-scopes.spec.ts',
    'tests/unit/utils/google-data-policy.spec.ts',
  ]

  const googleSchemaTests = [
    'tests/unit/server/utils/db/google-schema.spec.ts',
    'tests/unit/utils/account/purge-google-connections.spec.ts',
    'tests/unit/utils/account/purge-user-data.spec.ts',
  ]

  const googleConnectionsTests = [
    'tests/unit/server/utils/google/http.spec.ts',
    'tests/unit/server/utils/google/oauth.spec.ts',
    'tests/unit/server/utils/google/oauth-state.spec.ts',
    'tests/unit/server/utils/google/token-boundary.spec.ts',
    'tests/integration/server/google-tokens.spec.ts',
    'tests/integration/server/google-access-ended.spec.ts',
    'tests/integration/server/google-access-sweep-plugin.spec.ts',
    'tests/integration/api/google-connections.spec.ts',
    'tests/unit/utils/account/purge-google-connections.spec.ts',
    'tests/unit/utils/account/purge-user-data.spec.ts',
    'tests/unit/utils/features/registry.spec.ts',
    'tests/unit/utils/auth-redirect.spec.ts',
    'tests/unit/server/plugins/evlog-request-observability.spec.ts',
    'tests/unit/server/routes/waf-blocked-paths.spec.ts',
    'tests/unit/components/Profile/Google/Connection.spec.ts',
    'tests/unit/pages/profile/keys.spec.ts',
    'tests/unit/server/utils/files/derived-keys-delete-sites.spec.ts',
    'tests/unit/composables/google-connection.spec.ts',
    'tests/unit/utils/auth-oauth.spec.ts',
  ]

  const googleByoClientTests = [
    'tests/unit/utils/google-byo.spec.ts',
    'tests/unit/server/utils/google/oauth.spec.ts',
    'tests/unit/server/utils/google/token-boundary.spec.ts',
    'tests/integration/api/google-byo.spec.ts',
    'tests/integration/api/google-connections.spec.ts',
    'tests/integration/server/google-tokens.spec.ts',
    'tests/integration/server/google-access-ended.spec.ts',
    'tests/unit/components/Profile/Google/OwnClient.spec.ts',
    'tests/unit/components/Profile/Google/Connection.spec.ts',
    'tests/unit/pages/profile/keys.spec.ts',
    'tests/unit/utils/features/registry.spec.ts',
    'tests/unit/server/plugins/evlog-request-observability.spec.ts',
    'tests/unit/server/routes/waf-blocked-paths.spec.ts',
    'tests/unit/composables/user-keys.spec.ts',
    'tests/integration/server/google-access-sweep-plugin.spec.ts',
    'tests/integration/api/profiles-features.spec.ts',
  ]

  const connectorsStorageTests = [
    'tests/unit/utils/connectors-policy.spec.ts',
    'tests/unit/utils/connectors-slug.spec.ts',
    'tests/unit/utils/connectors-connected.spec.ts',
    'tests/unit/utils/features/connectors-registry.spec.ts',
    'tests/unit/config/connectors-catalog.spec.ts',
    'tests/unit/scripts/check-connector-presets.spec.ts',
    'tests/unit/server/utils/connectors/store.spec.ts',
    'tests/unit/server/utils/connectors/cleanup.spec.ts',
    'tests/unit/utils/account/purge-user-data.spec.ts',
    'tests/unit/server/utils/chats/lifecycle.spec.ts',
    'tests/integration/api/chats-history.spec.ts',
  ]

  const connectorsRegistryTests = [
    'tests/unit/utils/connectors-policy.spec.ts',
    'tests/unit/utils/features/connectors-registry.spec.ts',
    'tests/unit/server/utils/connectors/registry-entry.spec.ts',
    'tests/unit/server/utils/connectors/registry-sync.spec.ts',
    'tests/integration/server/mcp-registry-sync-plugin.spec.ts',
    'tests/integration/api/connectors-registry.spec.ts',
    'tests/integration/api/connectors-registry-icon.spec.ts',
    'tests/integration/api/admin-connectors-registry.spec.ts',
    'tests/unit/server/utils/connectors/registry-sync-now.spec.ts',
    'tests/unit/utils/connectors-publisher.spec.ts',
    'tests/unit/utils/connectors-directory.spec.ts',
    'tests/unit/server/utils/connectors/registry-probe.spec.ts',
    'tests/integration/api/connectors-registry-directory.spec.ts',
    'tests/unit/config/wrangler-registry-cron.spec.ts',
    'tests/unit/server/utils/net/safe-fetch.spec.ts',
  ]

  const connectorsOAuthTests = [
    'tests/unit/server/utils/connectors/add.spec.ts',
    'tests/unit/server/utils/connectors/credentials.spec.ts',
    'tests/unit/server/utils/connectors/oauth-client.spec.ts',
    'tests/unit/server/utils/connectors/oauth-metadata.spec.ts',
    'tests/unit/server/utils/connectors/oauth-state.spec.ts',
    'tests/unit/server/utils/connectors/revoke.spec.ts',
    'tests/unit/server/utils/connectors/scopes.spec.ts',
    'tests/unit/server/utils/connectors/store-tokens.spec.ts',
    'tests/unit/server/routes/connectors/client-metadata.spec.ts',
    'tests/unit/server/utils/request-public-origin.spec.ts',
    'tests/unit/server/plugins/evlog-request-observability.spec.ts',
    'tests/unit/utils/account/purge-user-data.spec.ts',
    'tests/integration/api/connectors-oauth-flow.spec.ts',
  ]

  const connectorsChatToolsTests = [
    'tests/unit/server/utils/ai/tool-index-prefetch.spec.ts',
    'tests/unit/server/utils/ai/anthropic-thinking-binding.spec.ts',
    'tests/unit/server/utils/connectors/send-tools.spec.ts',
    'tests/unit/server/utils/ai/tool-index.spec.ts',
    'tests/integration/api/chats-besidka-tools.spec.ts',
    'tests/integration/api/connectors-page.spec.ts',
    'tests/unit/config/mcp-surface.spec.ts',
    'tests/unit/server/utils/connectors/tool-definitions.spec.ts',
    'tests/unit/server/utils/connectors/tool-images.spec.ts',
    'tests/unit/server/utils/connectors/tool-images-providers.spec.ts',
    'tests/unit/server/utils/connectors/image-saver.spec.ts',
    'tests/unit/server/utils/connectors/image-parts-stream.spec.ts',
    'tests/unit/server/utils/connectors/kept-images.spec.ts',
    'tests/unit/server/utils/files/connector-images.spec.ts',
    'tests/unit/utils/connector-image-parts.spec.ts',
    'tests/integration/server/chat-deletion-cleanup.spec.ts',
    'tests/unit/server/utils/tool-approval/continuation.spec.ts',
    'tests/integration/api/chats-tool-approval-continuation.spec.ts',
    'tests/unit/server/utils/connectors/mcp-client.spec.ts',
    'tests/unit/server/utils/connectors/audit.spec.ts',
    'tests/unit/server/utils/connectors/call-limits.spec.ts',
    'tests/unit/server/utils/connectors/chat-selection.spec.ts',
    'tests/unit/server/utils/connectors/persist.spec.ts',
    'tests/unit/server/utils/connectors/call-errors.spec.ts',
    'tests/unit/utils/connectors-errors.spec.ts',
    'tests/unit/server/utils/connectors/context-isolation.spec.ts',
    'tests/unit/server/utils/connectors/persistence-pipeline.spec.ts',
    'tests/unit/server/utils/chats/share-used-connector.spec.ts',
    'tests/unit/utils/ai/search-answer-continuation.spec.ts',
    'tests/unit/server/utils/chats/share-public-parts.spec.ts',
    'tests/unit/utils/ai/tool-loop.spec.ts',
    'tests/unit/utils/memory/extract-input.spec.ts',
    'tests/unit/utils/connectors-parts.spec.ts',
    'tests/unit/utils/connector-step.spec.ts',
    'tests/unit/utils/chat-input-tiles.spec.ts',
    'tests/unit/server/utils/chats/context/build-chat-context.spec.ts',
    'tests/integration/api/chats-connector-send.spec.ts',
    'tests/integration/api/connectors-chat-selection.spec.ts',
  ]

  const connectorsChatToolsUiTests = [
    'tests/unit/composables/composer-connectors.spec.ts',
    'tests/unit/utils/connector-mention.spec.ts',
    'tests/unit/components/ChatInput/ConnectorSuggestion.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/unit/composables/chat.spec.ts',
    'tests/unit/composables/chat-share.spec.ts',
    'tests/unit/components/Chat/ShareModal.client.spec.ts',
    'tests/unit/components/ChatInput/ConnectorPicker.client.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/Content.spec.ts',
    'tests/unit/components/Chat/Reasoning/ConnectorStep.spec.ts',
    'tests/unit/components/Chat/Reasoning/ConnectorThumbnail.spec.ts',
    'tests/unit/utils/connector-image-parts.spec.ts',
    'tests/unit/utils/connectors-errors.spec.ts',
    'tests/unit/components/Chat/Reasoning.connectors.spec.ts',
    'tests/unit/components/Chat/ConnectorsNotice.spec.ts',
    'tests/unit/components/Chat/ContextPanel.spec.ts',
    'tests/unit/utils/connectors-parts.spec.ts',
    'tests/unit/utils/connector-step.spec.ts',
    'tests/unit/utils/chat-input-tiles.spec.ts',
  ]

  const connectorsPageTests = [
    'tests/unit/utils/connectors-auth.spec.ts',
    'tests/unit/server/utils/connectors/header-auth.spec.ts',
    'tests/integration/api/connectors-page.spec.ts',
    'tests/integration/api/connectors-chat-selection.spec.ts',
    'tests/unit/utils/connectors-messages.spec.ts',
    'tests/unit/utils/connectors-consent-text.spec.ts',
    'tests/unit/composables/connectors.spec.ts',
    'tests/unit/utils/connectors-connected.spec.ts',
    'tests/unit/composables/composer-connectors.spec.ts',
    'tests/unit/pages/chats/connectors/index.spec.ts',
    'tests/unit/pages/profile/connectors.spec.ts',
    'tests/unit/components/History/PageShell.spec.ts',
    'tests/unit/components/Profile/Connectors/AddDialog.client.spec.ts',
    'tests/unit/components/Profile/Connectors/Directory.client.spec.ts',
    'tests/unit/components/Profile/Connectors/DirectoryCard.spec.ts',
    'tests/unit/components/Profile/Connectors/DirectoryDetailPanel.spec.ts',
    'tests/unit/composables/connector-directory.spec.ts',
    'tests/unit/components/Profile/Connectors/Avatar.spec.ts',
    'tests/unit/components/Profile/Connectors/BesidkaRow.spec.ts',
    'tests/unit/composables/feature-opt-in.spec.ts',
    'tests/unit/components/Profile/Connectors/PresetCard.spec.ts',
    'tests/unit/utils/connector-brand-icons.spec.ts',
    'tests/unit/utils/connectors-publisher.spec.ts',
    'tests/unit/components/Profile/Connectors/ConnectDialog.client.spec.ts',
    'tests/unit/components/Profile/Connectors/DetailPanel.spec.ts',
    'tests/unit/layouts/profile.spec.ts',
    'tests/unit/components/Search/Modal.spec.ts',
  ]

  const toolPermissionsUiTests = [
    'tests/unit/components/ui/ToolPermissions.spec.ts',
    'tests/unit/components/ui/ToolPermissions/ModeControl.spec.ts',
    'tests/unit/utils/tool-permissions.spec.ts',
    'tests/unit/utils/besidka-tool-permissions.spec.ts',
    'tests/unit/components/Profile/BesidkaTools/Permissions.spec.ts',
    'tests/unit/components/Profile/Connectors/DetailPanel.spec.ts',
  ]

  const toolApprovalPolicyTests = [
    'tests/unit/utils/tool-approval-policy.spec.ts',
    'tests/unit/server/utils/tool-approval/policy.spec.ts',
    'tests/unit/server/utils/tool-approval/state.spec.ts',
    'tests/unit/server/utils/tool-approval/secret.spec.ts',
    'tests/unit/server/utils/tool-approval/kv.spec.ts',
    'tests/unit/server/utils/tool-approval/claims.spec.ts',
    'tests/unit/server/utils/tool-approval/cleanup.spec.ts',
    'tests/unit/server/utils/hkdf.spec.ts',
    'tests/unit/server/utils/connectors/audit.spec.ts',
    'tests/integration/server/tool-approval-claim-sweep-plugin.spec.ts',
    'tests/integration/server/connector-audit-prune-plugin.spec.ts',
    'tests/unit/utils/account/purge-user-data.spec.ts',
    'tests/unit/server/utils/chats/lifecycle.spec.ts',
    'tests/integration/api/chats-history.spec.ts',
  ]

  const toolApprovalRequestTests = [
    'tests/unit/server/utils/tool-approval/send.spec.ts',
    'tests/unit/utils/tool-approval-parts.spec.ts',
    'tests/integration/api/chats-tool-approval-request.spec.ts',
    'tests/integration/api/chats-connector-send.spec.ts',
    'tests/integration/api/chats-memory.spec.ts',
    'tests/integration/api/chats-project-knowledge.spec.ts',
    'tests/integration/api/chats-artifacts.spec.ts',
    'tests/integration/api/chats-documents.spec.ts',
    'tests/unit/server/utils/connectors/send-tools.spec.ts',
    'tests/unit/server/utils/connectors/audit.spec.ts',
    'tests/unit/server/utils/tool-approval/kv.spec.ts',
    'tests/unit/server/utils/tool-approval/cleanup.spec.ts',
    'tests/unit/server/utils/artifacts/message-parts.spec.ts',
    'tests/unit/server/utils/documents/message-parts.spec.ts',
    'tests/unit/server/utils/chats/persist-user-message.spec.ts',
    'tests/unit/server/utils/chats/share-public-parts.spec.ts',
    'tests/unit/utils/ai/search-answer-continuation.spec.ts',
    'tests/unit/utils/connectors-parts.spec.ts',
    'tests/unit/utils/connector-step.spec.ts',
    'tests/unit/composables/chat.spec.ts',
    'tests/unit/components/Chat/Reasoning.spec.ts',
    'tests/unit/utils/features/tool-approvals-registry.spec.ts',
    'tests/unit/utils/features/registry.spec.ts',
    'tests/unit/utils/memory/tools/memory-tools.spec.ts',
    'tests/unit/utils/knowledge/context.spec.ts',
  ]

  const reasoningStepIconsTests = [
    'tests/unit/utils/reasoning-step-icons.spec.ts',
    'tests/unit/components/Chat/Reasoning/StepIcon.spec.ts',
    'tests/unit/components/Chat/Reasoning.icons.spec.ts',
    'tests/unit/components/Chat/Reasoning.spec.ts',
    'tests/unit/components/Chat/Reasoning.connectors.spec.ts',
    'tests/unit/components/Chat/Reasoning/ApprovalStep.spec.ts',
    'tests/unit/components/Chat/Reasoning/ConnectorStep.spec.ts',
    'tests/unit/components/Chat/Reasoning/MemoryStep.spec.ts',
    'tests/unit/components/Chat/Reasoning/SearchStep.spec.ts',
    'tests/unit/composables/composer-connectors.spec.ts',
    'tests/unit/server/utils/chats/test/reasoning-icons-fixture.spec.ts',
  ]

  const connectorIconTests = [
    'tests/unit/server/utils/connectors/icon.spec.ts',
    'tests/unit/server/utils/connectors/svg-icon.spec.ts',
    'tests/unit/server/utils/connectors/send-tools.spec.ts',
    'tests/unit/server/utils/net/safe-fetch.spec.ts',
    'tests/integration/api/connectors-icon.spec.ts',
    'tests/integration/api/connectors-registry-icon.spec.ts',
    'tests/unit/server/utils/connectors/cleanup.spec.ts',
    'tests/unit/server/utils/connectors/icon-rate-limit.spec.ts',
  ]

  const generationStopTests = [
    'tests/unit/server/utils/chats/generation-lease.spec.ts',
    'tests/unit/server/utils/chats/stream-disconnect.spec.ts',
    'tests/unit/server/utils/chats/stopped-replies.spec.ts',
    'tests/unit/utils/chat-reply-stopped.spec.ts',
    'tests/unit/server/utils/ai/stream-stall.spec.ts',
    'tests/unit/components/Chat/Loader.client.spec.ts',
    'tests/unit/composables/chat.tool-approvals.spec.ts',
    'tests/integration/api/chats-stop.spec.ts',
    'tests/integration/api/chats-message-id-stream.spec.ts',
    'tests/integration/api/chats-stream-lifecycle.spec.ts',
    'tests/unit/composables/chat.recovery.spec.ts',
    'tests/unit/components/Chat/ReplyStopped.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/e2e/chat/stop-retry.spec.ts',
  ]

  const connectorRuntimeTests = [
    'tests/unit/server/utils/ai/stream-stall.spec.ts',
    'tests/unit/server/utils/ai/tool-rounds.spec.ts',
    'tests/unit/server/utils/chats/stream-heartbeat.spec.ts',
    'tests/unit/utils/tool-rounds.spec.ts',
    'tests/unit/composables/tool-rounds.spec.ts',
    'tests/unit/composables/chat.tool-approvals.spec.ts',
    'tests/unit/components/Chat/ToolRounds.spec.ts',
    'tests/unit/server/utils/connectors/call-limits.spec.ts',
    'tests/unit/server/utils/connectors/mcp-client.spec.ts',
    'tests/unit/server/utils/connectors/persist.spec.ts',
    'tests/unit/server/utils/connectors/persistence-pipeline.spec.ts',
    'tests/unit/server/utils/connectors/send-tools.spec.ts',
    'tests/unit/server/utils/tool-approval/send.spec.ts',
    'tests/unit/server/utils/tool-approval/policy.spec.ts',
    'tests/unit/server/utils/tool-approval/continuation.spec.ts',
    'tests/unit/server/utils/besidka-tools/chat-adapter.spec.ts',
    'tests/unit/server/utils/besidka-tools/permissions.spec.ts',
    'tests/integration/api/chats-tool-approval-continuation.spec.ts',
    'tests/integration/api/chats-tool-approval-request.spec.ts',
    'tests/integration/api/chats-besidka-tools.spec.ts',
    'tests/integration/api/connectors-page.spec.ts',
    'tests/integration/api/besidka-tools-permissions.spec.ts',
  ]

  const toolApprovalSpikeTests = [
    'tests/integration/api/tool-approval-spike.spec.ts',
  ]

  const googleDataGuardTests = [
    'tests/unit/utils/google-data-recipient.spec.ts',
    'tests/unit/utils/google-data-policy.spec.ts',
    'tests/unit/server/utils/google/data-guard.spec.ts',
    'tests/unit/server/utils/google/send-flag.spec.ts',
    'tests/unit/server/utils/google/marked-origin.spec.ts',
    'tests/integration/api/chats-research-start.spec.ts',
    'tests/unit/server/utils/files/file-share-access.spec.ts',
    'tests/integration/api/chats-share-reshare-slug.spec.ts',
    'tests/unit/utils/gateways/google-data-safeguards.spec.ts',
    'tests/unit/utils/gateways/index.spec.ts',
    'tests/integration/api/chats-gateway.spec.ts',
    'tests/integration/api/chats-google-data-guard.spec.ts',
    'tests/integration/api/chats-share-google-data.spec.ts',
    'tests/integration/api/google-data-guard-routes.spec.ts',
    'tests/integration/api/artifact-complete.spec.ts',
    'tests/integration/api/profile-keys-summary.spec.ts',
    'tests/integration/server/chat-share.spec.ts',
    'tests/unit/server/utils/mcp/private-chats-google-data.spec.ts',
    'tests/unit/server/utils/mcp/private-chats-read.spec.ts',
    'tests/unit/server/utils/mcp/private-files.spec.ts',
    'tests/unit/server/utils/mcp/private/artifacts.spec.ts',
    'tests/unit/server/utils/besidka-tools/chat-adapter.spec.ts',
    'tests/unit/server/mcp/tools/rename-file.spec.ts',
    'tests/unit/server/utils/documents/create-document-tool.spec.ts',
    'tests/unit/server/utils/mcp/private-documents.spec.ts',
    'tests/integration/api/documents.spec.ts',
    'tests/unit/server/utils/tool-approval/google.spec.ts',
    'tests/unit/utils/knowledge/ingest.spec.ts',
    'tests/unit/utils/memory/extract-sweep.spec.ts',
    'tests/unit/utils/memory/extract-manual.spec.ts',
    'tests/unit/utils/memory/backfill.spec.ts',
    'tests/unit/utils/memory/tools/memory-tools.spec.ts',
    'tests/unit/utils/memory/tools/read-chat.spec.ts',
    'tests/unit/utils/memory/tools/search-chats.spec.ts',
    'tests/unit/composables/chat-google-data.spec.ts',
    'tests/unit/components/Profile/Keys/GeminiPaidTier.spec.ts',
    'tests/unit/components/Profile/Keys/ProviderKeyCard.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/ModelItem.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/GatewayModelItem.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger/Panel.spec.ts',
    'tests/unit/components/Chat/ShareModal.client.spec.ts',
    'tests/unit/components/Chat/ContextPanel.spec.ts',
  ]

  const googleDrivePickerTests = [
    'tests/unit/utils/google-drive.spec.ts',
    'tests/unit/server/utils/google/http.spec.ts',
    'tests/unit/server/utils/google/download.spec.ts',
    'tests/unit/server/utils/google/drive.spec.ts',
    'tests/unit/server/utils/google/token-boundary.spec.ts',
    'tests/unit/server/utils/google/picker-frame.spec.ts',
    'tests/integration/api/chats-new-google-data.spec.ts',
    'tests/unit/components/Chat/Artifact/Frame.client.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/integration/api/google-drive-picker-token.spec.ts',
    'tests/integration/api/google-drive-import.spec.ts',
    'tests/integration/server/google-drive-parts.spec.ts',
    'tests/integration/api/chats-google-data-guard.spec.ts',
    'tests/integration/server/artifacts-frame-src-plugin.spec.ts',
    'tests/integration/api/storage.spec.ts',
    'tests/integration/api/files-index-source.spec.ts',
    'tests/unit/composables/google-picker.spec.ts',
    'tests/unit/composables/chat-drive-files.spec.ts',
    'tests/unit/components/Chat/DriveFiles.spec.ts',
    'tests/unit/components/Chat/ContextPanel.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/Content.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu.spec.ts',
    'tests/unit/components/ChatInput/Files/Attached/Preview.client.spec.ts',
    'tests/unit/server/utils/chats/share-public-parts.spec.ts',
    'tests/integration/server/rewrite-share-file-urls.spec.ts',
    'tests/unit/server/utils/chats/context/drive-files.spec.ts',
    'tests/unit/server/utils/chats/context/build-chat-context.spec.ts',
    'tests/unit/utils/chats/request-schema.spec.ts',
    'tests/unit/utils/chats/request-schema-drive.spec.ts',
    'tests/unit/utils/artifact-frame-policy.spec.ts',
    'tests/unit/utils/storage-categories.spec.ts',
    'tests/unit/server/utils/storage/usage.spec.ts',
    'tests/unit/server/utils/mcp/private-settings-storage.spec.ts',
    'tests/unit/pages/profile/storage.spec.ts',
    'tests/unit/utils/knowledge/quota.spec.ts',
    'tests/unit/composables/chat-scroll-spacer.spec.ts',
    'tests/e2e/chat/scroll-spacer.spec.ts',
    'tests/e2e/chat/composer-overlays-spacer.spec.ts',
  ]

  const googleDriveToolsTests = [
    'tests/unit/utils/google-drive-tools.spec.ts',
    'tests/unit/utils/google-step.spec.ts',
    'tests/unit/server/utils/google/drive-upload.spec.ts',
    'tests/unit/server/utils/google/tool-output.spec.ts',
    'tests/unit/server/utils/google/http.spec.ts',
    'tests/unit/server/utils/google/drive.spec.ts',
    'tests/unit/server/utils/tool-approval/google.spec.ts',
    'tests/integration/server/google-drive-tools.spec.ts',
    'tests/integration/api/google-drive-saved-files.spec.ts',
    'tests/integration/api/chats-tool-approval-request.spec.ts',
    'tests/integration/api/chats-tool-approval-continuation.spec.ts',
    'tests/unit/composables/google-drive-save.spec.ts',
    'tests/unit/components/Chat/SaveToGoogleDrive.spec.ts',
    'tests/unit/components/Chat/Reasoning/GoogleStep.spec.ts',
    'tests/unit/components/Chat/Files.spec.ts',
    'tests/unit/components/Chat/Document.spec.ts',
    'tests/unit/components/Chat/GeneratedImage.spec.ts',
    'tests/unit/components/Chat/Reasoning.spec.ts',
    'tests/unit/components/Chat/Reasoning.icons.spec.ts',
    'tests/unit/components/Chat/Reasoning.approvals.spec.ts',
    'tests/unit/components/Chat/Reasoning.google.spec.ts',
    'tests/unit/utils/tool-approval-step.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/Content.spec.ts',
    'tests/unit/server/utils/google/send-flag.spec.ts',
    'tests/integration/server/google-access-ended.spec.ts',
    'tests/unit/composables/chat-scroll-spacer.spec.ts',
    'tests/e2e/chat/scroll-spacer.spec.ts',
    'tests/e2e/chat/composer-overlays-spacer.spec.ts',
  ]

  const googleGmailToolsTests = [
    'tests/unit/server/utils/google/gmail-message.spec.ts',
    'tests/unit/server/utils/google/gmail-text.spec.ts',
    'tests/unit/server/utils/google/gmail-boundary.spec.ts',
    'tests/unit/server/utils/google/data-guard.spec.ts',
    'tests/unit/server/utils/google/http.spec.ts',
    'tests/unit/server/utils/google/token-boundary.spec.ts',
    'tests/unit/server/utils/tool-approval/google-gmail.spec.ts',
    'tests/unit/server/utils/tool-approval/google.spec.ts',
    'tests/unit/server/utils/tool-approval/policy.spec.ts',
    'tests/unit/utils/google-gmail-step.spec.ts',
    'tests/unit/utils/google-step.spec.ts',
    'tests/unit/utils/google-drive-tools.spec.ts',
    'tests/unit/utils/features/registry.spec.ts',
    'tests/integration/server/google-byo-tools.spec.ts',
    'tests/integration/server/google-drive-tools.spec.ts',
    'tests/integration/api/chats-tool-approval-continuation.spec.ts',
    'tests/integration/api/chats-tool-approval-request.spec.ts',
    'tests/unit/components/Chat/Reasoning/GoogleStep.spec.ts',
    'tests/unit/components/Chat/Reasoning/ApprovalStep.spec.ts',
    'tests/unit/components/Profile/Google/OwnClient.spec.ts',
    'tests/unit/server/utils/tool-approval/send.spec.ts',
    'tests/unit/utils/tool-approval-parts.spec.ts',
    'tests/unit/utils/tool-approval-step.spec.ts',
    'tests/unit/composables/chat-scroll-spacer.spec.ts',
    'tests/e2e/chat/scroll-spacer.spec.ts',
    'tests/e2e/chat/composer-overlays-spacer.spec.ts',
  ]

  const googleDriveTabTests = [
    'tests/integration/api/google-drive-refresh.spec.ts',
    'tests/integration/api/google-drive-import.spec.ts',
    'tests/integration/api/files-index-google-source.spec.ts',
    'tests/integration/api/files-index-source.spec.ts',
    'tests/unit/server/utils/files/connector-images.spec.ts',
    'tests/unit/utils/google-drive.spec.ts',
    'tests/unit/utils/file-manager-sources.spec.ts',
    'tests/unit/composables/google-drive-library.spec.ts',
    'tests/unit/composables/file-touch-select.spec.ts',
    'tests/unit/composables/google-picker.spec.ts',
    'tests/unit/composables/file-manager.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal.client.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select.client.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/Drive.client.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/ActionsToolbar.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/Grid/ActionsMenu.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/Grid/View.spec.ts',
    'tests/unit/components/ChatInput/Files/Modal/Select/List/View.spec.ts',
  ]

  const googleToolApprovalTests = [
    'tests/unit/server/utils/tool-approval/google.spec.ts',
    'tests/unit/server/utils/tool-approval/round-state.spec.ts',
    'tests/unit/utils/google-tool-approvals.spec.ts',
    'tests/integration/api/chats-branch.spec.ts',
    'tests/integration/api/chats-shares-branch.spec.ts',
    'tests/unit/server/utils/tool-approval/policy.spec.ts',
    'tests/unit/server/utils/tool-approval/state.spec.ts',
    'tests/unit/server/utils/tool-approval/kv.spec.ts',
    'tests/unit/server/utils/tool-approval/send.spec.ts',
    'tests/unit/server/utils/tool-approval/continuation.spec.ts',
    'tests/unit/server/utils/tool-approval/cleanup.spec.ts',
    'tests/unit/server/utils/connectors/send-tools.spec.ts',
    'tests/unit/utils/tool-approval-step.spec.ts',
    'tests/unit/components/Chat/Reasoning/ApprovalStep.spec.ts',
    'tests/integration/api/chats-tool-approval-request.spec.ts',
    'tests/integration/api/chats-tool-approval-continuation.spec.ts',
    'tests/integration/api/chats-tool-approval-grants.spec.ts',
  ]

  const toolApprovalContinuationTests = [
    'tests/unit/server/utils/tool-approval/continuation.spec.ts',
    'tests/unit/server/utils/connectors/kept-images.spec.ts',
    'tests/unit/server/utils/tool-approval/send.spec.ts',
    'tests/integration/api/chats-tool-approval-continuation.spec.ts',
    'tests/integration/api/chats-tool-approval-request.spec.ts',
    'tests/integration/api/tool-approval-spike.spec.ts',
    'tests/unit/composables/tool-approvals.spec.ts',
    'tests/unit/composables/chat.spec.ts',
    'tests/unit/utils/message-usage.spec.ts',
    'tests/unit/server/utils/connectors/send-tools.spec.ts',
    'tests/unit/server/utils/connectors/audit.spec.ts',
  ]

  const toolApprovalUiTests = [
    'tests/unit/utils/tool-approval-step.spec.ts',
    'tests/unit/composables/tool-approvals.spec.ts',
    'tests/unit/composables/chat.tool-approvals.spec.ts',
    'tests/unit/components/Chat/Reasoning/ApprovalStep.spec.ts',
    'tests/unit/components/Chat/Reasoning.approvals.spec.ts',
    'tests/unit/components/Chat/Reasoning.connectors.spec.ts',
    'tests/unit/components/Chat/Reasoning.spec.ts',
    'tests/unit/components/ChatInput/ToolApprovalChip.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/unit/components/Chat/ToolApprovalBubble.spec.ts',
    'tests/e2e/chat/tool-approval.spec.ts',
  ]

  const approvalScrollTests = [
    'tests/unit/composables/chat-scroll-spacer.spec.ts',
    'tests/e2e/chat/scroll-spacer.spec.ts',
    'tests/e2e/chat/composer-overlays-spacer.spec.ts',
    'tests/e2e/chat/tool-approval.spec.ts',
    'tests/e2e/chat/approval-scroll.spec.ts',
    'tests/unit/components/Chat/ToolApprovalBubble.spec.ts',
    'tests/unit/composables/message-approvals.spec.ts',
    'tests/unit/components/ChatInput/ToolApprovalChip.spec.ts',
    'tests/unit/composables/chat.tool-approvals.spec.ts',
    'tests/unit/components/Chat/ToolRounds.spec.ts',
    'tests/unit/composables/tool-rounds.spec.ts',
  ]

  const reasoningStepsUiTests = [
    'tests/unit/utils/reasoning-steps.spec.ts',
    'tests/unit/components/Chat/Reasoning/Step.spec.ts',
    'tests/unit/components/Chat/Reasoning.streaming.spec.ts',
    'tests/unit/components/Chat/Reasoning.spec.ts',
    'tests/unit/components/Chat/Reasoning.approvals.spec.ts',
    'tests/unit/components/Chat/Reasoning.connectors.spec.ts',
    'tests/unit/components/Chat/Reasoning.icons.spec.ts',
    'tests/unit/components/Chat/ToolApprovalBubble.spec.ts',
    'tests/unit/components/Chat/Reasoning/ApprovalStep.spec.ts',
    'tests/unit/composables/message-approvals.spec.ts',
    'tests/unit/utils/message-part-spacing.spec.ts',
    'tests/unit/utils/chat-reasoning-live.spec.ts',
    'tests/e2e/chat/tool-approval.spec.ts',
    'tests/e2e/chat/skills.spec.ts',
  ]

  const toolApprovalGrantsTests = [
    'tests/integration/api/chats-tool-approval-grants.spec.ts',
    'tests/unit/server/utils/connectors/send-tools.spec.ts',
    'tests/unit/server/utils/tool-approval/send.spec.ts',
    'tests/unit/server/utils/tool-approval/policy.spec.ts',
    'tests/unit/server/utils/tool-approval/continuation.spec.ts',
    'tests/unit/composables/tool-approval-grants.spec.ts',
    'tests/unit/components/Chat/ContextPanelApprovals.spec.ts',
    'tests/unit/components/Chat/ContextPanel.spec.ts',
    'tests/unit/components/Chat/Reasoning/ApprovalStep.spec.ts',
    'tests/unit/server/utils/tool-approval/grants.spec.ts',
    'tests/unit/components/Chat/Reasoning.approvals.spec.ts',
    'tests/unit/server/utils/chats/share-public-parts.spec.ts',
    'tests/unit/utils/memory/tools/memory-tools.spec.ts',
  ]

  const skillJevScreeningTests = [
    'tests/unit/server/utils/jev/skill-screening.spec.ts',
    'tests/unit/server/utils/skills/jev/screen.spec.ts',
    'tests/unit/server/utils/skills/jev/lifecycle.spec.ts',
    'tests/unit/server/utils/skills/import/screen-rate-limit.spec.ts',
    'tests/unit/server/utils/skills/import/preview-jev.spec.ts',
    'tests/unit/server/api/v1/skills/screen.spec.ts',
    'tests/unit/utils/jev-skill-policy.spec.ts',
    'tests/unit/utils/jev/injection-screening.spec.ts',
    'tests/unit/utils/jev/logging.spec.ts',
  ]

  const skillsStorageTests = [
    ...skillJevScreeningTests,
    ...skillSelectionTests,
    'tests/unit/utils/skills-policy.spec.ts',
    'tests/unit/utils/features/skills-registry.spec.ts',
    'tests/unit/server/utils/skills/storage.spec.ts',
    'tests/unit/server/utils/skills/cleanup.spec.ts',
    'tests/unit/server/utils/skills/sweep.spec.ts',
    'tests/unit/utils/projects/lifecycle.spec.ts',
    'tests/integration/server/skills-storage-sweep-plugin.spec.ts',
    'tests/unit/server/utils/files/derived-keys-delete-sites.spec.ts',
    'tests/unit/utils/account/purge-user-data.spec.ts',
    'tests/unit/server/utils/chats/lifecycle.spec.ts',
    'tests/integration/api/chats-history.spec.ts',
  ]

  const skillsVersionsTests = [
    ...skillJevScreeningTests,
    'tests/unit/utils/skills-policy.spec.ts',
    'tests/unit/utils/skills/edit.spec.ts',
    'tests/unit/utils/skills/templates.spec.ts',
    'tests/unit/utils/skills/mode.spec.ts',
    'tests/unit/server/utils/skills/unique-violation.spec.ts',
    'tests/unit/server/utils/skills/cleanup.spec.ts',
    'tests/unit/server/utils/skills/pending.spec.ts',
    'tests/unit/server/utils/skills/import/commit.spec.ts',
    'tests/unit/server/utils/skills/import/rate-limit.spec.ts',
    'tests/unit/server/utils/skills/import/save-rate-limit.spec.ts',
    'tests/unit/server/utils/skills/versions/statements.spec.ts',
    'tests/unit/server/utils/skills/versions/save.spec.ts',
    'tests/unit/server/utils/skills/versions/restore.spec.ts',
    'tests/unit/server/utils/skills/versions/create.spec.ts',
    'tests/unit/server/utils/skills/versions/read-write-paths.spec.ts',
    'tests/unit/server/utils/skills/versions/settings.spec.ts',
    'tests/unit/server/utils/mcp/private/skills.spec.ts',
    'tests/unit/server/api/v1/skills/skills-crud.spec.ts',
    'tests/unit/server/api/v1/skills/update-check.spec.ts',
    'tests/unit/utils/skills/findings.spec.ts',
    'tests/unit/utils/skills/findings-severity.spec.ts',
    'tests/unit/utils/skills/findings-execution.spec.ts',
    'tests/unit/utils/skills/findings-intent.spec.ts',
    'tests/unit/utils/skills/findings-frontmatter.spec.ts',
    'tests/unit/utils/skills/findings-redos.spec.ts',
    'tests/unit/utils/skills/url-hosts.spec.ts',
    'tests/unit/utils/skills/known-names.spec.ts',
    'tests/unit/utils/skills/file-set-findings.spec.ts',
    'tests/unit/utils/skills/update-changes.spec.ts',
    'tests/unit/server/utils/skills/versions/changes.spec.ts',
    'tests/unit/server/utils/skills/import/update-findings.spec.ts',
  ]

  const skillsImportTests = [
    ...skillJevScreeningTests,
    'tests/unit/utils/skills-policy.spec.ts',
    'tests/unit/utils/skills/path.spec.ts',
    'tests/unit/utils/skills/frontmatter.spec.ts',
    'tests/unit/utils/skills/findings.spec.ts',
    'tests/unit/utils/skills/corpus-benign.spec.ts',
    'tests/unit/utils/skills/corpus-attack-patterns.spec.ts',
    'tests/unit/utils/skills/findings-severity.spec.ts',
    'tests/unit/utils/skills/findings-execution.spec.ts',
    'tests/unit/utils/skills/findings-intent.spec.ts',
    'tests/unit/utils/skills/findings-frontmatter.spec.ts',
    'tests/unit/utils/skills/findings-redos.spec.ts',
    'tests/unit/utils/skills/url-hosts.spec.ts',
    'tests/unit/utils/skills/known-names.spec.ts',
    'tests/unit/utils/skills/file-set-findings.spec.ts',
    'tests/unit/server/utils/skills/import/update-findings.spec.ts',
    'tests/unit/server/utils/skills/lookalike-context.spec.ts',
    'tests/unit/server/utils/skills/import/preview-lookalike.spec.ts',
    'tests/unit/utils/skills/license.spec.ts',
    'tests/unit/utils/skills/archive.spec.ts',
    'tests/unit/utils/skills/analyze.spec.ts',
    'tests/unit/utils/skills/github-url.spec.ts',
    'tests/unit/utils/skills/release.spec.ts',
    'tests/unit/utils/skills/github-archive.spec.ts',
    'tests/unit/utils/skills/diff.spec.ts',
    'tests/unit/utils/skills/compose.spec.ts',
    'tests/unit/server/utils/skills/import/zip.spec.ts',
    'tests/unit/server/utils/skills/import/rate-limit.spec.ts',
    'tests/unit/server/utils/skills/import/stage.spec.ts',
    'tests/unit/server/utils/skills/import/github.spec.ts',
    'tests/unit/server/utils/skills/import/github-resolve.spec.ts',
    'tests/unit/server/utils/skills/import/git-refs.spec.ts',
    'tests/unit/server/utils/skills/import/commit.spec.ts',
    'tests/unit/server/utils/skills/import/update-sweep.spec.ts',
    'tests/integration/server/skills-update-sweep-plugin.spec.ts',
    'tests/unit/server/utils/skills/pending.spec.ts',
    'tests/unit/server/api/v1/skills/import-preview.spec.ts',
    'tests/unit/server/api/v1/skills/import-text.spec.ts',
    'tests/unit/server/api/v1/skills/import-commit.spec.ts',
    'tests/unit/server/api/v1/skills/import-github.spec.ts',
    'tests/unit/server/api/v1/skills/import-stage-files.spec.ts',
    'tests/unit/server/api/v1/skills/update-pending.spec.ts',
    'tests/unit/server/api/v1/skills/update-check.spec.ts',
    'tests/unit/workers/skill-import.spec.ts',
    'tests/unit/config/wrangler-skills-rate-limit.spec.ts',
    'tests/unit/server/utils/artifacts/viewer-storage-request.spec.ts',
    'tests/integration/api/artifact-complete.spec.ts',
    'tests/integration/api/artifact-storage.spec.ts',
  ]

  const skillsManagerTests = [
    'tests/unit/pages/chats/skills/index.spec.ts',
    'tests/unit/composables/skills-library.spec.ts',
    'tests/unit/composables/skill-editor.spec.ts',
    'tests/unit/utils/skill-ui-utils.spec.ts',
    'tests/unit/utils/skill-findings-rescan.spec.ts',
    'tests/unit/utils/skill-editor.spec.ts',
    'tests/unit/utils/skills/update-changes.spec.ts',
    'tests/unit/utils/skills/compose.spec.ts',
    'tests/unit/utils/skills/mode.spec.ts',
    'tests/unit/utils/skills/release.spec.ts',
    'tests/unit/components/Profile/Skills/CreateDialog.client.spec.ts',
    'tests/unit/components/Profile/Skills/DetailHeader.spec.ts',
    'tests/unit/components/Profile/Skills/DetailPanel.spec.ts',
    'tests/unit/components/Profile/Skills/DiffView.spec.ts',
    'tests/unit/components/Profile/Skills/EditDialog.client.spec.ts',
    'tests/unit/components/Profile/Skills/EditorPane.spec.ts',
    'tests/unit/components/Profile/Skills/FileTree.spec.ts',
    'tests/unit/components/Profile/Skills/FindingGroups.spec.ts',
    'tests/unit/components/Profile/Skills/JevSection.spec.ts',
    'tests/unit/components/Profile/Skills/ProblemList.spec.ts',
    'tests/unit/components/Profile/Skills/FileViewer.spec.ts',
    'tests/unit/components/Profile/Skills/Filters.spec.ts',
    'tests/unit/components/Profile/Skills/ImportDialog.client.spec.ts',
    'tests/unit/components/Profile/Skills/FrontmatterFields.spec.ts',
    'tests/unit/components/Profile/Skills/List.spec.ts',
    'tests/unit/components/Profile/Skills/ModeControl.spec.ts',
    'tests/unit/components/Profile/Skills/ModelView.spec.ts',
    'tests/unit/components/Profile/Skills/NewMenu.spec.ts',
    'tests/unit/components/Profile/Skills/ScriptsDialog.client.spec.ts',
    'tests/unit/components/Profile/Skills/Settings.spec.ts',
    'tests/unit/components/Profile/Skills/RenameForm.spec.ts',
    'tests/unit/components/Profile/Skills/Review.spec.ts',
    'tests/unit/components/Profile/Skills/Row.spec.ts',
    'tests/unit/components/Profile/Skills/UpdateReview.client.spec.ts',
    'tests/unit/components/Profile/Skills/WorkspaceDialog.client.spec.ts',
    'tests/unit/layouts/profile.spec.ts',
    'tests/unit/components/Search/Modal.spec.ts',
    'tests/unit/components/History/PageShell.spec.ts',
    'tests/unit/utils/features/skills-registry.spec.ts',
    'tests/e2e/history/skills.spec.ts',
  ]

  const skillsRuntimeTests = [
    ...skillSelectionTests,
    'tests/unit/utils/skills-policy.spec.ts',
    'tests/unit/utils/skills/mode.spec.ts',
    'tests/unit/server/utils/skills/runtime/text.spec.ts',
    'tests/unit/server/utils/skills/runtime/catalog.spec.ts',
    'tests/unit/server/utils/skills/runtime/persist.spec.ts',
    'tests/unit/server/utils/skills/runtime/invocation.spec.ts',
    'tests/unit/server/utils/skills/runtime/tools.spec.ts',
    'tests/unit/server/utils/skills/runtime/tools-notice.spec.ts',
    'tests/unit/utils/skills/runtime-notice.spec.ts',
    'tests/unit/server/utils/skills/runtime/reinject.spec.ts',
    'tests/unit/server/utils/skills/runtime/send.spec.ts',
    'tests/unit/server/utils/skills/runtime/project.spec.ts',
    'tests/unit/server/utils/skills/project/pins.spec.ts',
    'tests/unit/server/api/v1/projects/project-skills.spec.ts',
    'tests/unit/server/mcp/tools/set-project-skills.spec.ts',
    'tests/unit/server/utils/mcp/private/project-skills.spec.ts',
    'tests/unit/utils/projects/lifecycle.spec.ts',
    'tests/unit/utils/ai/tool-loop.spec.ts',
    'tests/unit/utils/chats/request-schema.spec.ts',
    'tests/unit/server/utils/chats/share-public-parts.spec.ts',
    'tests/unit/server/utils/chats/context/build-chat-context.spec.ts',
    'tests/integration/server/image-generation.spec.ts',
    'tests/integration/server/model-turns.spec.ts',
    'tests/integration/api/chats-skills.spec.ts',
  ]

  const skillsScriptsTests = [
    'tests/unit/utils/skills/scripts.spec.ts',
    'tests/unit/server/utils/skills/provider-upload.spec.ts',
    'tests/unit/server/utils/skills/send-container-options.spec.ts',
    'tests/unit/server/utils/skills/scripts-toggle.spec.ts',
    'tests/unit/server/utils/skills/cleanup.spec.ts',
    'tests/unit/server/utils/tool-approval/policy.spec.ts',
    'tests/unit/server/utils/besidka-tools/chat-settings.spec.ts',
    'tests/unit/utils/features/skills-registry.spec.ts',
    'tests/unit/utils/code-execution/send.spec.ts',
    'tests/integration/api/chats-code-execution.spec.ts',
  ]

  const skillsComposerTests = [
    'tests/unit/utils/skill-step.spec.ts',
    'tests/unit/utils/chat-input-tiles.spec.ts',
    'tests/unit/utils/reasoning.spec.ts',
    'tests/unit/composables/composer-skill-invocation.spec.ts',
    'tests/unit/composables/composer-skills.spec.ts',
    'tests/unit/composables/composer-commands.spec.ts',
    'tests/unit/utils/composer-command.spec.ts',
    'tests/unit/components/ChatInput/CommandPicker.spec.ts',
    'tests/unit/components/ChatInput/CommandMirror.spec.ts',
    'tests/unit/composables/chat.spec.ts',
    'tests/unit/components/Chat/Reasoning.spec.ts',
    'tests/integration/api/shared-chat-view.spec.ts',
    'tests/unit/components/Chat/SkillInvocation.spec.ts',
    'tests/unit/components/Chat/SkillPreview.client.spec.ts',
    'tests/unit/components/Projects/SkillsCard.spec.ts',
    'tests/unit/components/ChatInput/SkillPicker.client.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu/Content.spec.ts',
    'tests/unit/components/ChatInput/ToolsMenu.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/unit/pages/chats/skills/index.spec.ts',
    'tests/e2e/chat/skills.spec.ts',
  ]

  const builtinCommandsTests = [
    'tests/unit/utils/builtin-commands.spec.ts',
    'tests/unit/utils/skills-policy.spec.ts',
    'tests/unit/utils/chats/request-schema.spec.ts',
    'tests/unit/utils/memory/extract-input.spec.ts',
    'tests/unit/server/utils/chats/builtin-commands.spec.ts',
    'tests/unit/server/utils/chats/builtin-command-rate-limit.spec.ts',
    'tests/unit/server/utils/chats/share-public-parts.spec.ts',
    'tests/unit/server/utils/files/assistant-files.spec.ts',
    'tests/unit/server/utils/jev/send-path.spec.ts',
    'tests/unit/server/utils/mcp/private-chats.spec.ts',
    'tests/unit/server/api/chats-support-info.spec.ts',
    'tests/unit/utils/search/text.spec.ts',
    'tests/unit/utils/memory/tools/read-chat.spec.ts',
    'tests/unit/utils/account/purge-user-data.spec.ts',
    'tests/integration/api/chats-title.spec.ts',
    'tests/unit/composables/composer-builtin-command.spec.ts',
    'tests/unit/composables/composer-commands.spec.ts',
    'tests/unit/composables/chat.spec.ts',
    'tests/unit/utils/composer-command.spec.ts',
    'tests/unit/components/ChatInput/CommandPicker.spec.ts',
    'tests/unit/components/ChatInput/CommandMirror.spec.ts',
    'tests/unit/components/Chat/SkillInvocation.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
    'tests/unit/pages/chats-new.spec.ts',
    'tests/integration/api/chats-builtin-commands.spec.ts',
    'tests/integration/api/chats-skills.spec.ts',
    'tests/integration/api/shared-chat-view.spec.ts',
    'tests/integration/server/assistant-files.spec.ts',
    'tests/integration/server/model-turns.spec.ts',
    'tests/e2e/chat/builtin-commands.spec.ts',
    'tests/e2e/chat/skills.spec.ts',
    'tests/e2e/chat/composer-overlays-spacer.spec.ts',
    'tests/e2e/chat/scroll-spacer.spec.ts',
  ]

  const usageReportsTests = [
    'tests/unit/server/utils/usage/report-text.spec.ts',
    'tests/unit/server/utils/usage/chat-cost.spec.ts',
    'tests/unit/server/utils/usage/usage-stats.spec.ts',
    'tests/unit/server/utils/mcp/private/debug-info.spec.ts',
    'tests/unit/utils/account/purge-user-data.spec.ts',
    'tests/unit/server/mcp/tools/get-chat-cost.spec.ts',
    'tests/unit/server/mcp/tools/get-usage-stats.spec.ts',
    'tests/unit/server/mcp/tools/get-debug-info.spec.ts',
    'tests/unit/server/utils/chats/builtin-commands.spec.ts',
    'tests/unit/server/utils/besidka-tools/parity.spec.ts',
    'tests/unit/server/utils/besidka-tools/chat-adapter.spec.ts',
    'tests/unit/server/utils/mcp/tool-scopes.spec.ts',
    'tests/unit/config/mcp-surface.spec.ts',
    'tests/unit/utils/message-metadata.spec.ts',
    'tests/integration/api/chats-builtin-commands.spec.ts',
    'tests/e2e/chat/builtin-commands.spec.ts',
  ]

  const builtinSkillsPageTests = [
    'tests/unit/components/Profile/Skills/BuiltinList.spec.ts',
    'tests/unit/pages/chats/skills/index.spec.ts',
    'tests/unit/utils/builtin-commands.spec.ts',
    'tests/unit/composables/composer-builtin-command.spec.ts',
    'tests/e2e/chat/builtin-commands.spec.ts',
    'tests/e2e/history/skills.spec.ts',
  ]

  const commandUniquenessTests = [
    'tests/unit/utils/skills-policy.spec.ts',
    'tests/unit/server/utils/skills/versions/create.spec.ts',
    'tests/unit/server/utils/skills/versions/read-write-paths.spec.ts',
    'tests/unit/server/api/v1/skills/skills-crud.spec.ts',
    'tests/unit/components/Profile/Skills/Settings.spec.ts',
    'tests/unit/components/Profile/Skills/CreateDialog.client.spec.ts',
    'tests/unit/composables/skills-library.spec.ts',
    'tests/e2e/chat/builtin-commands.spec.ts',
    'tests/e2e/history/skills.spec.ts',
  ]

  const seoTests = [
    'tests/unit/config/seo.spec.ts',
  ]

  const agentDiscoveryTests = [
    'tests/unit/config/seo.spec.ts',
    'tests/unit/server/routes/well-known/ai-catalog.spec.ts',
    'tests/unit/config/site-url.spec.ts',
    'tests/unit/server/routes/well-known/poppy.spec.ts',
    'tests/unit/server/routes/well-known/agent-skills-skill.spec.ts',
    'tests/unit/server/routes/well-known/mcp/server-card.spec.ts',
    'tests/unit/server/routes/well-known/mcp-registry-auth.spec.ts',
    'tests/unit/server/routes/well-known/openai-apps-challenge.spec.ts',
    'tests/unit/config/mcp-registry-manifests.spec.ts',
    'tests/unit/server/plugins/agent-discovery-landing.spec.ts',
    'tests/unit/server/plugins/agent-discovery-page-components.spec.ts',
    'tests/unit/server/utils/agent-discovery/skills.spec.ts',
    'tests/unit/server/utils/agent-discovery/landing-markdown.spec.ts',
    'tests/unit/server/utils/content/minimark.spec.ts',
  ]

  const searchModalTests = [
    'tests/unit/composables/search-modal.spec.ts',
    'tests/unit/composables/files-modal-handoff.spec.ts',
    'tests/unit/components/Search/Modal.spec.ts',
    'tests/unit/components/Search/ResultRow.spec.ts',
    'tests/e2e/search/pin.spec.ts',
    'tests/unit/components/Sidebar.spec.ts',
    'tests/unit/components/ChatInput.spec.ts',
  ]

  const sidePanelTests = [
    'tests/unit/composables/side-panel.spec.ts',
    'tests/unit/components/ui/SidePanel.spec.ts',
    'tests/unit/components/Sidebar.spec.ts',
    'tests/unit/assets/css/main.spec.ts',
    'tests/e2e/side-panel.spec.ts',
  ]

  const codeExecutionTests = [
    'tests/unit/components/Chat/CodeExecution.spec.ts',
    'tests/unit/components/Chat/CodeExecution/Detail.spec.ts',
    'tests/unit/utils/code-execution-ui.spec.ts',
    'tests/unit/utils/reasoning.spec.ts',
    'tests/unit/composables/chat.spec.ts',
    'tests/unit/server/utils/chats/context/build-chat-context.spec.ts',
  ]

  const codeExecutionServerTests = [
    'tests/unit/utils/code-execution/compact.spec.ts',
    'tests/unit/utils/code-execution/container-files.spec.ts',
    'tests/unit/utils/code-execution/document-validation.spec.ts',
    'tests/unit/utils/code-execution/file-types.spec.ts',
    'tests/unit/utils/code-execution/input-files.spec.ts',
    'tests/unit/utils/code-execution/message-parts.spec.ts',
    'tests/unit/utils/code-execution/persist-container-files.spec.ts',
    'tests/unit/utils/code-execution/openai-citations.spec.ts',
    'tests/unit/utils/code-execution/provider-cleanup.spec.ts',
    'tests/unit/utils/code-execution/request-schema.spec.ts',
    'tests/unit/utils/code-execution/sdk-request-shape.spec.ts',
    'tests/unit/utils/code-execution/send.spec.ts',
    'tests/unit/utils/code-execution/shared.spec.ts',
    'tests/unit/utils/code-execution/stream.spec.ts',
    'tests/unit/utils/ai/code-execution-cost.spec.ts',
    'tests/unit/utils/providers/code-execution-models.spec.ts',
    'tests/unit/utils/providers/code-execution-tools.spec.ts',
    'tests/integration/api/chats-code-execution.spec.ts',
  ]

  const chatContextTests = [
    'tests/unit/server/utils/chats/context/build-chat-context.spec.ts',
    'tests/unit/server/api/chats-context.spec.ts',
    'tests/unit/server/api/chats-support-info.spec.ts',
    'tests/unit/composables/chat-debug-info.spec.ts',
    'tests/unit/server/api/shared-context.spec.ts',
    'tests/unit/server/utils/mcp/private-chats-read.spec.ts',
    'tests/unit/server/mcp/tools/get-chat.spec.ts',
    'tests/unit/utils/chat-context.spec.ts',
    'tests/unit/utils/message-metadata.spec.ts',
    'tests/unit/composables/chat-context.spec.ts',
    'tests/unit/composables/chat-route.spec.ts',
    'tests/unit/composables/chat-pin.spec.ts',
    'tests/unit/composables/history.spec.ts',
    'tests/unit/components/Chat/ContextPanel.spec.ts',
    'tests/unit/components/Sidebar/ChatContextButton.spec.ts',
    'tests/unit/components/Sidebar/AuthCta.spec.ts',
    'tests/unit/components/Sidebar/Development.spec.ts',
    'tests/unit/components/Sidebar.spec.ts',
    'tests/e2e/chat-context-panel.spec.ts',
    'tests/e2e/chat-context-pin.spec.ts',
  ]

  const messageSearchTests = [
    'tests/unit/utils/search/text.spec.ts',
    'tests/unit/utils/search/ukrainian-stemmer.spec.ts',
    'tests/unit/utils/search/tokens.spec.ts',
    'tests/unit/utils/search/query.spec.ts',
    'tests/unit/utils/search/index-writer.spec.ts',
    'tests/unit/utils/search/sweeper.spec.ts',
    'tests/integration/server/message-search-sweep-plugin.spec.ts',
    'tests/unit/utils/chats/history/search.spec.ts',
    'tests/unit/utils/chats/history/search-cursor.spec.ts',
    'tests/integration/api/chats-history-content-search.spec.ts',
    'tests/integration/api/chats-message-delete.spec.ts',
  ]

  const externalSearchTests = [
    'tests/unit/utils/search/brave.spec.ts',
    'tests/unit/utils/search/exa.spec.ts',
    'tests/unit/utils/exa-search-level.spec.ts',
    'tests/unit/utils/search/freshness.spec.ts',
    'tests/unit/utils/search/search-budget.spec.ts',
    'tests/unit/utils/search/search-error.spec.ts',
    'tests/unit/utils/providers/deepseek-web-search.spec.ts',
    'tests/unit/utils/ai/external-search-cost.spec.ts',
    'tests/unit/config/wrangler-search-rates.spec.ts',
    'tests/unit/utils/search-usage.spec.ts',
    'tests/unit/utils/message-usage.spec.ts',
    'tests/integration/api/chats-external-search.spec.ts',
  ]

  const pastChatRetrievalTests = [
    'tests/unit/utils/memory/tools/pre-retrieval.spec.ts',
    'tests/unit/utils/past-chat-retrieval.spec.ts',
    'tests/unit/utils/memory/tools/web-search-write-lock.spec.ts',
    'tests/integration/api/chats-past-chat-pre-retrieval.spec.ts',
  ]

  const searchStepTests = [
    'tests/unit/utils/past-chat-retrieval.spec.ts',
    'tests/unit/utils/search-step.spec.ts',
    'tests/unit/components/Chat/Reasoning/SearchStep.spec.ts',
    'tests/unit/components/Chat/Reasoning.spec.ts',
  ]

  const chatSearchToolTests = [
    ...memoryToolTests,
    ...pastChatRetrievalTests,
    'tests/unit/utils/memory/tools/search-chats.spec.ts',
    'tests/unit/utils/memory/tools/read-chat.spec.ts',
    'tests/unit/utils/memory/tools/chat-search-budget.spec.ts',
    'tests/unit/utils/memory/tools/index.spec.ts',
    'tests/integration/api/chats-chat-search-tools.spec.ts',
    ...jevRerankTests,
    'tests/integration/api/chats-single-step-characterization.spec.ts',
    'tests/integration/api/chats-tool-loop.spec.ts',
    'tests/unit/utils/ai/search-answer-continuation.spec.ts',
    'tests/unit/utils/ai/tool-loop.spec.ts',
    'tests/integration/server/assistant-files.spec.ts',
    'tests/unit/utils/search/query.spec.ts',
    'tests/unit/utils/chats/history/search.spec.ts',
  ]

  const deepResearchTests = [
    'tests/unit/utils/research.spec.ts',
    'tests/unit/utils/research-ui.spec.ts',
    'tests/unit/utils/research/adapters/openai.spec.ts',
    'tests/unit/utils/research/adapters/google.spec.ts',
    'tests/unit/utils/research/adapters/mock.spec.ts',
    'tests/unit/utils/research/errors.spec.ts',
    'tests/unit/utils/research/finalize.spec.ts',
    'tests/unit/utils/research/sweep.spec.ts',
    'tests/unit/utils/research/start.spec.ts',
    'tests/unit/components/Chat/DeepResearchClarify.spec.ts',
    'tests/unit/components/Chat/DeepResearchMeta.spec.ts',
    'tests/unit/components/Chat/DeepResearchPending.spec.ts',
    'tests/unit/components/ChatInput/SettingTile.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger.spec.ts',
    'tests/unit/components/ChatInput/ModelsTrigger.research.spec.ts',
    'tests/unit/components/prose/A.spec.ts',
    'tests/unit/composables/chat-research.spec.ts',
    'tests/unit/composables/chat-input.spec.ts',
    'tests/unit/composables/research-links.spec.ts',
    'tests/integration/api/chats-research-clarify.spec.ts',
    'tests/integration/api/chats-research-start.spec.ts',
    'tests/integration/api/chats-research-status.spec.ts',
    'tests/integration/api/chats-research-cancel.spec.ts',
    'tests/integration/api/chats-detail.spec.ts',
    'tests/integration/server/research-job-sweep-plugin.spec.ts',
  ]

  const testMappings = [
    {
      pattern:
        /^(server\/utils\/ai\/image-generation(-lock|-cost|-errors)?\.ts|server\/utils\/ai\/image-provenance\.ts|server\/db\/schemas\/image-generation-locks\.ts|server\/utils\/providers\/(openai|google|anthropic|xai|deepseek|moonshotai|qwen)\.ts|providers\/(openai|google|anthropic|xai|deepseek|moonshotai|qwen)\.ts|shared\/types\/(image-generation|providers)\.d\.ts|shared\/utils\/model\.ts|app\/composables\/chat-input\.ts|app\/types\/web-search\.d\.ts|app\/components\/ChatInput(\.client\.vue|\/(ToolsMenu(\.client|\/[A-Za-z]+)|SettingTile|Files\/Attached\/Preview\.client)\.vue)|server\/types\/tools\.d\.ts)$/,
      tests: imageGenerationTests,
    },
    {
      pattern: /^shared\/utils\/exa-search-level\.ts$/,
      tests: [
        'tests/unit/components/ChatInput/ToolsMenu/WebSearchSection.spec.ts',
        'tests/unit/utils/chat-input-tiles.spec.ts',
        'tests/unit/components/ChatInput/ToolsMenu.spec.ts',
        'tests/e2e/chat/exa-search-level.spec.ts',
      ],
    },
    {
      pattern:
        /^(app\/utils\/web-search-price|shared\/utils\/google-search-billing-unit)\.ts$/,
      tests: [
        'tests/unit/utils/web-search-price.spec.ts',
        'tests/unit/utils/google-search-cost.spec.ts',
        'tests/unit/components/ChatInput/ToolsMenu/WebSearchSection.spec.ts',
      ],
    },
    {
      pattern: /^app\/utils\/search-rate\.ts$/,
      tests: [
        'tests/unit/utils/search-rate.spec.ts',
        'tests/unit/components/ChatInput/ToolsMenu/WebSearchSection.spec.ts',
        'tests/unit/components/Profile/Keys/SearchProvidersInfo.spec.ts',
      ],
    },
    {
      pattern: /^app\/composables\/file-input-support\.ts$/,
      tests: [
        ...imageGenerationTests,
        ...filesModuleTests,
        'tests/unit/composables/file-input-support.spec.ts',
        'tests/unit/components/Chat/GeneratedImage.spec.ts',
      ],
    },
    {
      pattern: /^shared\/utils\/input-media-types\.ts$/,
      tests: [
        ...filesModuleTests,
        'tests/unit/utils/input-media-types.spec.ts',
        'tests/unit/composables/file-input-support.spec.ts',
        'tests/unit/components/ChatInput.spec.ts',
        'tests/unit/utils/chats/input-file-support.spec.ts',
        'tests/integration/server/assistant-files.spec.ts',
        'tests/integration/api/chats-carried-files.spec.ts',
        'tests/integration/api/chats-message-id-stream.spec.ts',
      ],
    },
    {
      pattern: /^shared\/utils\/(file-delivery|office-files)\.ts$/,
      tests: [
        ...filesModuleTests,
        'tests/unit/composables/file-input-support.spec.ts',
        'tests/unit/utils/chats/input-file-support.spec.ts',
        'tests/unit/utils/features/registry.spec.ts',
        'tests/integration/api/chats-carried-files.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/chats\/file-delivery-check\.ts$/,
      tests: [
        'tests/unit/server/utils/chats/file-delivery-check.spec.ts',
        'tests/integration/api/chats-office-attachments.spec.ts',
        'tests/integration/api/chats-carried-files.spec.ts',
        'tests/integration/api/chats-message-id-stream.spec.ts',
        'tests/integration/api/chats-gateway.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/chats\/input-file-support\.ts$/,
      tests: [
        'tests/unit/utils/chats/input-file-support.spec.ts',
        'tests/integration/api/chats-message-id-stream.spec.ts',
        'tests/integration/api/chats-gateway.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/ai\/sdk-warnings\.ts$/,
      tests: [
        'tests/unit/utils/ai/sdk-warnings.spec.ts',
        'tests/integration/api/chats-message-id-stream.spec.ts',
      ],
    },
    {
      pattern: /^providers\/(merge|xai)\.ts$/,
      tests: ['tests/integration/api/chats-message-id-stream.spec.ts'],
    },
    {
      pattern: /^server\/utils\/ai\/generation-guard\.ts$/,
      tests: [
        'tests/unit/utils/ai/generation-guard.spec.ts',
        'tests/integration/api/chats-message-id-stream.spec.ts',
      ],
    },
    {
      pattern: /^(server\/utils\/ai\/tool-loop\.ts|tests\/fixtures\/follow-up-turn-tool\.ts)$/,
      tests: [
        ...chatSearchToolTests,
        'tests/unit/utils/ai/tool-loop.spec.ts',
        'tests/integration/api/chats-tool-loop.spec.ts',
        'tests/integration/api/chats-single-step-characterization.spec.ts',
        'tests/unit/utils/providers/moonshotai-web-search.spec.ts',
        'tests/unit/utils/providers/deepseek-web-search.spec.ts',
        'tests/integration/api/chats-project-knowledge.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/ai\/knowledge-tools\.ts$/,
      tests: [
        ...projectKnowledgeRetrievalTests,
        'tests/unit/utils/ai/tool-loop.spec.ts',
        'tests/unit/utils/ai/search-answer-continuation.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/ai\/native-search-instruction\.ts$/,
      tests: [
        'tests/unit/utils/ai/native-search-instruction.spec.ts',
        'tests/integration/api/chats-single-step-characterization.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/ai\/current-date-instruction\.ts$/,
      tests: [
        'tests/unit/utils/ai/native-search-instruction.spec.ts',
        'tests/unit/utils/ai/current-date-instruction.spec.ts',
        'tests/unit/utils/ai/search-answer-continuation.spec.ts',
        'tests/integration/api/chats-external-search.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/ai\/search-answer-continuation\.ts$/,
      tests: [
        'tests/unit/utils/ai/search-answer-continuation.spec.ts',
        'tests/integration/api/chats-tool-loop.spec.ts',
        'tests/unit/utils/gateways/cloudflare.spec.ts',
        'tests/integration/api/chats-cloudflare-search-answer.spec.ts',
        'tests/integration/api/chats-project-knowledge.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/ai\/image-generation-cost\.ts$/,
      tests: [
        ...messageUsageTests,
        'tests/unit/providers/merge.spec.ts',
        'tests/integration/api/chats-single-step-characterization.spec.ts',
      ],
    },
    {
      pattern:
        /^(providers\/(index|merge|google|openai|anthropic|xai|deepseek|moonshotai|qwen)\.ts|providers\/data\/models-dev-snapshot\.json|tests\/unit\/providers\/(anthropic|xai|deepseek|moonshotai|qwen)\.spec\.ts|scripts\/(fetch-models-metadata|audit-curated-models|detect-model-successors|propose-model-successors|models-dev-catalog)\.mjs|shared\/types\/providers\.d\.ts)$/,
      tests: modelCatalogTests,
    },
    {
      pattern:
        /^(server\/utils\/providers\/(openai|google|anthropic|deepseek|moonshotai|xai|qwen|reasoning)\.ts|shared\/types\/reasoning\.d\.ts)$/,
      tests: providerReasoningWiringTests,
    },
    {
      pattern: /^shared\/utils\/reasoning\.ts$/,
      tests: [
        ...providerReasoningWiringTests,
        'tests/unit/composables/chat-input.spec.ts',
        'tests/unit/components/ChatInput.spec.ts',
        'tests/unit/components/ChatInput/ToolsMenu/ReasoningSection.spec.ts',
        'tests/unit/components/ChatInput/ToolsMenu.spec.ts',
        'tests/unit/components/ChatInput/ModelsTrigger/ModelItem.spec.ts',
        'tests/unit/components/ChatInput/ModelsTrigger/ModelDetail.spec.ts',
        'tests/integration/api/chats-message-id-stream.spec.ts',
        'tests/integration/api/chats-duplicate-message.spec.ts',
      ],
    },
    {
      pattern: /^tests\/unit\/providers\/reasoning-control-state\.spec\.ts$/,
      tests: ['tests/unit/providers/reasoning-control-state.spec.ts'],
    },
    {
      pattern: /^providers\/qwen\.ts$/,
      tests: ['tests/unit/utils/providers/qwen.spec.ts'],
    },
    {
      pattern: /^server\/utils\/providers\/moonshotai-web-search\.ts$/,
      tests: moonshotWebSearchTests,
    },
    {
      pattern: /^server\/utils\/providers\/deepseek-web-search\.ts$/,
      tests: deepseekWebSearchTests,
    },
    {
      pattern: /^shared\/utils\/chat-message-limits\.ts$/,
      tests: [
        'tests/unit/utils/chats/request-schema.spec.ts',
        'tests/unit/utils/pasted-text.spec.ts',
        'tests/unit/components/ChatInput.spec.ts',
        'tests/integration/api/chats-research-start.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/chats\/request-schema\.ts$/,
      tests: [
        'tests/integration/api/chats-message-id-stream.spec.ts',
        'tests/integration/api/chats-new.spec.ts',
        'tests/unit/utils/chats/request-schema.spec.ts',
        'tests/integration/api/chats-external-search-validation.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/Chat\/GeneratedImage\.vue$/,
      tests: [
        'tests/unit/components/Chat/GeneratedImage.spec.ts',
        'tests/e2e/chat/gateway-image-generation.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/Chat\/ImagePreview\.client\.vue$/,
      tests: [
        'tests/unit/components/Chat/ImagePreview.client.spec.ts',
        'tests/unit/composables/image-zoom.spec.ts',
        'tests/unit/components/Chat/Reasoning/ConnectorThumbnail.spec.ts',
        'tests/unit/components/Chat/GeneratedImage.spec.ts',
        'tests/unit/components/Chat/Files.spec.ts',
      ],
    },
    {
      pattern: /^app\/composables\/image-zoom\.ts$/,
      tests: [
        'tests/unit/composables/image-zoom.spec.ts',
        'tests/unit/components/Chat/ImagePreview.client.spec.ts',
      ],
    },
    {
      pattern:
        /^(app\/components\/Pwa\/Refresher\.client\.vue|app\/composables\/pwa-auto-refresh\.ts)$/,
      tests: [
        'tests/unit/components/Pwa/Refresher.spec.ts',
        'tests/unit/composables/pwa-auto-refresh.spec.ts',
      ],
    },
    {
      pattern: modelsTriggerPattern,
      tests: modelsTriggerTests,
    },
    {
      pattern:
        /^(app\/components\/ProviderIcon\.vue|shared\/utils\/provider-meta\.ts|server\/db\/schemas\/keys\.ts)$/,
      tests: [
        ...userKeysTests,
        ...keysApiTests,
        'tests/integration/api/chats-title.spec.ts',
        ...messageUsageTests,
        ...modelsTriggerTests,
      ],
    },
    {
      pattern: /^app\/utils\/generated-images\.ts$/,
      tests: [
        'tests/unit/utils/generated-images.spec.ts',
        'tests/unit/utils/message-part-spacing.spec.ts',
      ],
    },
    {
      pattern: /^app\/utils\/(message-part-spacing|artifact-parts|code-execution-ui)\.ts$/,
      tests: [
        'tests/unit/utils/message-part-spacing.spec.ts',
        'tests/unit/utils/artifact-parts.spec.ts',
      ],
    },
    {
      pattern: /^app\/utils\/chat-failure-notice\.ts$/,
      tests: ['tests/unit/utils/chat-failure-notice.spec.ts'],
    },
    {
      pattern: /^app\/components\/Chat\/ErrorCard\.vue$/,
      tests: ['tests/unit/components/Chat/ErrorCard.spec.ts'],
    },
    {
      pattern: /^(app\/.+\.vue|pnpm-workspace\.yaml)$/,
      tests: ['tests/unit/config/vapor-template-auto-imports.spec.ts'],
    },
    {
      pattern:
        /^(pnpm-workspace\.yaml|app\/app\.vue|app\/pages\/chats\/(new|\[slug\])\.vue|app\/components\/(Chat\/Container|ui\/Bubble|Logo|Welcome|Sidebar\/NewChat)\.vue)$/,
      tests: ['tests/e2e/chat/new-chat-navigation.spec.ts'],
    },
    {
      pattern:
        /^(app\/components\/ChatInput\.client\.vue|app\/pages\/chats\/new\.vue|app\/composables\/(chat-input|user-setting|preference-storage|model)\.ts|app\/plugins\/10\.user-settings-sync\.client\.ts|shared\/utils\/reasoning\.ts|tests\/e2e\/chat\/reasoning-default\.spec\.ts)$/,
      tests: ['tests/e2e/chat/reasoning-default.spec.ts'],
    },
    {
      pattern:
        /^(server\/utils\/push\.ts|server\/utils\/push-protocol\.ts|server\/api\/v1\/push\/.*\.ts|app\/composables\/(push-notifications|notification-prompt|push-toggle)\.ts|app\/components\/NotificationPrompt\.client\.vue|app\/components\/ui\/Alert\.vue|app\/layouts\/chat\.vue|server\/db\/schemas\/push-subscriptions\.ts|server\/plugins\/push-subscription-sweep\.ts|app\/service-worker\/.*\.ts|app\/plugins\/push-navigation\.client\.ts|app\/components\/Sidebar\/(AuthCta|PushToggle\.client)\.vue)$/,
      tests: pushNotificationTests,
    },
    {
      pattern:
        /^server\/utils\/(email|auth|auth-instance|auth-rate-limit|auth-captcha|auth-hosts|auth-secondary-storage|keys-rate-limit)\.ts$/,
      tests: [...emailTests, ...authSecurityTests],
    },
    {
      pattern: /^server\/db\/schemas\/auth\.ts$/,
      tests: ['tests/unit/db/accounts-provider-account-id.spec.ts'],
    },
    {
      pattern:
        /^server\/api\/v1\/chats\/\[slug\]\/(index\.post|title\.patch)\.ts$/,
      tests: [
        ...chatStreamBranchTests,
        'tests/integration/api/chats-title.spec.ts',
        'tests/integration/api/chats-chat-search-tools.spec.ts',
        'tests/integration/api/chats-memory.spec.ts',
        'tests/integration/api/chats-carried-files.spec.ts',
        'tests/integration/api/chats-gateway-images.spec.ts',
        'tests/unit/utils/ai/image-generation-openai.spec.ts',
        ...projectKnowledgeRetrievalTests,
      ],
    },
    {
      pattern: /^app\/composables\/chat-title\.ts$/,
      tests: ['tests/integration/api/chats-title.spec.ts'],
    },
    {
      pattern:
        /^(app\/composables\/(model|selected-model-info|gateway-catalog|chat-title)\.ts|shared\/utils\/model-selection\.ts)$/,
      tests: [...modelSelectionTests, ...modelsTriggerTests],
    },
    {
      pattern:
        /^(shared\/(types\/gateways\.d\.ts|utils\/(gateways|gateway-(capabilities|model-id|pricing)|model-selection|provider-meta)\.ts))$/,
      tests: [
        ...gatewaySharedTests,
        ...gatewayCatalogTests,
        ...gatewayChatTests,
        ...modelsTriggerTests,
      ],
    },
    {
      pattern:
        /^(server\/utils\/gateways\/.+\.ts|server\/api\/v1\/gateways\/.+|app\/composables\/gateway-catalog\.ts)$/,
      tests: [...gatewayCatalogTests, ...gatewayChatTests],
    },
    {
      pattern: /^app\/composables\/user-setting\.ts$/,
      tests: [
        ...profileSettingsTests,
        ...modelsTriggerTests,
        'tests/e2e/profile/preferences.spec.ts',
      ],
    },
    {
      pattern: /^app\/composables\/user-keys\.ts$/,
      tests: [...userKeysTests, ...keysApiTests],
    },
    {
      pattern:
        /^(server\/api\/v1\/profiles\/keys(\/.*)?\.ts|server\/utils\/keys-rate-limit\.ts|server\/db\/schemas\/keys\.ts|app\/pages\/profile\/keys\.vue|app\/components\/Profile\/Keys\/.*\.vue)$/,
      tests: [...keysApiTests, ...userKeysTests],
    },
    {
      pattern:
        /^(app\/composables\/(key-guide-analytics|video-watch-analytics)\.ts|app\/utils\/(key-guide-video|key-guide-surface)\.ts|app\/components\/content\/KeyGuideArticle\.vue|shared\/utils\/(key-guide-schema|iso-datetime)\.ts|content\.config\.ts|content\/key-guides\/.*|public\/key-guides\/.*)$/,
      tests: profileKeyGuideTests,
    },
    {
      pattern: /^app\/composables\/clipboard\.ts$/,
      tests: [
        'tests/unit/composables/clipboard.spec.ts',
        'tests/unit/components/ui/Form/PasteButton.spec.ts',
        'tests/unit/components/Profile/Connectors/ConnectDialog.client.spec.ts',
        ...keysApiTests,
      ],
    },
    {
      pattern: /^(app\/components\/ui\/Form\/PasteButton\.vue|app\/components\/Profile\/(Keys\/(ProviderKeyCard|CloudflareGateway)\.vue|Connectors\/ConnectDialog\.client\.vue))$/,
      tests: [
        'tests/unit/components/ui/Form/PasteButton.spec.ts',
        'tests/unit/components/Profile/Keys/ProviderKeyCard.spec.ts',
        'tests/unit/components/Profile/Keys/CloudflareGateway.spec.ts',
        'tests/unit/components/Profile/Connectors/ConnectDialog.client.spec.ts',
      ],
    },
    {
      pattern: /^server\/(api|routes)\/.*\.(ts|js|mjs)$/,
      tests: ['tests/unit/server/routes/waf-blocked-paths.spec.ts'],
    },
    {
      pattern: /^app\/composables\/(standalone-display|current-url-copy|ios-in-app-browser)\.ts$/,
      tests: [
        'tests/unit/composables/standalone-display.spec.ts',
        'tests/unit/composables/current-url-copy.spec.ts',
        'tests/unit/components/Chat/ContextPanel.spec.ts',
      ],
    },
    {
      pattern: /^(server\/utils\/email-template\.ts|app\/emails\/.*)$/,
      tests: [
        ...emailTests,
        'tests/unit/utils/account/security-emails.spec.ts',
        'tests/unit/utils/auth.spec.ts',
      ],
    },
    {
      pattern: /^app\/composables\/turnstile\.ts$/,
      tests: turnstileTests,
    },
    {
      pattern: /^app\/components\/Auth\/Turnstile\.client\.vue$/,
      tests: turnstileTests,
    },
    {
      pattern: /^app\/components\/Auth\/(OAuthNotice|CheckEmail)\.vue$/,
      tests: turnstileTests,
    },
    {
      pattern: /^app\/types\/turnstile\.d\.ts$/,
      tests: turnstileTests,
    },
    {
      pattern: /^app\/composables\/captcha\.ts$/,
      tests: turnstileTests,
    },
    {
      pattern: /^app\/pages\/\(auth\)\/(signin|signup|reset-password)\.vue$/,
      tests: turnstileTests,
    },
    {
      pattern:
        /^(shared\/utils\/auth-redirect\.ts|app\/middleware\/00\.auth\.global\.ts|app\/composables\/social-oauth\.ts|app\/pages\/\(auth\)\/(signin|signup|2fa)\.vue|tests\/e2e\/helpers\/auth\.ts)$/,
      tests: postAuthRedirectTests,
    },
    {
      pattern: /^nuxt\.config\.ts$/,
      tests: [
        ...seoTests,
        ...agentDiscoveryTests,
        ...cookieConsentTests,
      ],
    },
    {
      pattern:
        /^(server\/routes\/\.well-known\/.*|server\/utils\/(agent-discovery|content)\/.*|server\/plugins\/agent-discovery-(landing|page-components)\.ts|config\/(agent-discovery-routes|mcp-server|site-url)\.ts|skills\/.*|content\/index\.md)$/,
      tests: agentDiscoveryTests,
    },
    {
      pattern:
        /^(server\.json|plugins\/besidka\/.*|\.cursor-plugin\/marketplace\.json)$/,
      tests: ['tests/unit/config/mcp-registry-manifests.spec.ts'],
    },
    {
      pattern: /^app\/pages\/\((auth|legal)\)\/.*\.vue$/,
      tests: ['tests/unit/config/seo-pages.spec.ts'],
    },
    {
      pattern: /^content\/legal\/.*\.md$/,
      tests: ['tests/unit/config/seo-pages.spec.ts'],
    },
    {
      pattern: /^content\/(index|guides\/.*|legal\/.*|key-guides\/.*)\.md$/,
      tests: ['tests/unit/config/content-frontmatter.spec.ts'],
    },
    {
      pattern: /^content\/legal\/.*\.md$/,
      tests: ['tests/unit/content/legal-pages.spec.ts'],
    },
    {
      pattern: /^(server\/utils\/legal\/.*|server\/api\/v1\/profiles\/consent\/.*|server\/api\/v1\/profiles\/keys\/(deepseek|moonshotai|qwen)\/index\.delete|shared\/utils\/legal-consent|shared\/types\/legal-consent\.d|tests\/setup\/(fixtures|mocks)\/legal-consent)\.ts$/,
      tests: [
        'tests/unit/server/utils/legal/consent.spec.ts',
        'tests/unit/server/utils/legal/consent-text-version.spec.ts',
        'tests/unit/server/utils/legal/consent-version.spec.ts',
        'tests/integration/api/legal-consent.spec.ts',
        'tests/unit/utils/memory/resolve-model.spec.ts',
        'tests/unit/utils/projects/memory-refresh.spec.ts',
        'tests/unit/utils/memory/extract-sweep.spec.ts',
        'tests/unit/utils/memory/backfill-sweep.spec.ts',
        'tests/unit/utils/memory/extract-text.spec.ts',
      ],
    },
    {
      pattern: /^(app\/components\/Legal\/.*\.vue|app\/composables\/(legal-consent|account-deletion)\.ts|app\/components\/Profile\/Security\/PrivacyConsent\.vue)$/,
      tests: [
        'tests/unit/components/Legal/ConsentModal.spec.ts',
        'tests/unit/server/utils/legal/consent-text-version.spec.ts',
        'tests/unit/components/Legal/TransferConsentModal.spec.ts',
        'tests/unit/components/Profile/Security/PrivacyConsent.spec.ts',
        'tests/unit/composables/legal-consent.spec.ts',
        'tests/unit/pages/profile/security.spec.ts',
        'tests/unit/components/ChatInput.spec.ts',
        'tests/unit/plugins/user-settings-sync.client.spec.ts',
        'tests/unit/composables/auth.spec.ts',
      ],
    },
    {
      pattern: /^(app\/components\/Legal\/ChangeNotice\.client\.vue|app\/composables\/legal-notice-banner\.ts|app\/plugins\/legal-notice-legacy-cleanup\.client\.ts|app\/layouts\/chat\.vue|app\/pages\/chats\/\[slug\]\.vue|shared\/utils\/(legal-notices|legal-change-history)\.ts)$/,
      tests: [
        'tests/unit/components/Legal/ChangeNotice.spec.ts',
        'tests/unit/composables/legal-notice-banner.spec.ts',
        'tests/unit/plugins/legal-notice-legacy-cleanup.client.spec.ts',
        'tests/unit/layouts/chat.spec.ts',
      ],
    },
    {
      pattern: /^server\/api\/v1\/(chats\/new\/index\.put|chats\/\[slug\]\/(index\.post|title\.patch)|chats\/branch\/index\.post|memory\/instruct\/preview\.post|memory\/entries\/index\.post|projects\/\[id\]\/instructions\.patch|files\/upload\.put)\.ts$/,
      tests: ['tests/integration/api/legal-consent.spec.ts'],
    },
    {
      pattern: /^(content\/guides\/.*\.md|app\/pages\/(byok|memory)\.vue|content\.config\.ts|app\/components\/LegalDocument\.vue)$/,
      tests: [
        'tests/unit/config/seo-pages.spec.ts',
        'tests/unit/utils/landing-jsonld.spec.ts',
      ],
    },
    {
      pattern: /^(scripts\/mcp-version-guard\.mjs|config\/mcp-surface\.json|server\.json|config\/mcp-server\.ts)$/,
      tests: ['tests/unit/scripts/mcp-version-guard.spec.ts'],
    },
    {
      pattern: /^(config\/(mcp-surface\.json|mcp-server\.ts)|server\/(mcp\/tools\/.*|utils\/(mcp\/tool-scopes|besidka-tools\/.*))\.ts)$/,
      tests: ['tests/unit/config/mcp-surface.spec.ts'],
    },
    {
      pattern: /^(config\/besidka-tools-surface\.json|server\/(mcp\/tools\/.*|utils\/(mcp\/tool-scopes|besidka-tools\/.*))\.ts)$/,
      tests: besidkaToolsTests,
    },
    {
      pattern:
        /^(shared\/utils\/(besidka-tool-permissions|tool-approval-policy)\.ts|shared\/utils\/features\/registry\.ts|server\/utils\/besidka-tools\/(permissions|route|registry|types)\.ts|server\/utils\/tool-approval\/continuation\.ts|server\/api\/v1\/besidka-tools\/.*\.ts|app\/(composables|utils)\/besidka-tool-permissions\.ts|app\/components\/Profile\/BesidkaTools\/.*\.vue|app\/components\/Search\/Modal\.client\.vue|app\/pages\/profile\/labs\.vue|app\/utils\/labs\.ts|tests\/setup\/helpers\/(memory-extraction-db|connectors-oauth|skills-route)\.ts)$/,
      tests: besidkaToolPermissionsTests,
    },
    {
      pattern:
        /^(shared\/utils\/(besidka-tool-permissions|tool-approval-policy|tool-index)\.ts|server\/utils\/ai\/tool-index(-prefetch)?\.ts|server\/utils\/besidka-tools\/.*\.ts|server\/utils\/tool-approval\/(send|continuation|policy|grants)\.ts|app\/components\/Chat\/ContextPanelApprovals\.vue|app\/components\/Profile\/BesidkaTools\/Permissions\.vue|app\/composables\/tool-approval-grants\.ts|shared\/types\/tool-approval-grants\.d\.ts|server\/utils\/ai\/tool-loop\.ts|server\/utils\/connectors\/send-tools\.ts|server\/api\/v1\/chats\/\[slug\]\/(index\.post|besidka-tools\/.*)\.ts|app\/composables\/(composer-besidka-tools|chat)\.ts|app\/components\/ChatInput(\.client|\/ConnectorPicker\.client)\.vue|app\/components\/Chat\/Reasoning(\/ApprovalStep|\/ApprovalDetails)?\.vue|server\/utils\/memory\/extract-input\.ts|shared\/utils\/tool-approval-parts\.ts|app\/utils\/(tool-approval-step|reasoning|reasoning-step-icons)\.ts|app\/pages\/chats\/new\.vue|app\/composables\/composer-connectors\.ts|server\/utils\/chats\/test\/tool-approval-fixture\.ts|server\/api\/v1\/chats\/test\/index\.get\.ts|shared\/utils\/chat-test-errors\.ts)$/,
      tests: besidkaToolsChatTests,
    },
    {
      pattern: /^(scripts\/indexnow-submit\.mjs|server\/routes\/indexnow-key\.txt\.ts)$/,
      tests: ['tests/unit/scripts/indexnow-submit.spec.ts'],
    },
    {
      pattern: /^scripts\/(linear-request|linear-docs-sync|linear-docs-split)\.mjs$/,
      tests: [
        'tests/unit/scripts/linear-request.spec.ts',
        'tests/unit/scripts/linear-docs-split.spec.ts',
      ],
    },
    {
      pattern: /^(scripts\/artifact-evals\.mjs|tests\/evals\/artifacts\/prompts\.json|tests\/e2e\/artifacts\/evals-render\.spec\.ts|playwright\.evals\.config\.ts)$/,
      tests: ['tests/unit/scripts/artifact-evals.spec.ts'],
    },
    {
      pattern: /^scripts\/artifact-rollout-report\.mjs$/,
      tests: ['tests/unit/scripts/artifact-rollout-report.spec.ts'],
    },
    {
      pattern: /^(scripts\/ci\/resolve-preview-build-source\.mjs|\.github\/workflows\/preview-build\.yml)$/,
      tests: ['tests/unit/scripts/resolve-preview-build-source.spec.ts'],
    },
    {
      pattern: /^(scripts\/ci\/resolve-(production-test|preview-build)-source\.mjs|\.github\/workflows\/(production|preview-build)\.yml)$/,
      tests: ['tests/unit/scripts/resolve-production-test-source.spec.ts'],
    },
    {
      pattern: /^(tests\/unit\/workflows\/preview-deploy\.spec\.ts|\.github\/workflows\/(preview-deploy|preview-cleanup|production|claude|claude-code-review|update|linear-docs-sync)\.yml|\.github\/actions\/[^/]+\/action\.yml)$/,
      tests: ['tests/unit/workflows/preview-deploy.spec.ts'],
    },
    {
      pattern: /^content\/legal\/cookie-policy\.md$/,
      tests: cookieConsentTests,
    },
    {
      pattern: /^content\/index\.md$/,
      tests: [
        ...landingTests,
        'tests/unit/utils/landing-jsonld.spec.ts',
        'tests/unit/config/seo-pages.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/landing\/.*\.vue$/,
      tests: landingTests,
    },
    {
      pattern: /^app\/components\/content\/Home.*\.vue$/,
      tests: landingTests,
    },
    {
      pattern: /^server\/utils\/landing\/.*\.ts$/,
      tests: landingTests,
    },
    {
      pattern:
        /^(shared\/utils\/utm\.ts|shared\/types\/analytics\.d\.ts|server\/utils\/analytics\/.*\.ts|server\/db\/schemas\/attribution\.ts|app\/composables\/(utm-attribution|landing-analytics|video-watch-analytics)\.ts|app\/plugins\/utm-attribution\.client\.ts)$/,
      tests: utmAttributionTests,
    },
    {
      pattern:
        /^(shared\/utils\/auth-redirect\.ts|app\/middleware\/00\.auth\.global\.ts|app\/pages\/\(auth\)\/(signin|signup|2fa)\.vue|app\/pages\/profile\/keys\.vue)$/,
      tests: authNextRedirectTests,
    },
    {
      pattern:
        /^(app\/pages\/guides\/.*\.vue|shared\/utils\/(external-url|iso-datetime|video)\.ts|app\/utils\/(landing-jsonld|utc-date)\.ts|content\/key-guides\/.*\.md)$/,
      tests: keyGuideTests,
    },
    {
      pattern: /^server\/api\/v1\/(events|stats)\/.*\.ts$/,
      tests: landingTests,
    },
    {
      pattern: /^server\/utils\/cross-site-guard\.ts$/,
      tests: [
        'tests/unit/utils/cross-site-guard.spec.ts',
        'tests/integration/api/events-ingest.spec.ts',
        'tests/integration/api/push-subscriptions.spec.ts',
        'tests/integration/api/chats-shares-branch.spec.ts',
        'tests/integration/api/chats-shares-handoff.spec.ts',
      ],
    },
    {
      pattern: /^server\/plugins\/landing-cache-refresh\.ts$/,
      tests: landingTests,
    },
    {
      pattern: /^server\/plugins\/ssr-html-no-store\.ts$/,
      tests: ['tests/integration/server/ssr-html-no-store-plugin.spec.ts'],
    },
    {
      pattern: /^app\/plugins\/01\.build-freshness\.client\.ts$/,
      tests: ['tests/unit/plugins/01.build-freshness.client.spec.ts'],
    },
    {
      pattern:
        /^(app\/plugins\/02\.chunk-error\.client\.ts|app\/utils\/chunk-load-error\.ts|app\/app\.vue)$/,
      tests: [
        'tests/unit/plugins/02.chunk-error.client.spec.ts',
        'tests/unit/utils/chunk-load-error.spec.ts',
      ],
    },
    {
      pattern: /^app\/utils\/chat-request-errors\.ts$/,
      tests: [
        'tests/unit/utils/chat-request-errors.spec.ts',
        'tests/unit/composables/chat.recovery.spec.ts',
      ],
    },
    {
      pattern:
        /^(server\/utils\/chats\/(errors|provider-error-summary|stream-error-telemetry)\.ts|server\/utils\/providers\/google\.ts)$/,
      tests: ['tests/integration/api/chats-stream-lifecycle.spec.ts'],
    },
    {
      pattern: /^(app\/(plugins\/webmcp\.client|utils\/webmcp|types\/webmcp\.d)\.ts|config\/agent-discovery-routes\.ts)$/,
      tests: [
        'tests/unit/plugins/webmcp.client.spec.ts',
        'tests/unit/utils/webmcp.spec.ts',
      ],
    },
    {
      pattern: /^server\/middleware\/evlog-auth\.ts$/,
      tests: [
        'tests/integration/api/stats.spec.ts',
        'tests/unit/server/middleware/evlog-auth.spec.ts',
        'tests/unit/server/utils/auth-instance.spec.ts',
      ],
    },
    {
      pattern: /^shared\/types\/landing\.d\.ts$/,
      tests: landingTests,
    },
    {
      pattern: /^app\/pages\/index\.vue$/,
      tests: [
        'tests/unit/utils/landing-jsonld.spec.ts',
        'tests/unit/utils/canonical.spec.ts',
      ],
    },
    {
      pattern: /^server\/api\/v1\/stats\/.*\.ts$/,
      tests: landingTests,
    },
    {
      pattern: /^server\/plugins\/landing-cache-refresh\.ts$/,
      tests: landingTests,
    },
    {
      pattern: /^shared\/types\/landing\.d\.ts$/,
      tests: landingTests,
    },
    {
      pattern: /^server\/routes\/videos\/.*\.ts$/,
      tests: landingTests,
    },
    {
      pattern: /^shared\/utils\/video\.ts$/,
      tests: landingTests,
    },
    {
      pattern: /^shared\/types\/video\.d\.ts$/,
      tests: landingTests,
    },
    {
      pattern: /^app\/composables\/landing-video-thumbnails\.ts$/,
      tests: landingTests,
    },
    {
      pattern:
        /^(app\/components\/Video\/.*\.vue|app\/composables\/(video-timeline|video-player-preferences|video-speed|video-quality)\.ts|app\/plugins\/video-legacy-plyr-cleanup\.client\.ts|app\/utils\/(videojs-elements|video-speed)\.ts|app\/types\/video-player\.d\.ts|app\/assets\/css\/video-player-theme\.css)$/,
      tests: [...landingTests, ...profileKeyGuideTests],
    },
    {
      pattern: /^app\/components\/Chat\/(Message|ContextMenu\.client)\.vue$/,
      tests: contextMenuTests,
    },
    {
      pattern:
        /^app\/(composables\/(file-download|ios-in-app-browser)|utils\/file-share)\.ts$/,
      tests: [
        'tests/unit/composables/file-download.spec.ts',
        'tests/unit/utils/file-share.spec.ts',
        'tests/unit/composables/ios-in-app-browser.spec.ts',
        'tests/unit/utils/artifact-export.spec.ts',
        'tests/unit/composables/diagram-export.spec.ts',
        'tests/unit/components/prose/MermaidActionMenu.spec.ts',
        'tests/unit/components/Profile/Security/BackupCodes.spec.ts',
        'tests/unit/components/History/DocumentRow.spec.ts',
        'tests/unit/components/Chat/Files.spec.ts',
        'tests/unit/components/Chat/GeneratedImage.spec.ts',
        'tests/unit/components/Chat/ImagePreview.client.spec.ts',
        'tests/unit/components/Chat/TextFileModal.client.spec.ts',
        'tests/unit/components/Chat/DocumentPreview.spec.ts',
        'tests/unit/components/Chat/Document.spec.ts',
        'tests/unit/components/ChatInput/Files/Modal/Select/Grid/View.spec.ts',
        'tests/unit/components/ChatInput/Files/Modal/Select/List/View.spec.ts',
      ],
    },
    {
      pattern:
        /^app\/(composables\/top-modal-dialog\.ts|components\/ui\/Messages\.vue)$/,
      tests: topModalDialogTests,
    },
    {
      pattern: /^app\/composables\/message-copy\.ts$/,
      tests: [
        'tests/unit/composables/message-copy.spec.ts',
        ...contextMenuTests,
      ],
    },
    {
      pattern: /^app\/utils\/clipboard-html\.ts$/,
      tests: [
        'tests/unit/utils/clipboard-html.spec.ts',
        ...contextMenuTests,
      ],
    },
    {
      pattern: /^shared\/utils\/model-citation-markers\.ts$/,
      tests: [
        'tests/unit/utils/model-citation-markers.spec.ts',
        'tests/unit/components/Chat/Reasoning.spec.ts',
      ],
    },
    {
      pattern: /^shared\/utils\/markdown-plain\.ts$/,
      tests: [...contextMenuTests, ...messageUsageTests],
    },
    {
      pattern:
        /^(shared\/utils\/message-format\.ts|shared\/utils\/message-metadata\.ts|server\/utils\/ai\/(message-usage|google-search-cost|web-search-cost|search-usage)\.ts|shared\/types\/message-usage\.d\.ts|server\/utils\/ai\/cost-map\.ts|shared\/types\/providers\.d\.ts)$/,
      tests: [
        ...messageUsageTests,
        ...chatStreamBranchTests,
        ...gatewayChatTests,
      ],
    },
    {
      pattern: /^app\/pages\/chats\/\[slug\]\.vue$/,
      tests: [
        ...messageUsageTests,
        ...chatTestEndpointTests,
        'tests/unit/composables/chat-image-ui.spec.ts',
        'tests/unit/composables/haptics.spec.ts',
        'tests/unit/components/Chat/OmittedContextFiles.spec.ts',
      ],
    },
    {
      pattern: /^(app\/app\.vue|app\/layouts\/shared\.vue)$/,
      tests: [
        'tests/e2e/shared/context-menu-clipping.spec.ts',
        ...contextMenuTests,
      ],
    },
    {
      pattern: /^app\/app\.vue$/,
      tests: ['tests/unit/utils/canonical.spec.ts'],
    },
    {
      pattern: /^server\/api\/v1\/shared\/test\/.*\.ts$/,
      tests: chatShareTests,
    },
    {
      pattern: /^server\/utils\/chats\/test\/.*\.ts$/,
      tests: [...chatTestEndpointTests, ...chatShareTests],
    },
    {
      pattern:
        /^(server\/utils\/chats\/share(-pii-check|-public-parts)?\.ts|shared\/utils\/share-pii\.ts|shared\/types\/share-pii\.d\.ts|server\/utils\/files\/rewrite-share-file-urls\.ts|server\/utils\/shared\/author-avatar\.ts|app\/composables\/chat-share\.ts|app\/components\/Chat\/ShareModal\.client\.vue|app\/types\/chat-share\.d\.ts|app\/composables\/ios-in-app-browser\.ts|app\/pages\/shared\/\[slug\]\.vue|shared\/utils\/og-description\.ts)$/,
      tests: chatShareTests,
    },
    {
      pattern: /^app\/pages\/shared\/\[slug\]\.vue$/,
      tests: [
        ...contextMenuTests,
        'tests/unit/utils/message-metadata.spec.ts',
      ],
    },
    {
      pattern: /^server\/api\/v1\/chats\/shares\/.*\.ts$/,
      tests: chatShareTests,
    },
    {
      pattern: /^server\/api\/v1\/chats\/\[slug\]\/share\/.*\.ts$/,
      tests: chatShareTests,
    },
    {
      pattern: /^server\/api\/v1\/chats\/shared\/.*\.ts$/,
      tests: chatShareTests,
    },
    {
      pattern: /^server\/api\/v1\/shared\/\[slug\]\/.*\.ts$/,
      tests: chatShareTests,
    },
    {
      pattern: /^server\/utils\/search\/(?!brave\.ts|exa\.ts|freshness\.ts|iso-date\.ts|search-budget\.ts|search-error\.ts|types\.d\.ts).*\.ts$/,
      tests: [...messageSearchTests, ...chatSearchToolTests],
    },
    {
      pattern: /^(server\/utils\/memory\/tools\/.*\.ts|server\/utils\/ai\/(chat-search-tools|memory-tools)\.ts)$/,
      tests: chatSearchToolTests,
    },
    {
      pattern: /^server\/utils\/(knowledge\/(injection-screening|unscreened)|search\/injection-screening)\.ts$/,
      tests: jevInjectionScreeningTests,
    },
    {
      pattern: /^shared\/utils\/past-chat-retrieval\.ts$/,
      tests: [...pastChatRetrievalTests, ...searchStepTests],
    },
    {
      pattern: /^(server\/utils\/jev\/.*|shared\/utils\/jev-(policy|schemas))\.ts$/,
      tests: [
        ...jevFoundationTests,
        ...skillJevScreeningTests,
        ...pastChatRetrievalTests,
        ...profileSettingsTests,
        ...typesafeRolesUiTests,
      ],
    },
    {
      pattern: /^(shared\/utils\/(auto-web-search|jev-policy)\.ts|shared\/types\/message-usage\.d\.ts|server\/utils\/(chats\/auto-web-search|jev\/send-path|ai\/message-usage)\.ts|server\/api\/v1\/chats\/(new\/index\.put|\[slug\]\/index\.post)\.ts|app\/composables\/(auto-web-search|chat)\.ts|app\/components\/Chat\/AutoWebSearchChip\.vue|app\/components\/ChatInput(\.client\.vue|\/(ToolsMenu(\.client|\/[A-Za-z]+)|SettingTile)\.vue)|app\/pages\/chats\/(new|\[slug\])\.vue)$/,
      tests: autoWebSearchTests,
    },
    {
      pattern: /^(app\/composables\/typesafe-roles\.ts|app\/utils\/typesafe-roles\.ts|app\/components\/Profile\/Keys\/(TypesafeChecks|MemoryChecksInfo)\.vue|app\/components\/Profile\/Memory\/ExtraChecks\.vue)$/,
      tests: typesafeRolesUiTests,
    },
    {
      pattern: /^server\/utils\/memory\/jev-check\.ts$/,
      tests: [
        ...memoryJevTests,
        'tests/integration/api/profile-keys-typesafe.spec.ts',
      ],
    },
    {
      pattern: /^(server\/utils\/memory\/(entries|entry-slug|entry-sources|about-me-migration|rate-limit)\.ts|server\/api\/v1\/memory\/.*\.ts|shared\/types\/memory-api\.d\.ts)$/,
      tests: [
        ...memoryEntriesTests,
        ...memoryToolTests,
        ...memoryChatDeletionTests,
      ],
    },
    {
      pattern: /^(shared\/utils\/memory-tokens|server\/utils\/memory\/(index-builder|runtime-settings|about-me-migration|chat-context|persist-redaction))\.ts$/,
      tests: memoryToolTests,
    },
    {
      pattern: /^(server\/utils\/memory\/chat-deletion\.ts|server\/api\/v1\/chats\/history\/delete\/bulk\.post\.ts)$/,
      tests: memoryChatDeletionTests,
    },
    {
      pattern: /^server\/utils\/projects\/legacy-memory\.ts$/,
      tests: [
        'tests/unit/utils/projects/legacy-memory.spec.ts',
        'tests/integration/api/chats-project-instructions.spec.ts',
        'tests/integration/api/chats-memory.spec.ts',
      ],
    },
    {
      pattern: /^tests\/setup\/helpers\/memory-db\.ts$/,
      tests: [
        ...memoryEntriesTests,
        ...memoryToolTests,
        ...memoryChatDeletionTests,
      ],
    },
    {
      pattern: /^app\/(utils\/memory-step|types\/memory-step\.d)\.ts$|^app\/components\/Chat\/Reasoning\/MemoryStep\.vue$/,
      tests: memoryStepTests,
    },
    {
      pattern: /^tests\/setup\/helpers\/search-index-db\.ts$/,
      tests: [...messageSearchTests, ...chatSearchToolTests],
    },
    {
      pattern:
        /^(server\/utils\/search\/(brave|exa|freshness|iso-date|search-budget|search-error|types\.d)\.ts|shared\/utils\/exa-search-level\.ts|server\/utils\/ai\/external-search-cost\.ts)$/,
      tests: externalSearchTests,
    },
    {
      pattern: /^server\/utils\/search\/search-error\.ts$/,
      tests: [
        ...externalSearchTests,
        'tests/unit/utils/providers/moonshotai-web-search.spec.ts',
      ],
    },
    {
      pattern: /^wrangler\.jsonc$/,
      tests: [
        'tests/unit/config/wrangler-search-rates.spec.ts',
        'tests/unit/config/wrangler-skills-rate-limit.spec.ts',
        'tests/unit/config/wrangler-previews.spec.ts',
        'tests/unit/config/wrangler-legal-notice-sweep.spec.ts',
        'tests/unit/utils/consents-rate-limit.spec.ts',
      ],
    },
    {
      pattern: /^server\/plugins\/message-search-index-sweep\.ts$/,
      tests: messageSearchTests,
    },
    {
      pattern: /^server\/utils\/custom-db-types\.ts$/,
      tests: messageSearchTests,
    },
    {
      pattern:
        /^server\/utils\/chats\/(insert-message|persist-user-message|branch)\.ts$/,
      tests: [
        ...messageSearchTests,
        ...chatShareTests,
        ...chatStreamBranchTests,
      ],
    },
    {
      pattern:
        /^(modules\/cookie-consent\/|app\/components\/Cookies\/|app\/components\/Sidebar\/Development\.vue$|app\/components\/LandingFooter\.vue$|i18n\/|app\/composables\/(preference-storage|theme-toggle|file-manager|user-setting|notification-prompt)\.ts$|app\/components\/ChatInput(\.client\.vue|\/ModelsTrigger\.vue)$|app\/plugins\/(cookie-consent-gate|cloudflare-web-analytics)\.client\.ts$|server\/api\/v1\/consents\/|server\/utils\/consents(-db|-rate-limit)?\.ts$|server\/db\/consent\/)/,
      tests: cookieConsentTests,
    },
    {
      pattern:
        /^(app\/components\/Sidebar\/ThemeSwitcher\.vue|app\/composables\/theme-toggle\.ts)$/,
      tests: [
        'tests/unit/components/ThemeSwitcher.spec.ts',
        'tests/unit/composables/theme-toggle.spec.ts',
        'tests/e2e/settings/theme.spec.ts',
        'tests/e2e/settings/theme-tokens.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/Sidebar\.client\.vue$/,
      tests: ['tests/unit/components/Sidebar.spec.ts'],
    },
    {
      pattern:
        /^(app\/components\/ui\/SidePanel[A-Za-z]*(\.client)?\.vue|app\/components\/ui\/SidePanel\/.*\.vue|app\/composables\/side-panel\.ts|app\/assets\/css\/main\.css|app\/utils\/(scroll-anchor|side-panel-demo)\.ts|app\/components\/(Sidebar|ChatInput)\.client\.vue|app\/app\.vue)$/,
      tests: sidePanelTests,
    },
    {
      pattern:
        /^(app\/components\/Chat\/CodeExecution(\/.*)?\.vue|app\/utils\/code-execution-ui\.ts|shared\/utils\/code-execution\.ts)$/,
      tests: [...codeExecutionTests, ...chatInputToolsTests],
    },
    {
      pattern:
        /^(server\/utils\/code-execution\/.*\.ts|server\/utils\/ai\/code-execution-cost\.ts|server\/utils\/providers\/(anthropic|openai|google)\.ts|server\/utils\/chats\/request-schema\.ts|providers\/(anthropic|openai|google)\.ts|shared\/utils\/code-execution\.ts|nuxt\.config\.ts|wrangler\.jsonc)$/,
      tests: codeExecutionServerTests,
    },
    {
      pattern: /^server\/api\/v1\/chats\/\[slug\]\/index\.post\.ts$/,
      tests: ['tests/integration/api/chats-code-execution.spec.ts'],
    },
    {
      pattern:
        /^(server\/utils\/chats\/context\/.*\.ts|server\/api\/v1\/chats\/\[slug\]\/(context|support-info)\.get\.ts|server\/api\/v1\/shared\/\[slug\]\/context\.get\.ts|shared\/types\/chat-context\.d\.ts|app\/components\/Chat\/ContextPanel(Item)?\.vue|app\/components\/Sidebar\/.*\.vue|app\/components\/Sidebar\.client\.vue|app\/composables\/(chat-context|chat-pin|chat-route|chat-debug-info|sidebar-pin-toggle)\.ts|app\/utils\/chat-context\.ts|tests\/setup\/helpers\/chat-context-db\.ts)$/,
      tests: chatContextTests,
    },
    {
      pattern:
        /^(app\/composables\/(search-modal|files-modal-handoff)\.ts|app\/components\/Search\/.*\.vue)$/,
      tests: searchModalTests,
    },
    {
      pattern: /^shared\/utils\/search\.ts$/,
      tests: [
        ...searchModalTests,
        ...messageSearchTests,
        'tests/unit/pages/chats/history/index.spec.ts',
        'tests/unit/utils/search.spec.ts',
      ],
    },
    {
      pattern:
        /^(packages\/doc-renderer\/|tests\/fixtures\/documents\/|tests\/setup\/helpers\/documents\.ts$|scripts\/(third-party-notices|doc-renderer-smoke)\.mjs$|shared\/utils\/files\.ts$|app\/utils\/knowledge-zip\.ts$)/,
      tests: documentRendererTests,
    },
    {
      pattern:
        /^(app\/(components\/Chat\/(Document|DocumentPreview|Document\/.*)\.vue|composables\/(document-(flow|render)|chat)\.ts|workers\/document-render\.ts|utils\/document-(parts|ui)\.ts|types\/document-render\.d\.ts)|server\/(api\/v1\/documents\/.*|capabilities\/(documents|index)\.ts|db\/schemas\/documents\.ts|utils\/documents\/(?!renderer\.ts$).*|utils\/chats\/(persist-user-message|share|share-public-parts|branch|lifecycle)\.ts|utils\/files\/(chat-deletion-cleanup|cleanup-expired-files|delete-files)\.ts|utils\/ai\/tool-loop\.ts|utils\/account\/purge-user-data\.ts|api\/v1\/shared\/\[slug\]\/index\.get\.ts|api\/v1\/chats\/shares\/\[slug\]\/branch\.post\.ts|api\/v1\/chats\/history\/delete\/bulk\.post\.ts)|shared\/utils\/(documents|message-metadata)\.ts|tests\/setup\/helpers\/documents-db\.ts)$/,
      tests: documentsChatTests,
    },
    {
      pattern:
        /^(app\/components\/ChatInput\/Files\/Modal(\.client)?\.vue|app\/components\/ChatInput\/Files\/Modal\/Select(\/.*)?\.vue|app\/composables\/(file-manager|document-preview)\.ts|app\/utils\/file-manager-sources\.ts|app\/types\/file-manager\.d\.ts|server\/api\/v1\/files\/index\.get\.ts|server\/utils\/files\/source-filter\.ts|tests\/setup\/helpers\/knowledge-db\.ts)$/,
      tests: documentsFileManagerTests,
    },
    {
      pattern:
        /^(app\/pages\/chats\/documents\/index\.vue|app\/components\/History\/(DocumentRow|BoxTabs|FilterButtons|PageShell)\.vue|app\/composables\/(documents-library|document-preview)\.ts|app\/components\/Search\/Modal\.client\.vue|server\/api\/v1\/documents\/index\.get\.ts|server\/utils\/documents\/library\.ts|shared\/utils\/documents\.ts)$/,
      tests: documentsLibraryTests,
    },
    {
      pattern:
        /^(server\/api\/v1\/chats\/test\/.*\.ts|server\/utils\/chats\/test\/document-.*\.ts|tests\/e2e\/chat\/create-document\.spec\.ts)$/,
      tests: ['tests/e2e/chat/create-document.spec.ts'],
    },
    {
      pattern:
        /^(workers\/doc-renderer\/|packages\/doc-renderer\/|server\/utils\/documents\/renderer\.ts$|wrangler\.jsonc$|tests\/setup\/helpers\/documents\.ts$|\.github\/workflows\/production\.yml$)/,
      tests: documentRendererWorkerTests,
    },
    {
      pattern: /^app\/assets\/css\/main\.css$/,
      tests: [
        'tests/e2e/settings/theme.spec.ts',
        'tests/e2e/settings/theme-tokens.spec.ts',
        'tests/e2e/profile/dark-touch-hover-contrast.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/ui\/Button\.vue$/,
      tests: [
        'tests/unit/components/ThemeSwitcher.spec.ts',
        'tests/e2e/settings/theme.spec.ts',
        'tests/e2e/chat/scroll-spacer.spec.ts',
      ],
    },
    {
      pattern: /^app\/composables\/chat-scroll-spacer\.ts$/,
      tests: [
        'tests/unit/composables/chat-scroll-spacer.spec.ts',
        'tests/e2e/chat/scroll-spacer.spec.ts',
        'tests/e2e/chat/chat-input-collapse-on-attach.spec.ts',
      ],
    },
    {
      pattern:
        /^(app\/composables\/visual-viewport-inset\.ts|app\/composables\/keyboard-inset-root\.ts)$/,
      tests: [
        'tests/unit/composables/visual-viewport-inset.spec.ts',
        'tests/unit/composables/chat-scroll-spacer.spec.ts',
        'tests/unit/composables/keyboard-inset-root.spec.ts',
        'tests/unit/components/ChatInput.spec.ts',
        'tests/unit/components/Chat/TextFileModal.client.spec.ts',
        'tests/e2e/search/keyboard-inset.spec.ts',
      ],
    },
    {
      pattern:
        /^(app\/assets\/css\/main\.css|app\/components\/Search\/Modal\.client\.vue|app\/components\/ChatInput\.client\.vue)$/,
      tests: [
        'tests/e2e/search/keyboard-inset.spec.ts',
        'tests/e2e/chat/composer-overlays-spacer.spec.ts',
      ],
    },
    {
      pattern:
        /^app\/components\/ChatInput\/(CommandPicker|ConnectorSuggestion|ToolApprovalChip)\.vue$/,
      tests: [
        'tests/e2e/chat/composer-overlays-spacer.spec.ts',
      ],
    },
    {
      pattern:
        /^app\/components\/(Chat\/Scroll\.client|ChatInput\.client|ChatInput\/ToolsMenu\.client|ChatInput\/ModelsTrigger|Ui\/Bubble)\.vue$/,
      tests: [
        'tests/e2e/chat/composer-menus-layer.spec.ts',
      ],
    },
    {
      pattern: /^(server\/api\/v1\/chats\/test\/index\.post\.ts|app\/composables\/chat-test\.ts)$/,
      tests: [
        'tests/e2e/chat/scroll-spacer.spec.ts',
        'tests/e2e/chat/gateway-image-generation.spec.ts',
        'tests/e2e/chat/image-generation-single-message.spec.ts',
      ],
    },
    {
      pattern: /^app\/composables\/chat-image-ui\.ts$/,
      tests: [
        'tests/unit/composables/chat-image-ui.spec.ts',
        'tests/e2e/chat/scroll-spacer.spec.ts',
        'tests/e2e/chat/gateway-image-generation.spec.ts',
        'tests/e2e/chat/image-generation-single-message.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/ChatInput\/Files\/.*\.vue$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^app\/components\/Chat\/Files\.vue$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^app\/components\/ui\/Confirmation\.vue$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^app\/composables\/(chat-files|xls-convert|file-manager(-project-groups)?)\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^app\/composables\/confirmation\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern:
        /^(app\/components\/Chat\/(ToolApprovalBubble|Reasoning|Scroll\.client|ToolRounds)\.vue|app\/components\/Chat\/Reasoning\/(Step|ApprovalStep|ApprovalDetails)\.vue|app\/components\/ChatInput\/ToolApprovalChip\.vue|app\/composables\/(chat|chat-scroll-spacer|message-approvals|tool-approvals|tool-rounds)\.ts|app\/pages\/chats\/\[slug\]\.vue|app\/utils\/(tool-approval-step|chat-reasoning-live|message-part-spacing)\.ts|tests\/e2e\/helpers\/composer-metrics\.ts)$/,
      tests: () => {
        return approvalScrollTests.filter(test => existsSync(test))
      },
    },
    {
      pattern: /^app\/composables\/chat\.ts$/,
      tests: [
        ...chatStreamBranchTests,
        ...messageUsageTests,
        'tests/integration/api/chats-title.spec.ts',
        'tests/unit/composables/chat.stream-stall.spec.ts',
      ],
    },
    {
      pattern:
        /^(app\/components\/Chat\/(Reasoning|ToolApprovalBubble)\.vue|app\/components\/Chat\/Reasoning\/.*\.vue|app\/pages\/(chats|shared)\/\[slug\]\.vue|app\/composables\/(message-approvals|tool-approvals|composer-connectors)\.ts|app\/utils\/(reasoning-steps|reasoning|tool-approval-step|connector-step|chat-reasoning-live|message-part-spacing)\.ts|app\/types\/reasoning-step\.d\.ts|shared\/utils\/connector-image-parts\.ts|tests\/unit\/components\/Chat\/Reasoning\/expand-steps\.ts)$/,
      tests: reasoningStepsUiTests,
    },
    {
      pattern: /^app\/composables\/chat-test\.ts$/,
      tests: chatTestEndpointTests,
    },
    {
      pattern: /^server\/utils\/chats\/(errors|provider-error-summary)\.ts$/,
      tests: [
        ...chatStreamBranchTests,
        'tests/integration/api/chats-title.spec.ts',
        'tests/unit/utils/research/errors.spec.ts',
        'tests/unit/utils/chats/errors.spec.ts',
        'tests/unit/server/utils/chats/provider-error-summary.spec.ts',
        'tests/unit/server/utils/chats/stream-error-telemetry.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/chats\/stream-error-telemetry\.ts$/,
      tests: [
        ...chatStreamBranchTests,
        'tests/unit/server/utils/chats/stream-error-telemetry.spec.ts',
      ],
    },
    {
      pattern:
        /^(providers\/(openai|google|anthropic)\.ts|shared\/types\/(research|providers)\.d\.ts|shared\/utils\/research\.ts|app\/utils\/research\.ts)$/,
      tests: deepResearchTests,
    },
    {
      pattern:
        /^(app\/components\/(Chat|ChatInput)\/DeepResearch.*\.vue|app\/components\/ChatInput\/ModelsTrigger(\.vue|\/.+\.vue)|app\/composables\/(chat-research|chat-input|research-links)\.ts)$/,
      tests: deepResearchTests,
    },
    {
      pattern:
        /^(app\/components\/prose\/A\.vue|app\/composables\/chat-format\.ts)$/,
      tests: deepResearchTests,
    },
    {
      pattern:
        /^(app\/components\/prose\/Img\.vue|app\/composables\/chat-format\.ts)$/,
      tests: [
        'tests/unit/components/prose/Img.spec.ts',
        'tests/unit/composables/chat-format.spec.ts',
        'tests/unit/components/Chat/Reasoning.spec.ts',
      ],
    },
    {
      pattern:
        /^(app\/components\/prose\/(PreStream|MermaidDiagram|MermaidViewer\.client|MermaidActionMenu|MermaidEditor)\.vue|server\/utils\/chats\/test\/mermaid-fixture\.ts|app\/composables\/(diagram-renderer|diagram-export|markdown-source|chat-format)\.ts|app\/utils\/(markdown-fences|mermaid-menu-actions|diagram-render-core|diagram-fonts|diagram-wheel|diagram-export-[a-z-]+|sanitize-diagram-svg)\.ts|app\/assets\/css\/(main|diagram-theme)\.css|tests\/utils\/diagram-theme-colors\.ts|tests\/fixtures\/pele-examples\.json|app\/workers\/diagram\.worker\.ts|app\/types\/diagram(-export)?\.d\.ts|app\/components\/Chat\/MarkdownSource\.vue|app\/pages\/chats\/\[slug\]\.vue)$/,
      tests: mermaidDiagramTests,
    },
    {
      pattern:
        /^(app\/components\/prose\/(PreStream|CodeStream)\.vue|app\/composables\/(md-syntax-highlighter|code-stream)\.ts|app\/utils\/code-highlight\.ts|scripts\/shiki-token-parity\.mjs|server\/utils\/chats\/test\/code-fixture\.ts|server\/api\/v1\/chats\/test\/index\.(get|post)\.ts)$/,
      tests: codeHighlightingTests,
    },
    {
      pattern:
        /^(server\/db\/schemas\/research-jobs\.ts|server\/utils\/research\/.*\.ts|server\/plugins\/research-job-sweep\.ts|server\/api\/v1\/chats\/research\/.*\.ts|server\/api\/v1\/chats\/\[slug\]\/research\/.*\.ts)$/,
      tests: deepResearchTests,
    },
    {
      pattern: /^server\/db\/schemas\/research-jobs\.ts$/,
      tests: landingTests,
    },
    {
      pattern:
        /^server\/utils\/chats\/(insert-message|persist-user-message)\.ts$/,
      tests: [...deepResearchTests, ...chatStreamBranchTests],
    },
    {
      pattern: /^server\/utils\/chats\/filter-ui-message-stream\.ts$/,
      tests: chatStreamBranchTests,
    },
    {
      pattern: /^shared\/utils\/external-url\.ts$/,
      tests: [
        'tests/unit/utils/external-url.spec.ts',
        'tests/unit/components/content/HomeComparison.spec.ts',
        'tests/unit/pages/guides/[slug].spec.ts',
      ],
    },
    {
      pattern: /^shared\/utils\/http-url\.ts$/,
      tests: [
        'tests/unit/utils/http-url.spec.ts',
        'tests/unit/utils/filter-ui-message-stream.spec.ts',
        'tests/unit/components/Chat/UrlSources.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/chats\/title\.ts$/,
      tests: [
        'tests/unit/utils/chats/title.spec.ts',
        'tests/integration/api/chats-title.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/chats\/deprecated-model\.ts$/,
      tests: [
        'tests/unit/utils/chats/provider.spec.ts',
        'tests/unit/utils/research/start.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/chats\/provider\.ts$/,
      tests: [
        'tests/unit/utils/chats/provider.spec.ts',
        ...chatStreamBranchTests,
        'tests/integration/api/chats-title.spec.ts',
        'tests/integration/api/chats-research-clarify.spec.ts',
      ],
    },
    {
      pattern: /^app\/composables\/(history|projects|project-chats|project-picker|dropdown-placement)\.ts$/,
      tests: historyProjectsTests,
    },
    {
      pattern: /^app\/utils\/(files|file-delivery-hints|upload-with-progress|xls-convert)\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^(app\/workers\/xls-convert\.ts|app\/types\/xls-convert\.d\.ts)$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^shared\/utils\/files\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^app\/components\/History\/.*\.vue$/,
      tests: historyProjectsTests,
    },
    {
      pattern: /^app\/components\/Projects\/ActionsDropdown\.vue$/,
      tests: historyProjectsTests,
    },
    {
      pattern: /^server\/utils\/artifacts\/chat-artifacts\.ts$/,
      tests: [
        'tests/integration/api/chats-history-artifact-count.spec.ts',
      ],
    },
    {
      pattern: /^app\/pages\/chats\/(history\/index|new)\.vue$/,
      tests: historyProjectsTests,
    },
    {
      pattern:
        /^(app\/composables\/(chat-draft|auth)\.ts|app\/pages\/chats\/new\.vue|app\/app\.vue|app\/plugins\/session-revalidate\.client\.ts)$/,
      tests: [
        ...sessionRecoveryTests,
        'tests/unit/composables/notification-prompt.spec.ts',
      ],
    },
    {
      pattern:
        /^(server\/utils\/account\/.*\.ts|server\/utils\/auth\.ts|app\/composables\/auth\.ts|app\/pages\/profile\/security\.vue|app\/components\/Sidebar\/AuthCta\.vue)$/,
      tests: accountDeletionTests,
    },
    {
      pattern:
        /^(shared\/utils\/connectors-policy\.ts|server\/utils\/net\/(safe-url|safe-fetch|own-hosts)\.ts|server\/utils\/auth-hosts\.ts|server\/utils\/skills\/import\/github\.ts)$/,
      tests: connectorsSafeFetchTests,
    },
    {
      pattern:
        /^shared\/utils\/google-(scopes|data-policy)\.ts$/,
      tests: googleContractsTests,
    },
    {
      pattern:
        /^(shared\/utils\/google-connections\.ts|server\/db\/schemas\/(google-connections|chats|files|keys)\.ts|server\/utils\/account\/(purge-google-connections|purge-user-data)\.ts|\.drizzle\/migrations\/[^/]+_wandering_genesis\/.*)$/,
      tests: googleSchemaTests,
    },
    {
      pattern:
        /^(server\/utils\/google\/.*\.ts|server\/api\/v1\/google\/.*\.ts|server\/plugins\/(google-access-sweep|evlog-request-observability)\.ts|server\/utils\/account\/(purge-google-connections|purge-user-data)\.ts|shared\/utils\/(google-connections|google-scopes|google-data-policy|auth-redirect|features\/registry)\.ts|server\/utils\/connectors\/(oauth-client|oauth-state|callback-limit|route|body)\.ts|server\/utils\/(files\/(delete-files|convert-files-for-ai)|documents\/cleanup|knowledge\/(linked-files|text-store|version))\.ts|app\/components\/Profile\/Google\/.*\.vue|app\/pages\/profile\/keys\.vue|app\/composables\/google-connection\.ts|server\/utils\/auth\.ts|nuxt\.config\.ts|tests\/setup\/helpers\/(google-connections|connectors-oauth|skills-route|skills-public-id-mock|memory-extraction-db)\.ts)$/,
      tests: googleConnectionsTests,
    },
    {
      pattern:
        /^(shared\/utils\/(google-byo|google-connections|google-scopes|features\/registry)\.ts|server\/utils\/google\/(byo-access|byo-client|byo-sweep|callback|client|connection|oauth-state|route|tokens|access-ended)\.ts|server\/api\/v1\/google\/.*\.ts|server\/api\/v1\/profiles\/keys\/(index\.get|google-oauth-client\/.*)\.ts|server\/api\/v1\/profiles\/features\/index\.get\.ts|server\/db\/schemas\/keys\.ts|server\/utils\/features\/(evaluate|guards)\.ts|server\/plugins\/(evlog-request-observability|google-access-sweep)\.ts|app\/components\/Profile\/Google\/.*\.vue|app\/pages\/profile\/keys\.vue|tests\/setup\/helpers\/google-connections\.ts)$/,
      tests: googleByoClientTests,
    },
    {
      pattern:
        /^(shared\/utils\/(connectors-policy|features\/registry)\.ts|config\/connectors-(catalog|directory)\.ts|shared\/utils\/connectors-directory\.ts|server\/db\/schemas\/connectors\.ts|server\/utils\/connectors\/(registry-(entry|sync|search|sync-now|icon|probe)|directory-index|add|icon|icon-response|svg-icon)\.ts|server\/api\/v1\/admin\/connectors\/.*\.ts|shared\/utils\/connectors-publisher\.ts|server\/utils\/db\/like\.ts|server\/utils\/net\/(safe-url|safe-fetch)\.ts|server\/plugins\/mcp-registry-sync\.ts|wrangler\.jsonc|server\/api\/v1\/connectors\/registry\/.*\.ts|tests\/fixtures\/mcp-registry\/.*\.ts|tests\/setup\/helpers\/(connectors-oauth|skills-route|skills-public-id-mock|memory-extraction-db)\.ts)$/,
      tests: connectorsRegistryTests,
    },
    {
      pattern:
        /^(shared\/utils\/(connectors-policy|connectors-slug|connectors-connected)\.ts|shared\/utils\/features\/registry\.ts|config\/connectors-catalog\.ts|scripts\/check-connector-presets\.mjs|server\/db\/schemas\/connectors\.ts|server\/utils\/connectors\/(store|cleanup)\.ts|server\/utils\/account\/purge-user-data\.ts|server\/utils\/chats\/lifecycle\.ts|server\/api\/v1\/chats\/history\/delete\/bulk\.post\.ts|tests\/setup\/helpers\/skills-public-id-mock\.ts|\.drizzle\/migrations\/[^/]+_known_rogue\/.*)$/,
      tests: connectorsStorageTests,
    },
    {
      pattern:
        /^(shared\/utils\/connectors-policy\.ts|server\/utils\/connectors\/.*\.ts|server\/api\/v1\/connectors\/.*\.ts|server\/routes\/connectors\/.*\.ts|server\/utils\/net\/(safe-url|safe-fetch)\.ts|server\/utils\/request-public-origin\.ts|server\/utils\/auth-hosts\.ts|server\/utils\/legal\/consent\.ts|server\/utils\/account\/purge-user-data\.ts|server\/plugins\/evlog-request-observability\.ts|config\/connectors-catalog\.ts|tests\/setup\/helpers\/(connectors-oauth|skills-route|skills-public-id-mock)\.ts)$/,
      tests: connectorsOAuthTests,
    },
    {
      pattern:
        /^(shared\/utils\/(connectors-policy|connectors-parts|connectors-errors|connector-image-parts|tool-index)\.ts|server\/utils\/files\/(connector-images|chat-deletion-cleanup|source-filter)\.ts|server\/api\/v1\/chats\/\[slug\]\/index\.get\.ts|server\/utils\/ai\/(tool-index(-prefetch)?|anthropic-thinking-binding)\.ts|server\/utils\/connectors\/.*\.ts|server\/api\/v1\/connectors\/(index\.get|\[id\]\/index\.patch)\.ts|server\/api\/v1\/chats\/\[slug\]\/(index\.post|connectors\/.*)\.ts|server\/utils\/ai\/tool-loop\.ts|server\/utils\/chats\/(branch|share|share-public-parts|persist-user-message)\.ts|server\/utils\/ai\/search-answer-continuation\.ts|server\/utils\/files\/assistant-files\.ts|server\/api\/v1\/chats\/\[slug\]\/share\/index\.get\.ts|server\/utils\/chats\/context\/.*\.ts|server\/utils\/memory\/extract-input\.ts|tests\/setup\/helpers\/(mock-mcp-server|connectors-oauth|connector-images|skills-route|skills-public-id-mock)\.ts|package\.json)$/,
      tests: connectorsChatToolsTests,
    },
    {
      pattern:
        /^(server\/(mcp\/tools|utils\/besidka-tools)\/.*\.ts|package\.json)$/,
      tests: toolApprovalSpikeTests,
    },
    {
      pattern:
        /^(shared\/utils\/(tool-rounds|chat-stream-heartbeat|tool-approval-policy|connectors-parts|connectors-policy|besidka-tool-permissions)\.ts|shared\/types\/chat-errors\.d\.ts|server\/utils\/ai\/(stream-stall|tool-rounds|tool-loop)\.ts|server\/utils\/chats\/(stream-heartbeat|errors|request-schema|branch|share-public-parts)\.ts|server\/utils\/connectors\/(call-limits|mcp-client|persist|send-tools|tool-review|page)\.ts|server\/utils\/tool-approval\/.*\.ts|server\/utils\/besidka-tools\/(chat-adapter|permissions)\.ts|server\/api\/v1\/chats\/\[slug\]\/index\.post\.ts|app\/composables\/(chat|tool-rounds)\.ts|app\/components\/Chat\/ToolRounds\.vue|app\/pages\/chats\/\[slug\]\.vue)$/,
      tests: connectorRuntimeTests,
    },
    {
      pattern:
        /^(server\/utils\/chats\/(generation-lease|generation-in-progress|stream-disconnect|stopped-replies|lifecycle)\.ts|server\/utils\/ai\/(generation-guard|stream-stall)\.ts|shared\/utils\/chat-reply-stopped\.ts|server\/api\/v1\/chats\/\[slug\]\/(stop|index)\.post\.ts|app\/composables\/chat\.ts|app\/components\/Chat\/(Loader\.client|ReplyStopped)\.vue|app\/pages\/chats\/\[slug\]\.vue|tests\/setup\/helpers\/memory-extraction-db\.ts)$/,
      tests: generationStopTests,
    },
    {
      pattern:
        /^(shared\/utils\/(tool-approval-parts|tool-approval-policy|connectors-parts|connectors-policy)\.ts|shared\/utils\/features\/registry\.ts|server\/utils\/memory\/tools\/memory-tools\.ts|server\/utils\/knowledge\/context\.ts|app\/utils\/labs\.ts|server\/utils\/tool-approval\/.*\.ts|server\/api\/v1\/chats\/\[slug\]\/index\.post\.ts|server\/utils\/connectors\/(send-tools|audit)\.ts|server\/utils\/chats\/(branch|share-public-parts|persist-user-message)\.ts|server\/utils\/(artifacts|documents)\/message-parts\.ts|server\/utils\/ai\/search-answer-continuation\.ts|server\/utils\/files\/assistant-files\.ts|app\/composables\/chat\.ts|app\/components\/Chat\/Reasoning\.vue|app\/utils\/connector-step\.ts|tests\/setup\/helpers\/mock-mcp-server\.ts)$/,
      tests: toolApprovalRequestTests,
    },
    {
      pattern:
        /^(shared\/utils\/tool-approval-(policy|parts)\.ts|server\/utils\/tool-approval\/.*\.ts|server\/api\/v1\/chats\/\[slug\]\/index\.post\.ts|server\/utils\/chats\/request-schema\.ts|server\/utils\/connectors\/(send-tools|audit|store)\.ts|server\/utils\/ai\/message-usage\.ts|app\/composables\/(chat|tool-approvals)\.ts|tests\/setup\/helpers\/mock-mcp-server\.ts|package\.json)$/,
      tests: toolApprovalContinuationTests,
    },
    {
      pattern:
        /^(app\/utils\/(tool-approval-step|connector-step)\.ts|app\/composables\/(chat|tool-approvals|side-panel)\.ts|app\/components\/Chat\/Reasoning\.vue|app\/components\/Chat\/Reasoning\/Approval(Step|Details)\.vue|app\/components\/ChatInput\/ToolApprovalChip\.vue|app\/components\/ChatInput\.client\.vue|shared\/utils\/(tool-approval-parts|tool-approval-policy|connectors-parts|chat-test-errors)\.ts|server\/api\/v1\/chats\/test\/index\.get\.ts|server\/utils\/chats\/test\/tool-approval-fixture\.ts|tests\/e2e\/helpers\/skills\.ts)$/,
      tests: toolApprovalUiTests,
    },
    {
      pattern:
        /^(server\/api\/v1\/chats\/\[slug\]\/tool-approvals\/.*\.ts|server\/utils\/tool-approval\/(grants|send|policy|continuation)\.ts|server\/utils\/connectors\/(send-tools|store|route|body)\.ts|shared\/types\/tool-approval-grants\.d\.ts|app\/composables\/tool-approval-grants\.ts|app\/components\/Chat\/(ContextPanel|ContextPanelApprovals|Reasoning)\.vue|app\/components\/Chat\/Reasoning\/ApprovalStep\.vue|app\/utils\/tool-approval-step\.ts|shared\/utils\/tool-approval-parts\.ts|server\/utils\/chats\/(branch|share-public-parts)\.ts|server\/utils\/memory\/tools\/memory-tools\.ts|server\/api\/v1\/chats\/\[slug\]\/index\.post\.ts)$/,
      tests: toolApprovalGrantsTests,
    },
    {
      pattern:
        /^(shared\/utils\/tool-approval-policy\.ts|server\/utils\/tool-approval\/.*\.ts|server\/utils\/hkdf\.ts|server\/utils\/connectors\/audit\.ts|server\/db\/schemas\/tool-approvals\.ts|server\/plugins\/(tool-approval-claim-sweep|connector-audit-prune)\.ts|shared\/utils\/connectors-policy\.ts|server\/utils\/account\/purge-user-data\.ts|server\/utils\/chats\/lifecycle\.ts|server\/api\/v1\/chats\/history\/delete\/bulk\.post\.ts|tests\/setup\/helpers\/(memory-extraction-db|skills-public-id-mock)\.ts|\.drizzle\/migrations\/[^/]+_chunky_gabe_jones\/.*)$/,
      tests: toolApprovalPolicyTests,
    },
    {
      pattern:
        /^(shared\/utils\/google-data-(policy|recipient)\.ts|server\/utils\/google\/(data-guard|send-flag)\.ts|server\/utils\/gateways\/(index|vercel|openrouter|cloudflare)\.ts|server\/utils\/tool-approval\/google(-send-tools|-send-candidates)?\.ts|server\/api\/v1\/chats\/\[slug\]\/(index\.(post|get)|title\.patch)\.ts|server\/api\/v1\/chats\/\[slug\]\/research\/index\.post\.ts|server\/api\/v1\/chats\/\[slug\]\/share\/(index\.(get|post)|check\.post)\.ts|server\/api\/v1\/artifacts\/\[id\]\/complete\.post\.ts|server\/api\/v1\/profiles\/keys\/(index\.get|google\/(index|paid-tier)\.post)\.ts|server\/utils\/chats\/(share|share-pii-check)\.ts|server\/utils\/files\/(file-governance|file-share-access)\.ts|server\/utils\/mcp\/private\/(chats|files|artifacts)\.ts|server\/utils\/besidka-tools\/(chat-adapter|tools\/rename-file)\.ts|server\/utils\/documents\/(images|create-document-tool)\.ts|server\/api\/v1\/documents\/\[id\]\/render\.post\.ts|server\/utils\/knowledge\/ingest\.ts|server\/utils\/memory\/(chat-memory-filters|backfill-queue|entries|extract|extract-apply|extract-sweep)\.ts|server\/utils\/memory\/tools\/(memory-tools|read-chat|search-chats)\.ts|server\/utils\/projects\/(memory-refresh|memory-sweep-settle)\.ts|app\/composables\/(chat-google-data|user-keys|chat-share)\.ts|app\/types\/chat-share\.d\.ts|shared\/types\/chats\.d\.ts|app\/components\/Profile\/Keys\/(GeminiPaidTier|ProviderKeyCard)\.vue|app\/components\/ChatInput\/ModelsTrigger\/(ModelItem|GatewayModelItem|GatewayModelList|Panel)\.vue|app\/components\/Chat\/(ShareModal\.client|ContextPanel)\.vue|app\/pages\/chats\/\[slug\]\.vue|tests\/setup\/helpers\/(chat-context-db|search-index-db|knowledge-db)\.ts)$/,
      tests: googleDataGuardTests,
    },
    {
      pattern:
        /^(shared\/utils\/(google-drive|artifact-frame-policy)\.ts|shared\/types\/(chat-context|files)\.d\.ts|server\/utils\/google\/(download|drive|drive-import|drive-parts|picker-token|picker-frame|http|route)\.ts|server\/api\/v1\/google\/drive\/.*\.ts|server\/utils\/files\/(persist-file|file-governance|rewrite-share-file-urls)\.ts|server\/utils\/storage\/categories\.ts|app\/pages\/profile\/storage\.vue|server\/utils\/chats\/(share-public-parts|request-schema)\.ts|server\/utils\/chats\/context\/sections\.ts|server\/plugins\/artifacts-frame-src\.ts|server\/api\/v1\/files\/index\.get\.ts|server\/api\/v1\/chats\/(\[slug\]\/index\.post|new\/index\.put)\.ts|app\/composables\/(google-picker|chat-drive-files|chat)\.ts|app\/utils\/(storage-categories|artifact-frame-policy)\.ts|app\/types\/(chat-input-tools|file-manager)\.d\.ts|app\/components\/Chat\/(DriveFiles|ContextPanelItem)\.vue|app\/components\/Chat\/Artifact\/Frame\.client\.vue|app\/components\/ChatInput\.client\.vue|app\/components\/ChatInput\/(ToolsMenu\.client|Files\/Attached\/Preview\.client)\.vue|app\/components\/ChatInput\/ToolsMenu\/Content\.vue|app\/pages\/(chats\/(\[slug\]|new)|shared\/\[slug\])\.vue|tests\/setup\/helpers\/(knowledge-db|knowledge-send-db)\.ts)$/,
      tests: googleDrivePickerTests,
    },
    {
      pattern:
        /^(shared\/utils\/google-drive-tools\.ts|server\/utils\/google\/(drive-tools|drive-picked|drive-save|drive-upload|drive-import|tool-output|drive|http|route|access-ended|send-flag)\.ts|shared\/utils\/google-tool-approvals\.ts|server\/api\/v1\/google\/drive\/saved-files\/.*\.ts|server\/utils\/tool-approval\/(google|google-send-candidates|google-send-tools|send|round-state)\.ts|app\/utils\/tool-approval-step\.ts|app\/components\/Chat\/Reasoning\/ApprovalStep\.vue|app\/components\/ChatInput\/ToolsMenu\/Content\.vue|app\/composables\/auth\.ts|server\/api\/v1\/chats\/\[slug\]\/index\.post\.ts|app\/composables\/google-drive-save\.ts|app\/utils\/(google-step|reasoning|reasoning-step-icons)\.ts|app\/types\/(google-step|reasoning-step)\.d\.ts|app\/components\/Chat\/(SaveToGoogleDrive|Files|Document|GeneratedImage|Reasoning)\.vue|app\/components\/Chat\/Reasoning\/(GoogleStep|Step)\.vue|app\/pages\/chats\/\[slug\]\.vue)$/,
      tests: googleDriveToolsTests,
    },
    {
      pattern:
        /^(shared\/utils\/(mail-address|google-gmail-tools|google-gmail-draft-view|google-drive-tools|google-tool-approvals|google-byo|tool-approval-parts|features\/registry)\.ts|server\/utils\/google\/(gmail-message|gmail-text|gmail-api|html-entities|chat-references|drive-found-read|drive-search|byo-tools|byo-access|tokens|send-guard|drive-tools|tool-output|http|data-guard)\.ts|server\/utils\/tool-approval\/(policy|send|google-send-candidates|google-send-tools)\.ts|server\/api\/v1\/chats\/\[slug\]\/index\.post\.ts|app\/components\/Chat\/Reasoning\/(ApprovalStep|GoogleStep)\.vue|app\/components\/Profile\/Google\/OwnClient\.vue|app\/utils\/(google-step|reasoning|reasoning-step-icons|tool-approval-step)\.ts|app\/types\/google-step\.d\.ts|tests\/setup\/helpers\/google-connections\.ts)$/,
      tests: googleGmailToolsTests,
    },
    {
      pattern:
        /^(shared\/utils\/google-drive\.ts|server\/utils\/files\/source-filter\.ts|server\/utils\/google\/drive-import\.ts|server\/api\/v1\/google\/drive\/files\/refresh\.post\.ts|server\/api\/v1\/files\/index\.get\.ts|tests\/setup\/helpers\/knowledge-db\.ts|app\/composables\/(google-drive-library|file-touch-select)\.ts|app\/utils\/(file-manager-dialog|google-drive-tab|file-manager-sources)\.ts|app\/types\/file-manager\.d\.ts|app\/components\/ChatInput\.client\.vue|app\/components\/ChatInput\/Files\/Modal(\.client)?\.vue|app\/components\/ChatInput\/Files\/Modal\/Select(\.client)?(\/.*)?\.vue)$/,
      tests: googleDriveTabTests,
    },
    {
      pattern:
        /^(shared\/utils\/(google-tool-approvals|tool-approval-policy|tool-approval-parts)\.ts|shared\/types\/tool-approval-grants\.d\.ts|server\/utils\/tool-approval\/.*\.ts|server\/utils\/connectors\/send-tools\.ts|server\/utils\/chats\/branch\.ts|server\/api\/v1\/chats\/shares\/\[slug\]\/branch\.post\.ts|server\/api\/v1\/chats\/\[slug\]\/index\.post\.ts|app\/utils\/tool-approval-step\.ts|app\/components\/Chat\/(ContextPanelApprovals|Reasoning\/ApprovalStep)\.vue)$/,
      tests: googleToolApprovalTests,
    },
    {
      pattern:
        /^(shared\/utils\/(connectors-policy|connectors-parts|connectors-errors|connector-image-parts)\.ts|app\/components\/Chat\/Reasoning\/ConnectorThumbnail\.vue|app\/composables\/(composer-connectors|chat|chat-share)\.ts|app\/components\/Chat\/ShareModal\.client\.vue|app\/utils\/(connector-step|chat-input-tiles|connector-mention)\.ts|app\/types\/chat-input-tools\.d\.ts|app\/components\/ChatInput\.client\.vue|app\/components\/ChatInput\/(ConnectorPicker\.client|ToolsMenu\.client|ConnectorSuggestion)\.vue|app\/components\/ChatInput\/ToolsMenu\/Content\.vue|app\/components\/Chat\/(Reasoning|ContextPanel|ContextPanelItem|ConnectorsNotice)\.vue|app\/components\/Chat\/Reasoning\/ConnectorStep\.vue|app\/pages\/chats\/(\[slug\]|new)\.vue)$/,
      tests: connectorsChatToolsUiTests,
    },
    {
      pattern:
        /^(app\/components\/ui\/ToolPermissions(\.vue|\/.*\.vue)|app\/utils\/(tool-permissions|besidka-tool-permissions)\.ts|app\/components\/Profile\/(BesidkaTools|Connectors)\/.*\.vue|shared\/utils\/besidka-tool-permissions\.ts)$/,
      tests: toolPermissionsUiTests,
    },
    {
      pattern:
        /^server\/utils\/connectors\/(tool-review|page|errors|store)\.ts$/,
      tests: ['tests/unit/server/utils/connectors/tool-review.spec.ts'],
    },
    {
      pattern:
        /^(shared\/types\/connectors\.d\.ts|shared\/utils\/(connectors-messages|connectors-policy|connectors-connected|connectors-auth)\.ts|server\/utils\/connectors\/(page|tool-review|store|errors|send-tools|consent|route|body|header-auth)\.ts|server\/api\/v1\/connectors\/.*\.ts|app\/pages\/(profile\/connectors|chats\/connectors\/index)\.vue|app\/components\/History\/PageShell\.vue|app\/components\/Profile\/Connectors\/.*\.vue|app\/composables\/(connectors|composer-connectors|connector-directory|feature-opt-in)\.ts|app\/utils\/(connector-brand-icons|besidka-tool-permissions)\.ts|app\/components\/Profile\/BesidkaTools\/.*\.vue|shared\/utils\/connectors-directory\.ts|config\/connectors-directory\.ts|shared\/utils\/connectors-publisher\.ts|app\/layouts\/profile\.vue|app\/components\/Search\/Modal\.client\.vue|config\/connectors-catalog\.ts|tests\/setup\/helpers\/(connectors-ui|dom-dialog|connectors-oauth|memory-extraction-db)\.ts)$/,
      tests: connectorsPageTests,
    },
    {
      pattern:
        /^(shared\/utils\/skills-policy\.ts|server\/db\/schemas\/skills\.ts|server\/utils\/skills\/.*\.ts|server\/plugins\/skills-storage-sweep\.ts|server\/utils\/account\/purge-user-data\.ts|server\/utils\/chats\/lifecycle\.ts|server\/api\/v1\/chats\/history\/delete\/bulk\.post\.ts|tests\/setup\/helpers\/skills-(db|public-id-mock)\.ts|\.drizzle\/migrations\/[^/]+_normal_the_professor\/.*)$/,
      tests: skillsStorageTests,
    },
    {
      pattern:
        /^(shared\/utils\/skills\/.*\.ts|shared\/utils\/skills-policy\.ts|server\/plugins\/skills-update-sweep\.ts|server\/utils\/skills\/(import\/.*|pending|usage|ids|storage)\.ts|server\/api\/v1\/skills\/.*\.ts|app\/workers\/skill-import\.ts|app\/types\/skill-import\.d\.ts|tests\/setup\/helpers\/(skill-archives|skills-route|skills-db|skills-public-id-mock|github-mock)\.ts|tests\/utils\/skills-corpus\.ts|tests\/fixtures\/skills\/.*)$/,
      tests: skillsImportTests,
    },
    {
      pattern:
        /^(shared\/utils\/skills\/(edit|blank|compose|templates\/.*|archive|analyze|license|frontmatter|diff|path|findings|mode|finding-.*|file-set-findings|frontmatter-findings|known-names|lookalikes|url-hosts|update-changes)\.ts|shared\/utils\/skills-policy\.ts|server\/utils\/skills\/(unique-violation|cleanup|pending|lookalike-context)\.ts|server\/utils\/skills\/import\/(commit|rate-limit|update-check)\.ts|server\/utils\/skills\/versions\/.*\.ts|server\/api\/v1\/skills\/(index\.(get|post)|\[id\]\/(index\.(get|patch|delete)|files\.get|download\.get|versions\/.*))\.ts|tests\/setup\/helpers\/(skills-db|skills-route|skills-public-id-mock|skill-archives)\.ts)$/,
      tests: skillsVersionsTests,
    },
    {
      pattern:
        /^(shared\/utils\/skills\/scripts\.ts|server\/utils\/skills\/(provider-upload|send-container-options|scripts-toggle|cleanup)\.ts|server\/api\/v1\/skills\/\[id\]\/scripts\/.*\.ts|server\/api\/v1\/profiles\/keys\/anthropic\/skill-copies\/.*\.ts|server\/utils\/tool-approval\/(policy|continuation)\.ts|server\/utils\/besidka-tools\/chat-settings\.ts|shared\/utils\/features\/registry\.ts)$/,
      tests: skillsScriptsTests,
    },
    {
      pattern:
        /^(shared\/utils\/skills\/(runtime|runtime-notice|jev-findings|mode)\.ts|shared\/utils\/skills-policy\.ts|server\/utils\/skills\/(runtime|project)\/.*\.ts|server\/db\/schemas\/project-skills\.ts|server\/api\/v1\/projects\/\[id\]\/skills\/.*\.ts|server\/utils\/projects\/lifecycle\.ts|server\/utils\/ai\/tool-loop\.ts|server\/utils\/chats\/(request-schema|share-public-parts|model-turns)\.ts|server\/api\/v1\/chats\/\[slug\]\/index\.post\.ts|server\/api\/v1\/shared\/\[slug\]\/index\.get\.ts|server\/api\/v1\/chats\/shares\/\[slug\]\/branch\.post\.ts|server\/utils\/chats\/context\/sections\.ts|server\/api\/v1\/chats\/new\/index\.put\.ts|tests\/setup\/helpers\/skills-(db|public-id-mock)\.ts)$/,
      tests: skillsRuntimeTests,
    },
    {
      pattern:
        /^(app\/components\/Chat\/(Reasoning|Reasoning\/SkillStep|SkillInvocation|SkillPreview\.client)\.vue|app\/utils\/reasoning\.ts|app\/components\/ChatInput\/SkillPicker\.client\.vue|app\/composables\/(composer-skill-invocation|composer-skills|composer-commands|markdown-textarea)\.ts|app\/utils\/(skill-step|chat-input-tiles|composer-command)\.ts|app\/components\/Projects\/SkillsCard\.vue|app\/pages\/chats\/projects\/\[id\]\.vue|app\/components\/ChatInput\.client\.vue|app\/components\/ChatInput\/(CommandPicker|CommandMirror)\.vue|app\/types\/chat-input-tools\.d\.ts|app\/layouts\/chat\.vue|app\/composables\/chat-test\.ts|server\/api\/v1\/chats\/test\/index\.post\.ts|shared\/utils\/chat-test-errors\.ts|tests\/e2e\/helpers\/skills\.ts|app\/pages\/chats\/skills\/index\.vue|shared\/utils\/skills\/runtime\.ts)$/,
      tests: skillsComposerTests,
    },
    {
      pattern:
        /^(shared\/utils\/(builtin-commands|skills-policy)\.ts|server\/utils\/chats\/(builtin-commands|builtin-command-rate-limit|request-schema|share-public-parts)\.ts|server\/utils\/files\/assistant-files\.ts|server\/utils\/memory\/extract-input\.ts|server\/utils\/memory\/tools\/read-chat\.ts|server\/utils\/jev\/send-path\.ts|server\/utils\/search\/text\.ts|server\/utils\/mcp\/private\/chats\.ts|server\/utils\/account\/purge-user-data\.ts|server\/api\/v1\/chats\/\[slug\]\/(title\.patch|support-info\.get)\.ts|server\/api\/v1\/chats\/\[slug\]\/index\.post\.ts|server\/api\/v1\/chats\/new\/index\.put\.ts|app\/composables\/(composer-builtin-command|composer-commands|chat)\.ts|app\/utils\/composer-command\.ts|app\/components\/ChatInput\/CommandPicker\.vue|app\/components\/Chat\/SkillInvocation\.vue|app\/components\/ChatInput\.client\.vue|app\/pages\/chats\/new\.vue)$/,
      tests: builtinCommandsTests,
    },
    {
      pattern:
        /^(server\/utils\/usage\/.*\.ts|server\/utils\/besidka-tools\/(tools\/get-(chat-cost|usage-stats|debug-info)|registry|types|chat-adapter)\.ts|server\/mcp\/tools\/get-(chat-cost|usage-stats|debug-info)\.ts|server\/utils\/mcp\/tool-scopes\.ts|server\/utils\/chats\/builtin-commands\.ts|server\/utils\/mcp\/private\/debug-info\.ts|server\/utils\/account\/purge-user-data\.ts|shared\/utils\/(builtin-commands|message-metadata)\.ts|tests\/setup\/helpers\/chat-context-db\.ts)$/,
      tests: usageReportsTests,
    },
    {
      pattern:
        /^(shared\/utils\/(skills-policy|builtin-commands)\.ts|server\/utils\/skills\/versions\/(settings|create|errors)\.ts|app\/components\/Profile\/Skills\/(CommandField|Settings|CreateDialog\.client)\.vue|app\/composables\/skills-library\.ts)$/,
      tests: commandUniquenessTests,
    },
    {
      pattern:
        /^(app\/components\/Profile\/Skills\/BuiltinList\.vue|app\/pages\/chats\/skills\/index\.vue|app\/composables\/composer-builtin-command\.ts|shared\/utils\/builtin-commands\.ts)$/,
      tests: builtinSkillsPageTests,
    },
    {
      pattern:
        /^(app\/pages\/chats\/skills\/index\.vue|app\/components\/Profile\/Skills\/.*|app\/components\/History\/PageShell\.vue|app\/layouts\/profile\.vue|app\/composables\/(skills-library|skill-archive-inspector|skill-editor|skill-jev-screen)\.ts|app\/utils\/(relative-time|skill-file-tree|skill-findings|skill-findings-rescan|skill-labels|skill-editor)\.ts|app\/types\/skills-ui\.d\.ts|shared\/types\/skills\.d\.ts|shared\/utils\/skills\/(findings|hidden-characters|diff|archive|path|edit|compose|frontmatter|blank|mode|templates\/.*|finding-.*|file-set-findings|frontmatter-findings|known-names|lookalikes|url-hosts|update-changes|jev-findings|runtime-notice)\.ts|shared\/utils\/skills-policy\.ts|tests\/setup\/helpers\/skills-ui\.ts|tests\/e2e\/helpers\/skills\.ts)$/,
      tests: skillsManagerTests,
    },
    {
      pattern:
        /^(app\/composables\/features\.ts|app\/plugins\/10\.features\.ts|server\/api\/v1\/features\/.*\.ts|shared\/types\/features\.d\.ts|server\/db\/schemas\/features\.ts|shared\/utils\/features\/.*\.ts|server\/utils\/features\/.*\.ts|tests\/setup\/helpers\/features-available\.ts|server\/types\/h3-context\.d\.ts|server\/utils\/account\/purge-(user-data|feature-access)\.ts|\.drizzle\/migrations\/[^/]+_feature_(access_tables|rule_schedules)\/.*)$/,
      tests: featureAccessTests,
    },
    {
      pattern:
        /^(app\/pages\/profile\/labs\.vue|app\/utils\/labs\.ts|app\/layouts\/profile\.vue|app\/composables\/(user-keys|feature-opt-in)\.ts|server\/api\/v1\/profiles\/features\/.*\.ts|server\/utils\/features\/(opt-ins|evaluate)\.ts|shared\/types\/features\.d\.ts|shared\/utils\/provider-meta\.ts|app\/components\/Search\/Modal\.client\.vue)$/,
      tests: featureLabsTests,
    },
    {
      pattern:
        /^(server\/api\/v1\/admin\/.*\.ts|server\/utils\/features\/admin(-queries|-request)?\.ts|shared\/utils\/features\/(admin-schemas|schedule-schemas|rollout-gate)\.ts|server\/utils\/features\/schedule.*\.ts|server\/plugins\/feature-(audit-sweep|schedule-applier)\.ts|app\/(layouts\/admin\.vue|middleware\/admin\.ts|pages\/admin\/.*\.vue|components\/Admin\/.*\.vue|utils\/admin-(features|schedule)\.ts)|app\/components\/Search\/Modal\.client\.vue|nuxt\.config\.ts)$/,
      tests: featureAdminTests,
    },
    {
      pattern:
        /^(server\/capabilities\/.*\.ts|server\/utils\/platform\/.*\.ts|server\/mcp\/tools\/.*\.ts|server\/api\/v1\/.*\.ts|server\/utils\/mcp\/tool-scopes\.ts|shared\/utils\/features\/registry\.ts|tests\/unit\/server\/capabilities\/fixtures\/.*\.ts)$/,
      tests: capabilityContractTests,
    },
    {
      pattern:
        /^(app\/components\/Profile\/Security\/.*\.vue|server\/api\/v1\/profiles\/sessions\/.*\.ts|server\/db\/schemas\/auth\.ts)$/,
      tests: accountSecurityHubTests,
    },
    {
      pattern:
        /^(app\/components\/ui\/LocalDate\.vue|app\/utils\/local-date\.ts)$/,
      tests: localDateTests,
    },
    {
      pattern: /^app\/pages\/profile\/(email|password)\.vue$/,
      tests: accountEmailPasswordTests,
    },
    {
      pattern:
        /^(server\/db\/schemas\/(auth|two-factor|passkeys)\.ts|server\/utils\/custom-db-types\.ts|lib\/auth\.ts|server\/utils\/auth\.ts|app\/composables\/auth\.ts|app\/pages\/\(auth\)\/(signin|2fa)\.vue|app\/components\/ui\/Form\/Otp\.vue|app\/components\/Profile\/Security\/(TwoFactor|BackupCodes|Passkeys)\.vue|app\/pages\/profile\/security\.vue|app\/utils\/(qr-code|webauthn)\.ts)$/,
      tests: twoFactorTests,
    },
    {
      pattern: /^app\/composables\/session-freshness\.ts$/,
      tests: [...accountSecurityHubTests, ...twoFactorTests],
    },
    {
      pattern: /^app\/composables\/linked-accounts\.ts$/,
      tests: [
        ...accountSecurityHubTests,
        ...twoFactorTests,
        ...accountEmailPasswordTests,
      ],
    },
    {
      pattern:
        /^(app\/workers\/knowledge-extract\.ts|app\/components\/Projects\/Knowledge\/.*\.vue|app\/components\/Profile\/Memory\/CacheInfo\.vue|app\/composables\/(knowledge-extract|knowledge-upload|project-knowledge|project-knowledge-model|project-knowledge-folders)\.ts|app\/utils\/(knowledge-html-to-markdown|knowledge-upload-plan|knowledge-folder|knowledge-title|knowledge-zip|project-knowledge-ui|reasoning)\.ts|app\/types\/(knowledge-extract|knowledge-ui|project-knowledge)\.d\.ts|tests\/setup\/helpers\/knowledge-(fixtures|ui-fixtures)\.ts)$/,
      tests: projectKnowledgeClientTests,
    },
    {
      pattern: /^app\/layouts\/profile\.vue$/,
      tests: [
        'tests/unit/layouts/profile.spec.ts',
        'tests/e2e/profile/preferences.spec.ts',
      ],
    },
    {
      pattern: /^app\/pages\/profile\/(preferences|settings)\.vue$/,
      tests: preferencesPageTests,
    },
    {
      pattern:
        /^(app\/utils\/reasoning-step-icons\.ts|app\/components\/Chat\/Reasoning(\/(StepIcon|ApprovalStep|ConnectorStep|MemoryStep|SearchStep|SkillStep))?\.vue|app\/composables\/composer-connectors\.ts|app\/pages\/shared\/\[slug\]\.vue|server\/utils\/chats\/test\/reasoning-icons-fixture\.ts|shared\/utils\/chat-test-errors\.ts)$/,
      tests: reasoningStepIconsTests,
    },
    {
      pattern:
        /^(server\/utils\/connectors\/(icon|icon-response|icon-rate-limit|route|svg-icon|registry-icon|send-tools)\.ts|server\/api\/v1\/connectors\/(\[id\]|registry)\/icon\.get\.ts|server\/api\/v1\/connectors\/delete\/bulk\.post\.ts|server\/utils\/net\/safe-fetch\.ts|shared\/utils\/connectors-policy\.ts|tests\/setup\/helpers\/(connector-icon-kv|mock-mcp-server)\.ts)$/,
      tests: connectorIconTests,
    },
    {
      pattern: /^app\/(utils\/reasoning-icons\.ts|components\/Profile\/Security\/SectionCard\.vue)$/,
      tests: [...preferencesPageTests, ...chatInputToolsTests],
    },
    {
      pattern: /^app\/components\/Sidebar\/AuthCta\.vue$/,
      tests: ['tests/unit/components/Sidebar/AuthCta.spec.ts'],
    },
    {
      pattern:
        /^(app\/pages\/profile\/memory\.vue|app\/components\/Profile\/Memory\/.*\.vue|app\/components\/Projects\/MemoryCard\.vue|app\/composables\/(memory-settings|memory-projects|memory-backfill)\.ts|app\/utils\/(memory-backfill|memory-legacy-about-me|memory-model-filter)\.ts|shared\/utils\/(prompt-cache-estimate|memory-index-estimate|memory-recommended-models|memory-about-me|memory-import-limits)\.ts|app\/utils\/memory-entry-labels\.ts|app\/types\/(memory-settings|memory-entries)\.d\.ts|app\/utils\/memory-model-filter\.ts|shared\/utils\/memory-policy\.ts|shared\/types\/memory\.d\.ts)$/,
      tests: memoryTabTests,
    },
    {
      pattern: /^app\/components\/ui\/Button\.vue$/,
      tests: ['tests/unit/components/ui/Button.spec.ts'],
    },
    {
      pattern: /^server\/utils\/session\.ts$/,
      tests: [
        'tests/integration/server/session.spec.ts',
        'tests/unit/server/utils/auth-instance.spec.ts',
        'tests/integration/api/chats-new.spec.ts',
        'tests/integration/api/projects.spec.ts',
        'tests/integration/api/chats-branch.spec.ts',
      ],
    },
    {
      pattern: /^app\/pages\/chats\/projects\/.*\.vue$/,
      tests: historyProjectsTests,
    },
    {
      pattern: /^server\/utils\/db\/like\.ts$/,
      tests: [
        'tests/unit/server/utils/db/like.spec.ts',
        'tests/integration/api/projects.spec.ts',
        'tests/integration/api/chats-history.spec.ts',
        'tests/integration/api/files-index-project-id.spec.ts',
        'tests/integration/api/files-projects.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/(ChatInput|Projects)\/ProjectPicker\.client\.vue$/,
      tests: historyProjectsTests,
    },
    {
      pattern: /^server\/api\/v1\/files\/.*\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^server\/api\/v1\/chats\/.*\.ts$/,
      tests: [
        ...historyProjectsTests,
        ...chatStreamBranchTests,
        ...chatTestEndpointTests,
        ...messageUsageTests,
        'tests/integration/api/chats-detail.spec.ts',
        'tests/integration/api/chats-client-errors.spec.ts',
      ],
    },
    {
      pattern:
        /^(server\/api\/v1\/chats\/\[slug\]\/index\.delete\.ts|server\/utils\/files\/chat-deletion-cleanup\.ts)$/,
      tests: [
        ...historyProjectsTests,
        ...filesModuleTests,
        ...memoryChatDeletionTests,
        'tests/integration/api/chats-message-delete.spec.ts',
      ],
    },
    {
      pattern:
        /^server\/api\/v1\/chats\/\[slug\]\/messages\/\[id\]\.delete\.ts$/,
      tests: [
        ...messageSearchTests,
        ...contextMenuTests,
        'tests/integration/api/chats-message-delete.spec.ts',
      ],
    },
    {
      pattern: /^server\/api\/v1\/projects\/.*\.ts$/,
      tests: historyProjectsTests,
    },
    {
      pattern: /^server\/routes\/files\/.*\.ts$/,
      tests: [
        ...filesModuleTests,
        ...chatTestEndpointTests,
        'tests/e2e/shared/context-menu-clipping.spec.ts',
      ],
    },
    {
      pattern:
        /^(server\/api\/v1\/storage\/connector-images\/delete\.post\.ts|server\/utils\/files\/connector-images\.ts|server\/(mcp\/tools|utils\/besidka-tools\/tools)\/delete-connector-images\.ts|app\/pages\/profile\/storage\.vue)$/,
      tests: [...storageQuotaTests, ...storagePageTests],
    },
    {
      pattern: /^server\/api\/v1\/storage\/index\.get\.ts$/,
      tests: [...filesModuleTests, ...storageQuotaTests, ...storagePageTests],
    },
    {
      pattern: /^server\/utils\/storage\/.*\.ts$/,
      tests: [...storageQuotaTests, ...storagePageTests],
    },
    {
      pattern: /^(shared\/types\/files\.d\.ts|tests\/setup\/mocks\/api\.ts)$/,
      tests: [...storageQuotaTests, ...storagePageTests],
    },
    {
      pattern:
        /^server\/utils\/(files\/(file-governance|persist-file|upload-request)|artifacts\/store|knowledge\/(ingest|quota)|documents\/(create-document-tool|finalize)|ai\/(artifact-tools|image-generation(-errors)?)|mcp\/private\/(settings|files|documents|artifacts))\.ts$/,
      tests: storageQuotaTests,
    },
    {
      pattern: /^server\/(mcp\/tools|utils\/besidka-tools\/tools)\/get-settings\.ts$/,
      tests: storageQuotaTests,
    },
    {
      pattern:
        /^server\/utils\/skills\/(usage|import\/commit|import\/update-check|pending|cleanup|versions\/(create|write|statements))\.ts$/,
      tests: storageQuotaTests,
    },
    {
      pattern: /^app\/(pages\/profile\/storage\.vue|utils\/storage-categories\.ts)$/,
      tests: storagePageTests,
    },
    {
      pattern: /^server\/utils\/files\/.*\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern:
        /^server\/utils\/files\/(reconstruct-generated-image-parts|file-governance)\.ts$/,
      tests: [
        'tests/integration/api/chats-detail.spec.ts',
        'tests/integration/server/assistant-files.spec.ts',
        'tests/integration/server/reconstruct-generated-image-parts.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/files\/(assistant-files|persist-file)\.ts$/,
      tests: [
        ...gatewayChatTests,
        ...modelTurnsTests,
        'tests/unit/server/utils/files/persist-file.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/chats\/model-turns\.ts$/,
      tests: [
        ...modelTurnsTests,
        'tests/integration/api/chats-project-knowledge.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/files\/carried-media-types\.ts$/,
      tests: [
        'tests/integration/server/assistant-files.spec.ts',
        'tests/integration/api/chats-carried-files.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/chats\/history\/.*\.ts$/,
      tests: [...historyProjectsTests, ...messageSearchTests],
    },
    {
      pattern: /^server\/api\/v1\/chats\/history\/.*\.ts$/,
      tests: [...historyProjectsTests, ...messageSearchTests],
    },
    {
      pattern: /^server\/utils\/projects\/.*\.ts$/,
      tests: historyProjectsTests,
    },
    {
      pattern: /^shared\/(types\/(history|projects)\.d\.ts|utils\/date-groups\.ts)$/,
      tests: [...historyProjectsTests, ...messageSearchTests],
    },
    {
      pattern: /^shared\/types\/files\.d\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^app\/types\/file-manager\.d\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^app\/utils\/file-manager-sources\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^shared\/types\/chat-errors\.d\.ts$/,
      tests: [
        ...chatStreamBranchTests,
        'tests/integration/api/chats-title.spec.ts',
        'tests/unit/utils/chats/errors.spec.ts',
      ],
    },
    {
      pattern: /^shared\/utils\/chat-failure-text\.ts$/,
      tests: [
        'tests/unit/utils/chat-failure-text.spec.ts',
        'tests/unit/utils/chat-failure-notice.spec.ts',
        'tests/unit/utils/ai/image-generation-errors.spec.ts',
        'tests/unit/utils/search/text.spec.ts',
        'tests/unit/composables/chat.spec.ts',
        'tests/integration/api/chats-tool-loop.spec.ts',
        'tests/integration/server/assistant-files.spec.ts',
      ],
    },
    {
      pattern: /^shared\/utils\/chat-test-errors\.ts$/,
      tests: chatTestEndpointTests,
    },
    {
      pattern: /^server\/db\/schemas\/(files|storages|image-transform-usage-monthly)\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^server\/db\/schemas\/chat-shares\.ts$/,
      tests: [...filesModuleTests, ...chatShareTests],
    },
    {
      pattern: /^server\/db\/schemas\/(chats|projects|messages)\.ts$/,
      tests: [
        ...historyProjectsTests,
        ...chatStreamBranchTests,
        ...chatShareTests,
        ...memoryModelTests,
        ...memoryExtractionTests,
      ],
    },
    {
      pattern: /^server\/db\/schema\.ts$/,
      tests: [
        ...filesModuleTests,
        ...historyProjectsTests,
        ...chatStreamBranchTests,
        ...profileSettingsTests,
        ...pushNotificationTests,
        ...memoryComplianceTests,
        ...memoryModelTests,
        ...memoryPurgeTests,
        ...projectKnowledgeServerTests,
        ...memoryExtractionTests,
      ],
    },
    {
      pattern: /^app\/composables\/.*\.ts$/,
      tests: (file) => {
        const name = file.match(/\/([^/]+)\.ts$/)?.[1]
        const testFile
          = `tests/unit/composables/${name}.spec.ts`

        return existsSync(testFile) ? [testFile] : []
      },
    },
    {
      pattern: /^server\/api\/v1\/profiles\/settings\/.*\.ts$/,
      tests: profileSettingsTests,
    },
    {
      pattern: /^(server\/utils\/legal\/notice-dismissal|shared\/utils\/user-settings-schemas)\.ts$/,
      tests: ['tests/integration/api/profile-settings-legal-notices.spec.ts'],
    },
    {
      pattern: /^server\/db\/schemas\/user-settings\.ts$/,
      tests: [
        ...profileSettingsTests,
        ...memoryModelTests,
        ...memoryExtractionTests,
      ],
    },
    {
      pattern: /^shared\/(types\/project-knowledge\.d|utils\/(knowledge-hash|project-knowledge-(policy|budget|schemas|path)))\.ts$/,
      tests: projectKnowledgeContractTests,
    },
    {
      pattern: /^shared\/utils\/gateway-model-id\.ts$/,
      tests: ['tests/unit/utils/project-knowledge-budget.spec.ts'],
    },
    {
      pattern: /^(server\/utils\/knowledge\/(storage-keys|purge|quota)|server\/db\/schemas\/project-knowledge)\.ts$/,
      tests: projectKnowledgeServerTests,
    },
    {
      pattern: /^server\/utils\/files\/file-governance\.ts$/,
      tests: [
        'tests/unit/utils/knowledge/quota.spec.ts',
        ...knowledgeIngestTests,
        ...knowledgeRetentionTests,
      ],
    },
    {
      pattern: /^server\/utils\/knowledge\/(items|version|text-store|chunk|pack|pack-lease)\.ts$/,
      tests: [
        ...knowledgeCoreTests,
        ...knowledgeIngestTests,
        ...knowledgeRetentionTests,
      ],
    },
    {
      pattern: /^server\/utils\/knowledge\/pack\.ts$/,
      tests: [
        'tests/unit/utils/knowledge/send-data.spec.ts',
        'tests/integration/api/chats-project-knowledge.spec.ts',
      ],
    },
    {
      pattern: /^(server\/utils\/knowledge\/(access|ingest|body|rate-limit)\.ts|server\/api\/v1\/projects\/\[id\]\/knowledge\/.*\.ts)$/,
      tests: knowledgeIngestTests,
    },
    {
      pattern: /^(server\/utils\/knowledge\/(linked-files|sweep)\.ts|server\/plugins\/project-knowledge-sweep\.ts|server\/utils\/files\/(cleanup-expired-files|chat-deletion-cleanup)\.ts|server\/api\/v1\/files\/(\[id\]\/index\.delete|delete\/bulk\.post)\.ts|server\/api\/v1\/projects\/\[id\]\/index\.delete\.ts)$/,
      tests: knowledgeRetentionTests,
    },
    {
      pattern: /^server\/utils\/evlog-attributes\.ts$/,
      tests: ['tests/unit/utils/evlog-attributes.spec.ts'],
    },
    {
      pattern: /^tests\/setup\/helpers\/knowledge-(db|api)\.ts$/,
      tests: [
        ...knowledgeCoreTests,
        ...knowledgeIngestTests,
        ...knowledgeRetentionTests,
      ],
    },
    {
      pattern: /^server\/utils\/knowledge\/(purge|storage-keys)\.ts$/,
      tests: memoryPurgeTests,
    },
    {
      pattern: /^server\/utils\/knowledge\/(search|pre-retrieval|rerank|send-data|context|previous-mode)\.ts$/,
      tests: projectKnowledgeRetrievalTests,
    },
    {
      pattern: /^server\/utils\/knowledge\/tools\/(index|excerpt)\.ts$/,
      tests: projectKnowledgeRetrievalTests,
    },
    {
      pattern: /^server\/utils\/knowledge\/.+\.ts$/,
      tests: ['tests/integration/api/chats-project-knowledge.spec.ts'],
    },
    {
      pattern: /^server\/utils\/search\/(tokens|ukrainian-stemmer)\.ts$/,
      tests: projectKnowledgeRetrievalTests,
    },
    {
      pattern: /^shared\/utils\/project-knowledge-(policy|budget|schemas)\.ts$/,
      tests: [
        ...projectKnowledgeContractTests,
        ...projectKnowledgeRetrievalTests,
      ],
    },
    {
      pattern: /^tests\/setup\/helpers\/knowledge-send-db\.ts$/,
      tests: projectKnowledgeRetrievalTests,
    },
    {
      pattern: /^tests\/setup\/helpers\/knowledge-db\.ts$/,
      tests: [
        ...projectKnowledgeServerTests,
        ...projectKnowledgeRetrievalTests,
      ],
    },
    {
      pattern: /^server\/db\/schemas\/memory-entries\.ts$/,
      tests: [
        ...memoryExtractionTests,
        ...memoryComplianceTests,
        ...memoryPurgeTests,
        ...profileSettingsTests,
      ],
    },
    {
      pattern: /^server\/db\/relations\.ts$/,
      tests: [
        ...memoryExtractionTests,
        ...memoryComplianceTests,
        ...memoryModelTests,
        ...memoryPurgeTests,
        ...profileSettingsTests,
      ],
    },
    {
      pattern: /^shared\/(types\/memory\.d|utils\/memory-(policy|schemas))\.ts$/,
      tests: [
        ...memoryContractTests,
        ...memoryComplianceTests,
        ...memoryModelTests,
        ...memoryExtractionTests,
        ...profileSettingsTests,
      ],
    },
    {
      pattern: /^(server\/utils\/memory\/(compliance|sensitivity|sensitivity-rules|text-folding|topical-never-store)|shared\/utils\/secret-patterns)\.ts$/,
      tests: [
        ...memoryComplianceTests,
        ...memoryModelTests,
        ...memoryExtractionTests,
        ...memoryEntriesTests,
        ...memoryToolTests,
        ...profileSettingsTests,
      ],
    },
    {
      pattern: /^server\/utils\/memory\/resolve-model\.ts$/,
      tests: [
        ...memoryModelTests,
        ...memoryExtractionTests,
        ...historyProjectsTests,
        ...profileSettingsTests,
      ],
    },
    {
      pattern: /^shared\/utils\/memory-import-prompt\.ts$/,
      tests: ['tests/unit/utils/memory-import-prompt.spec.ts'],
    },
    {
      pattern: /^(server\/utils\/memory\/instruct[\w-]*\.ts|server\/api\/v1\/memory\/instruct\/.*\.ts|shared\/utils\/memory-instruct\.ts|shared\/types\/memory-instruct\.d\.ts|app\/utils\/memory-instruct-diff\.ts|app\/components\/Profile\/Memory\/Instruct\/.*\.vue)$/,
      tests: memoryInstructTests,
    },
    {
      pattern: /^(server\/db\/schemas\/memory-backfill-jobs|shared\/types\/memory-backfill\.d)\.ts$/,
      tests: [
        ...memoryExtractionTests,
        ...memoryPurgeTests,
        ...profileSettingsTests,
      ],
    },
    {
      pattern: /^server\/(utils\/memory\/(extract.*|backfill.*)|plugins\/memory-(extraction|backfill)-sweep|api\/v1\/memory\/(extract-now\.post|import\.post|backfill\/.*))\.ts$/,
      tests: memoryExtractionTests,
    },
    {
      pattern: /^server\/utils\/projects\/(memory-entries|memory-lease|memory|memory-refresh|memory-card|memory-account|memory-limits|memory-sweep-settle|memory-toggle|legacy-memory|instructions)\.ts$/,
      tests: [...memoryExtractionTests, ...memoryModelTests],
    },
    {
      pattern: /^(server\/(api\/v1\/chats\/\[slug\]\/memory\.patch|utils\/memory\/(chat-memory-filters|chat-deletion)|db\/schemas\/chats|api\/v1\/chats\/(new\/index\.put|branch\/index\.post))|app\/(composables|utils)\/chat-memory-exclusion|app\/composables\/history|shared\/types\/history\.d|tests\/setup\/helpers\/(search-index-db|history-fixtures))\.ts$|^app\/(components\/(History\/(ActionsDropdown|ChatRow)|Sidebar\/Development|ChatInput\.client|ChatInput\/ToolsMenu\.client|ChatInput\/ToolsMenu\/Content|ChatInput\/SettingTile)|pages\/chats\/(new|\[slug\]))\.vue$/,
      tests: memoryChatExclusionTests,
    },
    {
      pattern: /^app\/utils\/project-memory-refresh\.ts$/,
      tests: ['tests/unit/utils/project-memory-refresh.spec.ts'],
    },
    {
      pattern: /^tests\/setup\/helpers\/(memory-extraction-db|memory-backfill-db|memory-db|public-id-mock)\.ts$/,
      tests: memoryExtractionTests,
    },
    {
      pattern: /^server\/utils\/memory\/catalog-usability\.ts$/,
      tests: [
        ...memoryModelTests,
        ...profileSettingsTests,
        ...artifactsBridgeServerTests,
      ],
    },
    {
      pattern: /^server\/utils\/ai\/resolve-cheapest-model\.ts$/,
      tests: [...memoryModelTests, ...artifactsBridgeServerTests],
    },
    {
      pattern: /^server\/utils\/memory\/validate-model-choice\.ts$/,
      tests: profileSettingsTests,
    },
    {
      pattern: /^server\/utils\/gateways\/catalog-rate-limit\.ts$/,
      tests: profileSettingsTests,
    },
    {
      pattern: /^app\/components\/Chat\/(UrlSources|Reasoning)\.vue$/,
      tests: [
        ...profileSettingsTests,
        ...searchStepTests,
        ...memoryStepTests,
        'tests/unit/components/Chat/Reasoning.spec.ts',
        'tests/unit/components/Chat/UrlSources.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/Chat\/OmittedContextFiles\.vue$/,
      tests: ['tests/unit/components/Chat/OmittedContextFiles.spec.ts'],
    },
    {
      pattern:
        /^shared\/(utils\/model-context-omissions\.ts|types\/model-context\.d\.ts)$/,
      tests: [
        'tests/unit/utils/model-context-omissions.spec.ts',
        'tests/unit/components/Chat/OmittedContextFiles.spec.ts',
        'tests/integration/server/assistant-files.spec.ts',
        'tests/integration/api/chats-message-id-stream.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/Chat\/Reasoning\/SearchStep\.vue$/,
      tests: searchStepTests,
    },
    {
      pattern: /^app\/(utils\/search-step\.ts|types\/search-step\.d\.ts)$/,
      tests: searchStepTests,
    },
    {
      pattern: /^shared\/utils\/search-freshness\.ts$/,
      tests: [
        ...searchStepTests,
        'tests/unit/utils/search/freshness.spec.ts',
      ],
    },
    {
      pattern: /^app\/utils\/reasoning\.ts$/,
      tests: [
        ...searchStepTests,
        ...memoryStepTests,
        'tests/unit/utils/reasoning.spec.ts',
        'tests/unit/components/Chat/Reasoning.spec.ts',
      ],
    },
    {
      pattern:
        /^app\/components\/ChatInput\/ToolsMenu\/(ReasoningSection|StepsSection|Segmented|ToggleRow)\.vue$/,
      tests: [
        ...profileSettingsTests,
        ...chatInputToolsTests,
      ],
    },
    {
      pattern:
        /^(app\/components\/ChatInput(\.client|\/ToolsMenu\.client|\/ToolsMenu\/.+|\/SettingTile|\/Files\/Attached\/Preview\.client)\.vue|app\/utils\/chat-input-tiles\.ts|app\/types\/chat-input-tools\.d\.ts|app\/composables\/(scroll-edge-fade|reveal-guard|tools-menu-focus-rescue)\.ts|app\/assets\/icons\/exa\.svg)$/,
      tests: [
        ...chatInputToolsTests,
        'tests/unit/components/ProviderIcon.spec.ts',
        'tests/e2e/chat/exa-search-level.spec.ts',
        'tests/e2e/chat/gateway-image-generation.spec.ts',
        'tests/e2e/chat/files.spec.ts',
        'tests/e2e/chat/files-carousel-scroll.spec.ts',
        'tests/e2e/chat/chat-input-collapse-on-attach.spec.ts',
        'tests/e2e/projects/picker.spec.ts',
      ],
    },
    {
      pattern: /^app\/plugins\/.*user-settings.*\.ts$/,
      tests: profileSettingsTests,
    },
    {
      pattern:
        /^(workers\/artifacts-runtime\/|packages\/artifacts-protocol\/|tests\/e2e-artifacts\/|playwright\.artifacts\.config\.ts$)/,
      tests: artifactsRuntimeTests,
    },
    {
      pattern: /^app\/assets\/css\/main\.css$/,
      tests: [
        'tests/unit/workers/artifacts-runtime/design.spec.ts',
        'tests/unit/workers/artifacts-runtime/kit-theme.spec.ts',
      ],
    },
    {
      pattern:
        /^(server\/utils\/artifacts\/|server\/api\/v1\/artifacts\/|server\/capabilities\/artifacts\.ts$|server\/db\/schemas\/artifacts\.ts$|shared\/utils\/artifacts\.ts$|server\/plugins\/artifact-(report|storage)-sweep\.ts$|tests\/setup\/helpers\/artifacts-store\.ts$)/,
      tests: artifactsCoreTests,
    },
    {
      pattern:
        /^(server\/api\/v1\/shared\/\[slug\]\/artifacts\/|server\/utils\/artifacts\/(store|shared-chat|report-rate-limit)\.ts$|server\/utils\/features\/global\.ts$|server\/utils\/chats\/share\.ts$|shared\/utils\/artifacts\.ts$|app\/components\/Chat\/Artifact\/ReportButton\.client\.vue$|tests\/setup\/helpers\/(artifacts-store|memory-extraction-db)\.ts$)/,
      tests: artifactsSharedChatTests,
    },
    {
      pattern:
        /^(server\/utils\/artifacts\/|server\/api\/v1\/(artifact-shares|artifacts\/\[id\]\/shares|admin\/(artifact-reports|artifact-takedowns|artifacts))\/|server\/api\/v1\/shared\/\[slug\]\/artifacts\/|server\/utils\/(turnstile|email|email-template)\.ts$|server\/utils\/features\/(admin|admin-request|global|guards)\.ts$|server\/utils\/chats\/(share|share-pii-check)\.ts$|server\/db\/schemas\/artifacts\.ts$|shared\/utils\/artifacts\.ts$|tests\/setup\/helpers\/(artifacts-store|memory-extraction-db|public-id-mock)\.ts$)/,
      tests: artifactsSharesTests,
    },
    {
      pattern:
        /^(server\/middleware\/02\.artifact-share-path\.ts|server\/utils\/artifacts\/(share-(redaction|request)|log-redaction)\.ts|shared\/utils\/artifacts\.ts)$/,
      tests: [
        'tests/unit/server/middleware/artifact-share-path.spec.ts',
        'tests/unit/server/utils/artifacts/log-redaction.spec.ts',
        'tests/unit/server/plugins/evlog-request-observability.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/(artifacts\/(store|shares|queries|blob-store)|ai\/artifact-tools|chats\/share-pii-check|features\/evaluate|mcp\/private\/(artifacts|artifact-context))\.ts$/,
      tests: mcpArtifactTests,
    },
    {
      pattern: /^server\/(mcp\/tools\/create-document|utils\/besidka-tools\/tools\/create-document|utils\/mcp\/private\/documents)\.ts$/,
      tests: [
        'tests/unit/server/mcp/tools/create-document.spec.ts',
        'tests/unit/server/utils/mcp/private-documents.spec.ts',
        'tests/unit/server/utils/mcp/tool-scopes.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/(turnstile|auth-hosts)\.ts$/,
      tests: ['tests/unit/server/utils/turnstile.spec.ts'],
    },
    {
      pattern:
        /^(server\/plugins\/artifacts-frame-src\.ts|(app|shared)\/utils\/artifact-frame-policy\.ts|app\/components\/Chat\/Artifact\/Frame\.client\.vue)$/,
      tests: [
        'tests/integration/server/artifacts-frame-src-plugin.spec.ts',
        'tests/unit/utils/artifact-frame-policy.spec.ts',
        'tests/unit/components/Chat/Artifact/Frame.client.spec.ts',
      ],
    },
    {
      pattern:
        /^(app\/components\/Chat\/Artifact\/(Card|Detail\.client|Frame\.client|BridgeConfirm\.client|CodeView\.client)\.vue|app\/components\/Chat\/ContextPanel(Item)?\.vue|app\/components\/prose\/(PreStream|MermaidViewer\.client)\.vue|app\/composables\/(artifact(s|-host-actions|-storage|-bridge|-delete|-fix)|chat-input-prefill|chunked-code-highlight|code-stream)\.ts|app\/utils\/artifact-(export|parts|bridge)\.ts|shared\/utils\/artifacts\.ts|playwright\.config\.ts)$|^packages\/artifacts-protocol\//,
      tests: artifactsUiTests,
    },
    {
      pattern: /^app\/composables\/chat-input-prefill\.ts$/,
      tests: ['tests/unit/components/ChatInput.spec.ts'],
    },
    {
      pattern:
        /^(app\/pages\/(chats|shared)\/\[slug\]\.vue|app\/utils\/reasoning\.ts|app\/composables\/chat\.ts)$/,
      tests: ['tests/e2e/chat/artifacts-panel.spec.ts'],
    },
    {
      pattern:
        /^(app\/pages\/artifacts\/\[token\]\.vue|app\/layouts\/artifact-share\.vue|app\/components\/Artifact\/.*\.vue|app\/components\/Chat\/Artifact\/(ShareModal|ReportButton|Detail|Frame)\.client\.vue|app\/composables\/(artifacts|artifact-storage|artifact-bridge|has-sidebar)\.ts|app\/utils\/(artifact-share-(page|location)|scroll-within)\.ts|app\/plugins\/cloudflare-web-analytics\.client\.ts|app\/app\.vue|shared\/utils\/artifacts\.ts)$/,
      tests: artifactsShareUiTests,
    },
    {
      pattern:
        /^(app\/components\/Shared\/ExitLink\.vue|app\/pages\/shared\/\[slug\]\.vue)$/,
      tests: sharedExitLinkTests,
    },
    {
      pattern:
        /^(app\/pages\/chats\/artifacts\/index\.vue|app\/components\/Artifact\/KindFilter\.vue|app\/composables\/artifacts-library\.ts|app\/components\/History\/(ArtifactRow|FilterButtons|PageShell|ActionsToolbar)\.vue|app\/components\/Search\/Modal\.client\.vue|app\/components\/Chat\/ContextPanel\.vue|server\/api\/v1\/artifacts\/index\.get\.ts|server\/utils\/artifacts\/queries\.ts|shared\/utils\/artifacts\.ts)$/,
      tests: artifactsLibraryTests,
    },
    {
      pattern:
        /^(app\/pages\/chats\/shared\/index\.vue|app\/components\/History\/(SharedArtifactRow|BoxTabs|PageShell)\.vue|app\/composables\/shared-artifacts\.ts|server\/api\/v1\/artifacts\/shared\/index\.get\.ts|server\/utils\/artifacts\/queries\.ts|shared\/utils\/artifacts\.ts)$/,
      tests: sharedHistoryTests,
    },
    {
      pattern:
        /^(app\/pages\/admin\/artifact-reports\.vue|app\/components\/Admin\/Artifact(ReportDetail\.client|TakedownForm)\.vue|app\/utils\/admin-artifact-reports\.ts|app\/layouts\/admin\.vue|app\/components\/Search\/Modal\.client\.vue|shared\/utils\/artifacts\.ts)$/,
      tests: artifactsAdminReportsTests,
    },
    {
      pattern:
        /^(server\/utils\/ai\/artifact-tools\.ts$|server\/utils\/artifacts\/|server\/capabilities\/|server\/utils\/features\/send-features\.ts$|server\/api\/v1\/chats\/\[slug\]\/index\.post\.ts$|server\/utils\/chats\/persist-user-message\.ts$|server\/utils\/ai\/(tool-loop|search-answer-continuation)\.ts$|shared\/utils\/(artifacts|message-metadata)\.ts$)/,
      tests: artifactsChatTests,
    },
    {
      pattern:
        /^(app\/components\/(Artifact\/KindFilter|ChatInput\/ArtifactPicker\.client|Chat\/ArtifactAttachments|History\/ArtifactRow|ChatInput\.client|ChatInput\/ToolsMenu(\.client|\/Content))\.vue|app\/composables\/(artifact-fix|artifacts-library|chat-input-prefill|chat)\.ts|app\/utils\/chat-input-tiles\.ts|app\/types\/chat-input-tools\.d\.ts|app\/pages\/chats\/(new|\[slug\])\.vue|server\/utils\/artifacts\/(attachments|chat-artifacts|context)\.ts|server\/utils\/chats\/(request-schema|share-public-parts)\.ts|server\/utils\/chats\/context\/(artifacts|sections)\.ts|server\/api\/v1\/chats\/(new\/index\.put|\[slug\]\/index\.post|shares\/\[slug\]\/branch\.post)\.ts|shared\/utils\/artifacts\.ts)$/,
      tests: artifactsAttachTests,
    },
    {
      pattern:
        /^(workers\/mail-alerts\/.*|shared\/utils\/mail-alert-protocol\.ts|server\/utils\/mail-alerts\/.*\.ts|server\/api\/v1\/internal\/mail-alert\/.*\.ts|server\/utils\/push\.ts|server\/utils\/features\/(admin-recipients|admin-queries|schedule-notify)\.ts)$/,
      tests: mailAlertsTests,
    },
    {
      pattern:
        /^(app\/composables\/(markdown-textarea|pasted-texts)\.ts|app\/utils\/(knowledge-html-to-markdown|pasted-text)\.ts|app\/components\/(ChatInput\.client|Projects\/InstructionsCard|ChatInput\/Files\/Attached\/(TextCard|Preview\.client)|Chat\/TextFileModal\.client)\.vue)$/,
      tests: markdownTextareaTests,
    },
    {
      pattern:
        /^(app\/utils\/(rehype-raw-html-as-text|remark-disable-html)\.ts|app\/composables\/chat-format\.ts)$/,
      tests: [
        'tests/unit/utils/rehype-raw-html-as-text.spec.ts',
        'tests/unit/utils/remark-disable-html.spec.ts',
        'tests/unit/composables/chat-format.spec.ts',
        'tests/e2e/chat/chat-input-markdown.spec.ts',
      ],
    },
    {
      pattern: /^app\/utils\/.*\.ts$/,
      tests: (file) => {
        const name = file.match(/\/([^/]+)\.ts$/)?.[1]
        const testFile
          = `tests/unit/utils/${name}.spec.ts`

        return existsSync(testFile) ? [testFile] : []
      },
    },
    {
      pattern:
        /^(nuxt\.config\.ts|vitest\.config\.mts|playwright\.config\.ts|package\.json|pnpm-lock\.yaml)$/,
      tests: 'all',
    },
    {
      pattern:
        /^(tests\/setup\/(vitest\.(setup\.(common|dom|node)|projects)|mocks\/nuxt-server)\.ts|server\/utils\/(logging\/request-logger|http\/(apply-response-headers|get-decoded-router-params))\.ts)$/,
      tests: 'all',
    },
    {
      pattern: /^app\.config\.ts$/,
      tests: ['tests/e2e/settings/theme.spec.ts'],
    },
    {
      pattern: /^tests\/e2e\/(auth\.setup|helpers\/[^/]+)\.ts$/,
      tests: () => listE2ESpecFiles(),
    },
    {
      pattern: /^tests\/.*\.spec\.ts$/,
      tests: file => [file],
    },
    {
      pattern: /^(server\/db\/|drizzle.*\.config\.ts$|\.drizzle\/migrations)/,
      tests: [
        'tests/unit/db/migrations-clean.spec.ts',
        'tests/unit/db/accounts-provider-account-id.spec.ts',
        'tests/unit/db/typesafe-roles-migration.spec.ts',
        'tests/unit/db/default-reasoning-level-migration.spec.ts',
        'tests/unit/db/project-memory-auto-update-migration.spec.ts',
      ],
    },
    {
      pattern: /^(shared\/utils\/project-memory-auto-update|shared\/types\/project-memory\.d|server\/utils\/memory\/project-auto-update)\.ts$/,
      tests: [
        ...memoryExtractionTests,
        'tests/unit/components/Projects/MemoryCard.spec.ts',
        'tests/unit/pages/chats/projects/[id].spec.ts',
        'tests/integration/api/projects-memory.spec.ts',
        'tests/unit/server/utils/mcp/private-projects-manage.spec.ts',
      ],
    },
    {
      pattern: /^server\/api\/v1\/projects\/\[id\]\/memory\/index\.(get|patch)\.ts$/,
      tests: ['tests/integration/api/projects-memory.spec.ts'],
    },
    {
      pattern: /^app\/composables\/social-oauth\.ts$/,
      tests: ['tests/unit/composables/social-oauth.spec.ts'],
    },
    {
      pattern: /^app\/composables\/validation\.ts$/,
      tests: ['tests/unit/composables/validation.spec.ts'],
    },
    {
      pattern: /^app\/composables\/wake-lock\.ts$/,
      tests: ['tests/unit/composables/wake-lock.spec.ts'],
    },
    {
      pattern: /^app\/utils\/user-agent\.ts$/,
      tests: ['tests/unit/utils/user-agent.spec.ts'],
    },
    {
      pattern: /^server\/plugins\/file-retention-cleanup\.ts$/,
      tests: filesModuleTests,
    },
    {
      pattern: /^server\/utils\/files\/upload-request\.ts$/,
      tests: ['tests/integration/api/files-upload.spec.ts'],
    },
    {
      pattern: /^(shared\/utils\/mdc\/.*|nuxt\.config\.ts|content\/.*\.md)$/,
      tests: ['tests/unit/utils/mdc-vbind-policy.spec.ts'],
    },
    {
      pattern: /^server\/utils\/evlog-drains\.ts$/,
      tests: [
        'tests/unit/utils/evlog-drains.spec.ts',
        'tests/integration/server/evlog-client-ingest-guard-plugin.spec.ts',
      ],
    },
    {
      pattern: /^server\/plugins\/00\.evlog-client-ingest-guard\.ts$/,
      tests: [
        'tests/integration/server/evlog-client-ingest-guard-plugin.spec.ts',
      ],
    },
    {
      pattern: /^shared\/utils\/safe-redirect-path\.ts$/,
      tests: [
        'tests/unit/utils/safe-redirect-path.spec.ts',
        'tests/unit/server/middleware/studio-guard.spec.ts',
      ],
    },
    {
      pattern: /^server\/middleware\/00\.studio-guard\.ts$/,
      tests: ['tests/unit/server/middleware/studio-guard.spec.ts'],
    },
    {
      pattern: /^server\/utils\/scheduled-job-logger\.ts$/,
      tests: [
        'tests/unit/utils/scheduled-job-logger.spec.ts',
        'tests/integration/server/landing-cache-refresh.spec.ts',
        'tests/integration/server/file-retention-cleanup-plugin.spec.ts',
        'tests/integration/server/legal-notice-sweep-plugin.spec.ts',
        'tests/integration/server/memory-backfill-sweep-plugin.spec.ts',
        'tests/integration/server/memory-extraction-sweep-plugin.spec.ts',
        'tests/integration/server/message-search-sweep-plugin.spec.ts',
        'tests/integration/server/oauth-grant-sweep-plugin.spec.ts',
        'tests/integration/server/project-knowledge-sweep-plugin.spec.ts',
        'tests/integration/server/push-subscription-sweep-plugin.spec.ts',
        'tests/integration/server/research-job-sweep-plugin.spec.ts',
      ],
    },
    {
      pattern: /^server\/plugins\/landing-cache-control\.ts$/,
      tests: ['tests/unit/server/plugins/landing-cache-control.spec.ts'],
    },
    {
      pattern: /^(server\/(mcp\/.*|utils\/(mcp|besidka-tools)\/.*)|shared\/utils\/provider-meta|providers\/.*)\.ts$/,
      tests: [
        'tests/unit/server/utils/content/minimark.spec.ts',
        'tests/unit/server/utils/mcp/cached-content.spec.ts',
        'tests/unit/server/utils/mcp/catalog.spec.ts',
        'tests/unit/server/utils/mcp/key-guides.spec.ts',
        'tests/unit/server/utils/mcp/pages.spec.ts',
        'tests/unit/server/utils/mcp/safe-tool.spec.ts',
        'tests/unit/server/utils/mcp/auth.spec.ts',
        'tests/unit/server/utils/mcp/tool-scopes.spec.ts',
        'tests/unit/server/utils/mcp/private-access.spec.ts',
        'tests/unit/server/utils/mcp/private-tool.spec.ts',
        'tests/unit/server/utils/mcp/private-chats.spec.ts',
        'tests/unit/server/utils/mcp/private-chat-cursors.spec.ts',
        'tests/unit/server/utils/mcp/private-projects.spec.ts',
        'tests/unit/server/utils/mcp/private-memory.spec.ts',
        'tests/unit/server/utils/mcp/bounded-body.spec.ts',
        'tests/unit/server/utils/mcp/project-text-body-size.spec.ts',
        'tests/unit/server/mcp/tools/create-project.spec.ts',
        'tests/unit/server/middleware/mcp-request-guard.spec.ts',
        ...mcpUiParityTests,
        ...mcpArtifactTests,
        ...mcpConnectorTests,
        ...mcpSkillTests,
      ],
    },
    {
      pattern: /^(shared\/utils\/connectors-text\.ts|server\/(mcp\/tools\/(list|get|add|update|delete)-connectors?(-tools)?|utils\/(besidka-tools\/tools\/(list|get|add|update|delete)-connectors?(-tools)?|mcp\/(private\/(connectors|connector-context)|readable-error)|connectors\/(add|delete|store))))\.ts$/,
      tests: mcpConnectorTests,
    },
    {
      pattern: /^(config\/mcp-server\.ts|server\/(mcp\/tools\/(list-google-connections|disconnect-google)|utils\/(besidka-tools\/(registry|chat-adapter|tools\/(list-google-connections|disconnect-google))|mcp\/(private\/google|private-access|tool-scopes)|google\/(connection|store|byo-access))))\.ts$/,
      tests: mcpGoogleConnectionTests,
    },
    {
      pattern: /^server\/(mcp\/tools\/(list|get|create|update|rename|delete)-skills?|utils\/(besidka-tools\/tools\/(list|get|create|update|rename|delete)-skills?|mcp\/private\/(skills|skill-context)|skills\/versions\/(mcp|settings|save|write|statements|route)))\.ts$/,
      tests: mcpSkillTests,
    },
    {
      pattern: /^server\/utils\/settings\/apply-user-settings\.ts$/,
      tests: ['tests/unit/utils/memory/forward-only-memory-resume.spec.ts'],
    },
    {
      pattern: /^(server\/utils\/(chats\/(lifecycle|share-management|generation-in-progress)|projects\/(lifecycle|memory-toggle)|files\/(delete-files|source-filter|file-name)|settings\/.*|oauth\/(client-scope-upgrade|stored-scopes)|knowledge\/linked-files)|shared\/utils\/user-settings-schemas)\.ts$/,
      tests: mcpUiParityTests,
    },
    {
      pattern: /^(server\/middleware\/01\.mcp-request-guard|config\/mcp-server|server\/types\/h3-context\.d)\.ts$/,
      tests: [
        'tests/unit/server/middleware/mcp-request-guard.spec.ts',
        'tests/unit/server/utils/mcp/auth.spec.ts',
        'tests/unit/server/utils/mcp/private-access.spec.ts',
        'tests/unit/server/utils/mcp/bounded-body.spec.ts',
        'tests/unit/server/utils/mcp/project-text-body-size.spec.ts',
        ...mcpArtifactTests,
      ],
    },
    {
      pattern: /^(shared\/utils\/(mcp-oauth-scopes|memory-policy|memory-schemas|project-knowledge-schemas|project-knowledge-policy)|server\/utils\/(legal\/consent|auth-rate-limit|chats\/history\/.*|knowledge\/(access|ingest|items|rate-limit|text-store)|memory\/(entries|jev-check|rate-limit)|projects\/cursor))\.ts$/,
      tests: [
        'tests/unit/server/utils/mcp/tool-scopes.spec.ts',
        'tests/unit/server/utils/mcp/private-access.spec.ts',
        'tests/unit/server/utils/mcp/private-chats.spec.ts',
        'tests/unit/server/utils/mcp/private-chat-cursors.spec.ts',
        'tests/unit/server/utils/mcp/private-projects.spec.ts',
        'tests/unit/server/utils/mcp/private-memory.spec.ts',
        'tests/unit/server/utils/mcp/project-text-body-size.spec.ts',
        'tests/unit/server/mcp/tools/create-project.spec.ts',
        ...mcpUiParityTests,
        ...mcpArtifactTests,
        ...mcpConnectorTests,
        ...mcpSkillTests,
      ],
    },
    {
      pattern: /^(shared\/utils\/invisible-characters|server\/utils\/projects\/name)\.ts$/,
      tests: [
        'tests/unit/utils/invisible-characters.spec.ts',
        'tests/unit/utils/knowledge/ingest.spec.ts',
        'tests/unit/server/utils/mcp/private-projects.spec.ts',
        'tests/integration/api/projects.spec.ts',
      ],
    },
    {
      pattern: /^app\/composables\/auth\.ts$/,
      tests: [
        'tests/unit/composables/auth-oauth-query.spec.ts',
        'tests/unit/middleware/00.auth.global.oauth.spec.ts',
      ],
    },
    {
      pattern: /^app\/middleware\/00\.auth\.global\.ts$/,
      tests: ['tests/unit/middleware/00.auth.global.oauth.spec.ts'],
    },
    {
      pattern: /^app\/(components\/OAuth|pages\/oauth)\/.*$/,
      tests: [
        'tests/unit/components/OAuth/ScopePicker.spec.ts',
        'tests/unit/components/OAuth/ScopeLabel.spec.ts',
        'tests/unit/components/OAuth/ScopeLabel.spec.ts',
        'tests/unit/components/Profile/ConnectedApps/PermissionsEditor.spec.ts',
        'tests/e2e/profile/oauth-consent.spec.ts',
      ],
    },
    {
      pattern: /^app\/(components\/Profile\/ConnectedApps\/.*\.vue|utils\/connected-apps\.ts)$/,
      tests: [
        'tests/unit/utils/connected-apps.spec.ts',
        'tests/unit/components/Profile/ConnectedApps/PermissionsEditor.spec.ts',
        'tests/unit/pages/profile/connected-apps.spec.ts',
      ],
    },
    {
      pattern: /^(shared\/utils\/mcp-oauth-scopes|server\/utils\/auth|server\/routes\/\.well-known\/(oauth-.*|openid-configuration.*))\.ts$/,
      tests: [
        'tests/unit/utils/auth-oauth.spec.ts',
        'tests/integration/api/profiles-connected-apps-consent.spec.ts',
      ],
    },
    {
      pattern: /^server\/db\/schemas\/oauth\.ts$/,
      tests: oauthAuthServerTests,
    },
    {
      pattern: /^server\/utils\/auth-rate-limit\.ts$/,
      tests: [
        'tests/unit/utils/auth-rate-limit-oauth.spec.ts',
        'tests/unit/utils/auth-rate-limit-kv-errors.spec.ts',
        'tests/unit/server/utils/keys-rate-limit.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/account\/(purge-user-data|revoke-user-oauth-grants)\.ts$/,
      tests: [
        'tests/unit/utils/account/purge-user-oauth-data.spec.ts',
        'tests/unit/utils/account/revoke-user-oauth-grants.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/account\/(notify-oauth-app-connected|security-emails)\.ts$/,
      tests: [
        'tests/unit/utils/account/notify-oauth-app-connected.spec.ts',
        'tests/unit/utils/account/security-emails.spec.ts',
      ],
    },
    {
      pattern: /^(server\/utils\/account\/security-emails\.ts|server\/utils\/legal\/notice-sender\.ts|shared\/utils\/account-emails\.ts|content\/legal\/privacy-policy\.md)$/,
      tests: ['tests/unit/content/account-email-list.spec.ts'],
    },
    {
      pattern: /^(server\/utils\/legal\/(admin|consent|consent-version|notice-approvals|notice-sweep|purge)\.ts|server\/api\/v1\/admin\/legal\/.*\.ts|server\/db\/schemas\/legal-approvals\.ts|shared\/utils\/legal-admin-schemas\.ts|server\/utils\/account\/purge-user-data\.ts|app\/pages\/admin\/legal\.vue|app\/layouts\/admin\.vue|\.drizzle\/migrations\/20261115103710_mute_vision\/migration\.sql)$/,
      tests: legalAdminTests,
    },
    {
      pattern: /^(server\/utils\/legal\/(notice-sweep|notice-email|notice-sender)\.ts|server\/plugins\/legal-notice-sweep\.ts|server\/db\/schemas\/legal-notice-deliveries\.ts|server\/utils\/email(-template)?\.ts|app\/emails\/LegalNoticeEmail\.vue|shared\/utils\/legal-notices\.ts)$/,
      tests: legalNoticeEmailTests,
    },
    {
      pattern: /^shared\/utils\/account-emails\.ts$/,
      tests: [
        'tests/unit/server/utils/mcp/pages.spec.ts',
        'tests/unit/server/plugins/agent-discovery-page-components.spec.ts',
      ],
    },
    {
      pattern: /^(app\/components\/content\/AccountEmailList\.vue|shared\/utils\/account-emails\.ts)$/,
      tests: ['tests/unit/components/content/AccountEmailList.spec.ts'],
    },
    {
      pattern: /^(shared\/utils\/(legal-notices|legal-change-history)\.ts)$/,
      tests: [
        'tests/unit/utils/legal-notices.spec.ts',
        'tests/unit/utils/legal-change-history.spec.ts',
        'tests/unit/components/content/LegalChangeHistory.spec.ts',
        'tests/unit/server/utils/mcp/pages.spec.ts',
        'tests/unit/server/plugins/agent-discovery-page-components.spec.ts',
        'tests/unit/content/legal-revisions.spec.ts',
      ],
    },
    {
      pattern: /^app\/components\/content\/LegalChangeHistory\.vue$/,
      tests: ['tests/unit/components/content/LegalChangeHistory.spec.ts'],
    },
    {
      pattern: /^(shared\/utils\/legal-document-revisions\.ts|scripts\/legal-revision-hash\.mjs|content\/legal\/.*\.md)$/,
      tests: [
        'tests/unit/content/legal-revisions.spec.ts',
        'tests/unit/scripts/legal-revision-hash.spec.ts',
      ],
    },
    {
      pattern: /^(config\/legal-updated-at\.ts|nuxt\.config\.ts|content\/legal\/.*\.md|shared\/utils\/(account-emails|legal-notices)\.ts)$/,
      tests: [
        'tests/unit/config/legal-updated-at.spec.ts',
        'tests/unit/content/legal-pages.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/oauth\/registration-limits\.ts$/,
      tests: [
        'tests/unit/utils/oauth/registration-limits.spec.ts',
        'tests/unit/utils/auth-oauth.spec.ts',
      ],
    },
    {
      pattern: /^server\/utils\/oauth\/protected-resource-metadata\.ts$/,
      tests: [
        'tests/unit/utils/oauth/protected-resource-metadata.spec.ts',
        'tests/unit/server/routes/well-known/oauth-protected-resource.spec.ts',
      ],
    },
    {
      pattern: /^server\/routes\/\.well-known\/oauth-protected-resource\/index\.get\.ts$/,
      tests: [
        'tests/unit/server/routes/well-known/oauth-protected-resource.spec.ts',
      ],
    },
    {
      pattern: /^shared\/utils\/oauth-consent-errors\.ts$/,
      tests: [
        'tests/integration/api/profiles-connected-apps-consent.spec.ts',
        'tests/unit/components/OAuth/ScopePicker.spec.ts',
        'tests/unit/components/OAuth/ScopeLabel.spec.ts',
        'tests/unit/components/OAuth/ScopeLabel.spec.ts',
        'tests/e2e/profile/oauth-consent.spec.ts',
      ],
    },
    {
      pattern: /^server\/plugins\/oauth-grant-sweep\.ts$/,
      tests: ['tests/integration/server/oauth-grant-sweep-plugin.spec.ts'],
    },
    {
      pattern: /^(server\/api\/v1\/profiles\/connected-apps\/.*|server\/utils\/oauth\/(stored-scopes|narrow-consent-scopes|revoke-connected-app|revoke-superseded-clients))\.ts$/,
      tests: [
        'tests/integration/api/profiles-connected-apps.spec.ts',
        'tests/integration/api/profiles-connected-apps-authorization-request.spec.ts',
        'tests/integration/api/profiles-connected-apps-consent.spec.ts',
        'tests/integration/api/profiles-connected-apps-list.spec.ts',
        'tests/integration/api/profiles-connected-apps-scopes.spec.ts',
        'tests/integration/api/profiles-connected-apps-revoke-bulk.spec.ts',
        'tests/unit/utils/oauth/stored-scopes.spec.ts',
        'tests/unit/utils/oauth/narrow-consent-scopes.spec.ts',
        'tests/unit/utils/oauth/revoke-superseded-clients.spec.ts',
        'tests/unit/server/utils/mcp/auth.spec.ts',
        'tests/unit/server/middleware/mcp-request-guard.spec.ts',
      ],
    },
    {
      pattern: /^server\/(routes\/auth\.md\.get|utils\/agent-discovery\/auth-md)\.ts$/,
      tests: ['tests/unit/server/routes/auth.md.spec.ts'],
    },
    {
      pattern: /^(app\/layouts\/profile\.vue|app\/pages\/profile\/connected-apps\.vue)$/,
      tests: [
        'tests/unit/layouts/profile.spec.ts',
        'tests/unit/pages/profile/connected-apps.spec.ts',
      ],
    },
    {
      pattern: /^server\/plugins\/cache-key-without-query\.ts$/,
      tests: ['tests/unit/server/plugins/cache-key-without-query.spec.ts'],
    },
    {
      pattern: /^server\/plugins\/markdown-negotiation-cache-control\.ts$/,
      tests: [
        'tests/unit/server/plugins/markdown-negotiation-cache-control.spec.ts',
      ],
    },
    {
      pattern: /^server\/plugins\/mcp-tool-outcome\.ts$/,
      tests: ['tests/unit/server/plugins/mcp-tool-outcome.spec.ts'],
    },
    {
      pattern: /^server\/plugins\/evlog-request-observability\.ts$/,
      tests: ['tests/unit/server/plugins/evlog-request-observability.spec.ts'],
    },
  ]

  for (const file of changedFiles) {
    for (const mapping of testMappings) {
      if (mapping.pattern.test(file)) {
        const tests = typeof mapping.tests === 'function'
          ? mapping.tests(file)
          : mapping.tests

        if (tests === 'all') {
          return 'all'
        }

        if (Array.isArray(tests)) {
          tests.forEach(test => affectedTests.add(test))
        }
      }
    }
  }

  return Array.from(affectedTests)
}

export function filterTestsByType(tests, testType) {
  if (tests === 'all') return 'all'

  return tests.filter((test) => {
    if (testType === 'unit') {
      return test.startsWith('tests/unit/')
        || test.startsWith(COOKIE_CONSENT_MODULE_TEST_DIR)
    }
    if (testType === 'integration') {
      return test.startsWith('tests/integration/')
    }
    if (testType === 'e2e') {
      return test.startsWith('tests/e2e/')
    }

    return true
  })
}

const isDirectRun
  = process.argv[1] === fileURLToPath(import.meta.url)

if (isDirectRun) {
  const args = process.argv.slice(2)

  const base = args
    .find(arg => arg.startsWith('--base='))
    ?.split('=')[1] || 'HEAD'
  const type = args
    .find(arg => arg.startsWith('--type='))
    ?.split('=')[1] || 'all'

  const changedFiles = getChangedFiles(base)

  if (changedFiles.length === 0) {
    console.log('No changed files detected.')
    writeOutput('has-tests', 'false')
    process.exit(0)
  }

  console.log('Changed files:')
  changedFiles.forEach(
    file => console.log(`  - ${file}`),
  )
  console.log()

  const affectedTests = getAffectedTests(changedFiles)
  const filtered = filterTestsByType(affectedTests, type)

  const hasTests = filtered === 'all'
    || (Array.isArray(filtered) && filtered.length > 0)

  if (hasTests && Array.isArray(filtered)) {
    console.log(
      `Found ${filtered.length} affected ${type} test(s):`,
    )
    filtered.forEach(
      test => console.log(`  - ${test}`),
    )
  } else if (hasTests) {
    console.log(
      `Core files changed — all ${type} tests affected`,
    )
  } else {
    console.log(`No affected ${type} tests found`)
  }

  writeOutput('has-tests', hasTests ? 'true' : 'false')
}

function writeOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT

  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`)
  }

  console.log(`\n${key}=${value}`)
}
